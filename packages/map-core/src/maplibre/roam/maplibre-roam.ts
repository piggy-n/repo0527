import type { CameraState } from '../../camera/camera-model';
import { fromEcef, type Point3, toEcef } from '../../scene/nav/nav-frame';
import { RoutePath } from '../../scene/route-path';
import type {
  RoamStatus,
  RouteRoam,
  SceneContent,
  SceneRoam,
  TilesetStatus,
  UndergroundView,
  WalkNotice,
  WalkPhase,
  WalkPlayer,
  WalkRoam,
  WalkRoamStatus
} from '../../scene/scene-content-model';
import { Blackout } from '../../view/blackout';
import type { ScreenPoint } from '../../view/view-input';
import type { CameraEventData, CameraTransformLike, GestureHandlerLike, MapLike } from '../map-like';
import type { SceneRenderer } from '../scene-renderer';
import {
  exitCamera,
  eyeOf,
  firstPersonCamera,
  groundCamera,
  liftFor,
  type RoamEye,
  ROAM_MAX_ZOOM
} from './roam-camera';
import type { RoamHost } from './roam-host';
import { RouteRoamer } from './route-roamer';
import { WalkRoamer, type WalkStartContext } from './walk-roamer';

/** 漫游用到的地图能力：相机、上限、视场角、中心高度和手势；MapLibre 的 Map 满足它（见 MapLike） */
export type RoamMap = Pick<
  MapLike,
  | 'getCanvas'
  | 'getBearing'
  | 'getPitch'
  | 'jumpTo'
  | 'unproject'
  | 'getMaxZoom'
  | 'setMaxZoom'
  | 'getMaxPitch'
  | 'setMaxPitch'
  | 'getVerticalFieldOfView'
  | 'setVerticalFieldOfView'
  | 'getCenterClampedToGround'
  | 'setCenterClampedToGround'
> &
  Readonly<Record<RoamGesture, GestureHandlerLike>>;

export interface MapLibreRoamOptions {
  readonly map: RoamMap;
  /** MapLibre 相机当前的变换（视图的 cameraTransform）：开始步行时读相机的位置 */
  readonly cameraTransform: () => CameraTransformLike;
  /** 地图的容器：拦键鼠、放黑幕 */
  readonly container: HTMLElement;
  /** 三维渲染器；三维模块还没加载时为 null */
  readonly renderer: () => SceneRenderer | null;
  /** 瓦片集的加载状态：要抬高的瓦片集还在加载时等它 */
  readonly tilesetState: (id: string) => TilesetStatus['state'] | undefined;
  /** 会话现在的相机：开始漫游时记下，结束时飞回 */
  readonly currentCamera: () => CameraState;
  /** 结束漫游时飞回开始前的相机 */
  readonly flyTo: (camera: CameraState, duration: number) => void;
  /** 接管地图、抬高变了（隔离泼溅也算抬高，抬高量是 0）：视图据此隐藏、恢复二维图层，接管结束后按当前工具恢复手势和光标 */
  readonly onTakeover: (state: { readonly engaged: boolean; readonly lifted: boolean }) => void;
  readonly onStatus: (status: RoamStatus | null) => void;
}

// 抬高期间画模型之前的底色
const BACKDROP = '#1e2226';
// 结束漫游时飞回开始前的位置（毫秒）
const BACK_FLIGHT = 1200;
// 路线进度每变这么多米报告一次
const ROAM_REPORT_STEP = 0.5;
// 第一人称要往上看：俯仰放到 MapLibre 允许的上限
const ROAM_MAX_PITCH = 180;
// 漫游期间关掉的手势：键鼠都归漫游
const ROAM_GESTURES = [
  'dragPan',
  'scrollZoom',
  'boxZoom',
  'dragRotate',
  'keyboard',
  'doubleClickZoom',
  'touchZoomRotate',
  'touchPitch'
] as const;
type RoamGesture = (typeof ROAM_GESTURES)[number];
const PROGRAM: CameraEventData = Object.freeze({ cause: 'program' });

// 场景里正在进行的漫游：roam 是最近应用的意图；detached 是被别的定位接管、已经停下
type RoamEntry =
  | { readonly kind: 'route'; roam: RouteRoam; readonly path: RoutePath; detached: boolean }
  | { readonly kind: 'walk'; roam: WalkRoam; detached: boolean };

// 抬高或隔离：只画 modelId 这一份；地下的瓦片集抬高 meters 米，泼溅是 0（ADR 0156 R.5）
interface Lift {
  readonly modelId: string;
  readonly meters: number;
}

// 接管地图时改掉的设置，结束时还原；saved 是开始前的相机
interface Takeover {
  readonly saved: CameraState;
  readonly maxZoom: number;
  readonly maxPitch: number;
  readonly fov: number;
  readonly clamped: boolean;
  readonly gestures: readonly RoamGesture[];
  lift: Lift | null;
}

const sameLift = (a: Lift | null, b: Lift | null) => a?.modelId === b?.modelId && a?.meters === b?.meters;
const toDegrees = (radians: number) => (radians * 180) / Math.PI;
const separation = (a: Point3, b: Point3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * MapLibre 引擎的漫游（ADR 0083、0086、0087、0147 第 4 节）：按会话的漫游意图开始、改变、结束路线和步行，报告进度。
 * 漫游期间接管地图（手势、缩放上限 24、俯仰上限 180、视场角、中心高度不夹到地面），漫游地下的模型时把它抬高、隐藏二维；
 * 进出用黑幕盖住。控制器（RouteRoamer、WalkRoamer）只用真实的坐标，抬高只在这里的相机换算和渲染器里
 */
export class MapLibreRoam implements RoamHost, Disposable {
  readonly container: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly #map: RoamMap;
  readonly #options: MapLibreRoamOptions;
  readonly #route: RouteRoamer;
  readonly #walk: WalkRoamer;
  readonly #blackout: Blackout;
  #entry: RoamEntry | null = null;
  #status: RoamStatus | null = null;
  #takeover: Takeover | null = null;
  #underground: UndergroundView | null = null;
  #isolatedSplat: string | null = null;
  // 最后设给相机的真实视点和视场角（弧度）
  #eye: RoamEye | null = null;
  #fovy = 0;
  // 进出、换手的过渡：每次换一个，全黑时只执行最新的
  #transition: object | null = null;
  // 要抬高的瓦片集还在加载：就绪后再进去
  #waiting: (() => void) | null = null;
  #frame = 0;
  #paused = false;
  #disposed = false;

  constructor(options: MapLibreRoamOptions) {
    this.#options = options;
    this.#map = options.map;
    this.container = options.container;
    this.canvas = options.map.getCanvas();
    this.#blackout = new Blackout(options.container);
    this.#route = new RouteRoamer(this, {
      progress: distance => this.#onRouteProgress(distance),
      end: () => this.#onRouteEnd()
    });
    this.#walk = new WalkRoamer(this, {
      phase: phase => this.#onWalkPhase(phase),
      notice: notice => this.#onWalkNotice(notice),
      player: player => this.#onWalkPlayer(player)
    });
  }

  get status(): RoamStatus | null {
    return this.#status;
  }

  /** 接管着地图：相机、手势归漫游 */
  get engaged(): boolean {
    return this.#takeover !== null;
  }

  /** 抬高量（米）；没有抬高时为 0 */
  get lift(): number {
    return this.#takeover?.lift?.meters ?? 0;
  }

  /** 写回会话的相机（真实的高度）；还没设过第一人称的相机时为 null，按地图的读 */
  sessionCamera(viewportHeight: number): CameraState | null {
    return this.#takeover && this.#eye ? groundCamera(this.#eye, Math.max(1, viewportHeight)) : null;
  }

  /**
   * 按会话的三维内容开始、改变或结束漫游；back 决定结束时是否飞回。
   * 换了一次漫游（ID 或种类变了）时直接开始新的，已经在模型里时不重新进出
   */
  apply({ roam: wanted, underground, isolatedSplat }: SceneContent, back: boolean): void {
    this.#underground = underground;
    this.#isolatedSplat = isolatedSplat ?? null;
    const entry = this.#entry;
    if (!wanted) {
      if (entry) {
        this.#entry = null;
        if (!entry.detached) {
          this.#stopControllers();
          this.#exit(back);
        }
        this.#publish(null);
      }
      return;
    }
    if (!entry || entry.kind !== wanted.kind || entry.roam.id !== wanted.id) {
      this.#start(wanted);
      return;
    }
    if (entry.kind === 'route' && wanted.kind === 'route') {
      this.#updateRoute(entry, wanted);
    } else if (entry.kind === 'walk' && wanted.kind === 'walk') {
      this.#updateWalk(entry, wanted);
    }
  }

  /** 瓦片集的状态变了：等着抬高的瓦片集就绪时进去 */
  onSceneStatus(): void {
    const waiting = this.#waiting;
    if (waiting) {
      this.#waiting = null;
      waiting();
    }
  }

  /** 页面开始了别的定位：漫游立即停下、不飞回，去掉抬高、还原地图，相机交给这次定位；拥有者随后会撤掉漫游 */
  detach(): void {
    const entry = this.#entry;
    if (entry && !entry.detached) {
      entry.detached = true;
      this.#stopControllers();
    }
    this.#waiting = null;
    this.#transition = null;
    if (this.#takeover) {
      this.#release(false);
      // 去掉抬高的那一下：模型和二维同时跳回原处
      this.#blackout.flash();
    } else {
      this.#blackout.lighten();
    }
  }

  /** 不再显示三维（切到二维）：停下漫游，相机回到开始前的位置 */
  suspend(): void {
    const entry = this.#entry;
    if (entry && !entry.detached) {
      entry.detached = true;
      this.#stopControllers();
    }
    this.#waiting = null;
    this.#transition = null;
    this.#blackout.clear();
    this.#release(true);
  }

  /** 视图暂停（页面停用）：不再逐帧推进，忘掉按着的键 */
  pause(): void {
    this.#paused = true;
    cancelAnimationFrame(this.#frame);
    this.#frame = 0;
    this.#walk.setActive(false);
  }

  /** 视图恢复：相机放回第一人称的位置，接着推进 */
  resume(): void {
    this.#paused = false;
    this.#walk.setActive(true);
    if (this.#takeover && this.#eye) {
      this.setEye(this.#eye, this.#fovy);
    }
    this.requestFrame();
  }

  setEye(eye: RoamEye, fovy: number): void {
    const takeover = this.#takeover;
    if (!takeover) {
      return;
    }
    this.#eye = eye;
    this.#fovy = fovy;
    const map = this.#map;
    const degrees = toDegrees(fovy);
    if (Math.abs(map.getVerticalFieldOfView() - degrees) > 1e-6) {
      map.setVerticalFieldOfView(degrees, PROGRAM);
    }
    const { center, elevation, zoom, bearing, pitch } = firstPersonCamera(eye, {
      lift: takeover.lift?.meters ?? 0,
      viewportHeight: Math.max(1, this.canvas.clientHeight),
      fovy
    });
    map.jumpTo({ center, elevation, zoom, bearing, pitch }, PROGRAM);
  }

  pick(point: ScreenPoint): Point3 | null {
    const hit = this.#options.renderer()?.pick(point);
    return hit ? toEcef(hit.lngLat[0], hit.lngLat[1], hit.height) : null;
  }

  project(point: Point3): ScreenPoint | null {
    const [lng, lat, height] = fromEcef(point);
    return this.#options.renderer()?.project([lng, lat], height) ?? null;
  }

  requestFrame(): void {
    if (this.#paused || this.#disposed || this.#frame !== 0) {
      return;
    }
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      const now = performance.now();
      this.#route.tick(now);
      this.#walk.tick(now);
    });
  }

  setMarker(position: Point3 | null): void {
    const renderer = this.#options.renderer();
    if (!position) {
      renderer?.setMarker(null);
      return;
    }
    const [lng, lat, height] = fromEcef(position);
    renderer?.setMarker({ lngLat: [lng, lat], height });
  }

  [Symbol.dispose](): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    cancelAnimationFrame(this.#frame);
    this.#transition = null;
    this.#waiting = null;
    this.#route[Symbol.dispose]();
    this.#walk[Symbol.dispose]();
    this.#blackout[Symbol.dispose]();
  }

  #start(wanted: SceneRoam): void {
    const renderer = this.#options.renderer();
    if (wanted.kind === 'route') {
      const path = new RoutePath(wanted.path);
      this.#entry = { kind: 'route', roam: wanted, path, detached: false };
      this.#walk.stop();
      renderer?.setInteriorFog(false);
      this.#route.start(path);
      this.#route.setPlayback({ playing: wanted.playing, speed: wanted.speed });
      const { id, run } = wanted;
      this.#publish({ kind: 'route', id, run, distance: 0, total: path.total, finished: false });
      this.#enter(
        () => this.#route.place(),
        () => this.#route.startEye
      );
      return;
    }
    this.#entry = { kind: 'walk', roam: wanted, detached: false };
    // 先报告进场：找不到出生点时，prepare 里就报告 failed
    const { id, view } = wanted;
    this.#publish({ kind: 'walk', id, phase: 'entering', view, notice: null, notices: 0, player: null });
    this.#route.stop();
    if (!this.#walk.prepare(wanted, this.#startContext())) {
      return;
    }
    if (wanted.paused) {
      this.#walk.setPaused(true);
    }
    renderer?.setInteriorFog(true);
    this.#enter(
      () => this.#walk.land(),
      () => this.#walk.spawnEye
    );
  }

  // 选出生点的相机：已经在模型里（从路线换过来）时是现在的视点；否则是地图的相机和画布中心的地面点
  #startContext(): WalkStartContext {
    if (this.#takeover && this.#eye) {
      return { eye: this.#eye, ground: null };
    }
    const map = this.#map;
    const transform = this.#options.cameraTransform();
    const { lng, lat } = transform.getCameraLngLat();
    const eye = eyeOf({
      lng,
      lat,
      height: transform.getCameraAltitude(),
      heading: map.getBearing(),
      pitch: map.getPitch() - 90
    });
    const center = { x: this.canvas.clientWidth / 2, y: this.canvas.clientHeight / 2 };
    if (!transform.isPointOnMapSurface(center)) {
      return { eye, ground: null };
    }
    const ground = map.unproject([center.x, center.y]);
    return { eye, ground: toEcef(ground.lng, ground.lat, 0) };
  }

  /**
   * 进到起点或出生点：还没接管时黑幕下接管、抬高再放过去；已经在模型里、抬高不变时近处直接放，远处闪切（ADR 0103）。
   * 要抬高的瓦片集还在加载时等它就绪
   */
  #enter(place: () => void, target: () => RoamEye | null): void {
    const lift = this.#wantedLift();
    if (lift === 'wait') {
      this.#waiting = () => this.#enter(place, target);
      return;
    }
    this.#waiting = null;
    const transition = {};
    this.#transition = transition;
    const takeover = this.#takeover;
    if (takeover && sameLift(takeover.lift, lift)) {
      const to = target();
      const from = this.#eye;
      this.#blackout.cut(to && from ? separation(to.position, from.position) : Infinity, () => {
        if (this.#transition === transition) {
          this.#transition = null;
          place();
        }
      });
      return;
    }
    this.#blackout.darken(() => {
      if (this.#transition !== transition) {
        return;
      }
      this.#transition = null;
      this.#takeOver(lift);
      place();
      this.#blackout.lighten();
    });
  }

  // 结束：黑幕下去掉抬高、还原地图，相机换到地表以上；back 时亮起来以后飞回开始前的相机
  #exit(back: boolean): void {
    this.#waiting = null;
    if (!this.#takeover) {
      // 还没进去（正在变黑、等瓦片集）：不再进去
      this.#transition = null;
      this.#blackout.lighten();
      return;
    }
    const transition = {};
    this.#transition = transition;
    this.#blackout.darken(() => {
      if (this.#transition !== transition) {
        return;
      }
      this.#transition = null;
      const saved = this.#release(false);
      this.#blackout.lighten();
      if (back && saved) {
        this.#options.flyTo(saved, BACK_FLIGHT);
      }
    });
  }

  // 抬高量：漫游地下的模型（会话有 underground）时按它的包围盒算，同一次漫游期间不变；还在加载时等它。
  // 漫游泼溅（会话有 isolatedSplat）时隔离它、不抬高
  #wantedLift(): Lift | null | 'wait' {
    const takeover = this.#takeover;
    if (takeover) {
      return takeover.lift;
    }
    if (this.#isolatedSplat !== null) {
      return { modelId: this.#isolatedSplat, meters: 0 };
    }
    const tilesetId = this.#underground?.tilesetId;
    if (!tilesetId) {
      return null;
    }
    const lowest = this.#options.renderer()?.lowestHeight(tilesetId) ?? null;
    if (lowest === null) {
      return this.#options.tilesetState(tilesetId) === 'loading' ? 'wait' : null;
    }
    const meters = liftFor(lowest);
    return meters > 0 ? { modelId: tilesetId, meters } : null;
  }

  // 接管地图：记下开始前的相机和设置，关掉手势，放宽缩放、俯仰上限，中心高度不夹到地面；抬高交给渲染器
  #takeOver(lift: Lift | null): void {
    const map = this.#map;
    if (!this.#takeover) {
      const gestures = ROAM_GESTURES.filter(name => map[name].isEnabled());
      this.#takeover = {
        saved: this.#options.currentCamera(),
        maxZoom: map.getMaxZoom(),
        maxPitch: map.getMaxPitch(),
        fov: map.getVerticalFieldOfView(),
        clamped: map.getCenterClampedToGround(),
        gestures,
        lift: null
      };
      for (const name of gestures) {
        map[name].disable();
      }
      map.setCenterClampedToGround(false);
      map.setMaxZoom(ROAM_MAX_ZOOM);
      map.setMaxPitch(ROAM_MAX_PITCH);
    }
    this.#takeover.lift = lift;
    this.#options.renderer()?.setLift(lift ? { ...lift, backdrop: BACKDROP } : null);
    this.#options.onTakeover({ engaged: true, lifted: lift !== null });
  }

  // 还原地图：去掉抬高，视场角、中心高度回到开始前；相机先放到上限以内再收紧上限。back 时直接回到开始前的相机，
  // 否则换到视点正上方（ADR 0147 第 4 节"退出时相机还在模型里的，先换到地表以上"）。返回开始前的相机
  #release(back: boolean): CameraState | null {
    const takeover = this.#takeover;
    if (!takeover) {
      return null;
    }
    this.#takeover = null;
    const eye = this.#eye;
    this.#eye = null;
    cancelAnimationFrame(this.#frame);
    this.#frame = 0;
    const renderer = this.#options.renderer();
    renderer?.setLift(null);
    renderer?.setMarker(null);
    renderer?.setInteriorFog(false);
    const map = this.#map;
    const { saved, maxZoom, maxPitch, fov, clamped, gestures } = takeover;
    map.setVerticalFieldOfView(fov, PROGRAM);
    map.setCenterClampedToGround(clamped);
    const target = back || !eye ? saved : exitCamera(eye, Math.max(1, this.canvas.clientHeight), maxZoom);
    map.jumpTo(
      {
        center: [target.center[0], target.center[1]],
        zoom: Math.min(target.zoom, maxZoom),
        bearing: target.bearing,
        pitch: Math.min(target.pitch, maxPitch),
        elevation: 0
      },
      PROGRAM
    );
    map.setMaxZoom(maxZoom);
    map.setMaxPitch(maxPitch);
    for (const name of gestures) {
      map[name].enable();
    }
    this.#options.onTakeover({ engaged: false, lifted: false });
    return saved;
  }

  #stopControllers(): void {
    this.#route.stop();
    this.#walk.stop();
    this.#options.renderer()?.setInteriorFog(false);
  }

  #updateRoute(entry: Extract<RoamEntry, { kind: 'route' }>, wanted: RouteRoam): void {
    const previous = entry.roam;
    entry.roam = wanted;
    if (entry.detached) {
      return;
    }
    if (wanted.run !== previous.run) {
      this.#route.restart();
      const { id, run } = wanted;
      this.#publish({ kind: 'route', id, run, distance: 0, total: entry.path.total, finished: false });
    }
    if (wanted.playing !== previous.playing || wanted.speed !== previous.speed) {
      this.#route.setPlayback({ playing: wanted.playing, speed: wanted.speed });
    }
  }

  // 速度、暂停、人称随时生效；回到出生点、脱困、瞬移的计数变了就做一次
  #updateWalk(entry: Extract<RoamEntry, { kind: 'walk' }>, wanted: WalkRoam): void {
    const previous = entry.roam;
    entry.roam = wanted;
    if (entry.detached) {
      return;
    }
    const walk = this.#walk;
    if (wanted.speed !== previous.speed) {
      walk.setSpeed(wanted.speed);
    }
    if (wanted.respawn !== previous.respawn) {
      walk.respawn();
    }
    if (wanted.unstuck !== previous.unstuck) {
      walk.unstuck();
    }
    if (wanted.paused !== previous.paused) {
      walk.setPaused(wanted.paused);
    }
    if (wanted.teleport && wanted.teleport.count !== previous.teleport?.count) {
      walk.teleport(wanted.teleport.spot);
    }
    if (wanted.view !== previous.view) {
      walk.setView(wanted.view);
      const status = this.#walkStatus();
      if (status) {
        this.#publish({ ...status, view: wanted.view });
      }
    }
  }

  #onRouteProgress(distance: number): void {
    const entry = this.#entry;
    const status = this.#status;
    if (entry?.kind !== 'route' || entry.detached || status?.kind !== 'route') {
      return;
    }
    const total = entry.path.total;
    if (Math.abs(distance - status.distance) >= ROAM_REPORT_STEP || (distance >= total && status.distance < total)) {
      this.#publish({ ...status, distance: Math.min(distance, total) });
    }
  }

  #onRouteEnd(): void {
    const entry = this.#entry;
    const status = this.#status;
    if (entry?.kind === 'route' && !entry.detached && status?.kind === 'route') {
      this.#publish({ ...status, distance: entry.path.total, finished: true });
    }
  }

  // 只报告当前这次、没被接管的步行
  #walkStatus(): WalkRoamStatus | null {
    const entry = this.#entry;
    const status = this.#status;
    return entry?.kind === 'walk' && !entry.detached && status?.kind === 'walk' && status.id === entry.roam.id
      ? status
      : null;
  }

  #onWalkPhase(phase: WalkPhase): void {
    const status = this.#walkStatus();
    if (status && status.phase !== phase) {
      this.#publish({ ...status, phase });
    }
  }

  #onWalkPlayer(player: WalkPlayer): void {
    const status = this.#walkStatus();
    if (status) {
      this.#publish({ ...status, player });
    }
  }

  #onWalkNotice(notice: WalkNotice): void {
    const status = this.#walkStatus();
    if (status) {
      this.#publish({ ...status, notice, notices: status.notices + 1 });
    }
  }

  #publish(status: RoamStatus | null): void {
    this.#status = status;
    this.#options.onStatus(status);
  }
}
