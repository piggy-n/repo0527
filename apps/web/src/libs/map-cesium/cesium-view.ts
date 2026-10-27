import {
  type CameraCause,
  type CameraState,
  canTransition,
  deferred,
  type FitBoundsOptions,
  type FlyToOptions,
  type LiveViewState,
  type LngLat,
  type MapInputEvent,
  type MapSession,
  type MapView,
  type MapViewFailure,
  ModifierPan,
  NO_SCENE_STATUS,
  NO_SOURCE_ERRORS,
  type PickResult,
  type RenderedFeature,
  type RoamStatus,
  RoutePath,
  type RouteRoam,
  type SceneStatus,
  type ScreenPoint,
  type SourceErrors,
  type TilesetLayer,
  type TilesetStatus,
  type ToolView,
  type Unsubscribe,
  type ViewBounds,
  type ViewState
} from '@yzt/map-core';
import { safeReporter } from '@yzt/utils';
import type { GeoJSON } from 'geojson';
import { createNanoEvents } from 'nanoevents';
import { fitBoundsCamera, paddedCenter } from './camera-fit';
import { isGeoJson, type OverlaySpec, planOverlays } from './overlay-plan';
import { prepareTileset } from './prepare-tileset';
import {
  type CreateScene,
  type SceneLike,
  type ScenePose,
  type TilesetOptions,
  WebGLUnavailableError
} from './scene-like';
import { planSceneStyle, type UnsupportedLayer } from './scene-style';

export interface CesiumViewOptions<G extends string> {
  readonly session: MapSession<G>;
  readonly container: HTMLElement;
  /** 创建后是否显示，默认 true；为 false 时创建后进入 paused */
  readonly active?: boolean;
  /** 运行中的错误；默认打印到控制台 */
  readonly onError?: (error: unknown) => void;
  /** 支持清单之外的图层，每个图层报告一次（ADR 0079 第 7 节）；默认不报告 */
  readonly onUnsupported?: (layer: UnsupportedLayer) => void;
  /** 创建场景：真实的是 createCesiumScene，测试时换成假场景 */
  readonly createScene: CreateScene;
  /** 下载 JSON：数据源地址上的 GeoJSON、瓦片集的索引（ADR 0080、0081）；默认用 fetch，测试时换掉 */
  readonly loadJson?: (url: string, signal: AbortSignal) => Promise<unknown>;
}

// 地址上的数据：每个地址下载一次
type RemoteData =
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly data: GeoJSON }
  | { readonly state: 'failed' };

async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`下载 ${url} 失败：${response.status}`);
  }
  const data: unknown = await response.json();
  return data;
}

interface CesiumViewEvents {
  statechange: (state: ViewState) => void;
  resize: () => void;
  settle: () => void;
  sourceerrorchange: (errors: SourceErrors) => void;
  scenestatuschange: (status: SceneStatus) => void;
  roamstatuschange: (status: RoamStatus | null) => void;
}

// 正在播放的路线（ADR 0083 第 3 节）：roam 是最近应用的意图；被别的定位接管后 detached，撤掉时不再飞回
interface RoamEntry {
  roam: RouteRoam;
  readonly path: RoutePath;
  detached: boolean;
}

// 进度每变这么多米报告一次（最快 2× 时每秒约 6 次）
const ROAM_REPORT_STEP = 0.5;

// 一个瓦片集的加载（ADR 0081 第 2 节）：layer 是会话里最近的写法
interface TilesetEntry {
  layer: TilesetLayer;
  readonly controller: AbortController;
  status: TilesetStatus;
  // 已经加进场景，之后才能改显示和光照；applied 是最近交给场景的
  applied: TilesetOptions | null;
  // 显示后首批瓦片到过：换白膜效果时，新的到了才撤下旧的
  initial: boolean;
}

const sameOptions = (a: TilesetOptions | null, b: TilesetOptions) =>
  a !== null && a.show === b.show && a.lighting === b.lighting;

// 离开三维时记下的精确相机；暂停期间会话的相机有了 sync 之外的变化就不能还原（ADR 0020 第 5 条）
interface SavedPose {
  readonly pose: ScenePose;
  restorable: boolean;
}

function reportToConsole(error: unknown): void {
  console.error('[CesiumView]', error);
}

/**
 * 三维视图（ADR 0024、0079）：镜像会话的样式、同步相机、把画布上的输入交给工具。
 * 只读会话、只写场景；用户、程序、同步引起的相机变化按 cause 写回会话
 */
export class CesiumView<const G extends string> implements MapView {
  readonly kind = '3d';
  readonly #session: MapSession<G>;
  readonly #scene: SceneLike | undefined;
  // 按住修饰键临时拖动（ADR 0080 第 4 节）；场景没创建出来时没有
  readonly #pan: ModifierPan | undefined;
  readonly #onError: (error: unknown) => void;
  readonly #onUnsupported: (layer: UnsupportedLayer) => void;
  readonly #emitter = createNanoEvents<CesiumViewEvents>();
  readonly #stack: DisposableStack;
  // 这个视图只有一轮加载：创建场景
  readonly #ready = deferred();
  #state: ViewState = 'initializing';
  #failure: MapViewFailure | null = null;
  #sourceErrors = NO_SOURCE_ERRORS;
  // 是谁在移动相机：视图自己定位时是 program、sync，其余的移动都是用户操作；相机停下后清空
  #motion: CameraCause | null = null;
  // 暂停期间样式变了，恢复时再应用
  #styleStale = false;
  #saved: SavedPose | null = null;
  readonly #reported = new Set<string>();
  // 覆盖物：样式里的图层、按哪一级推导的、地址上的数据（ADR 0080 第 1 节）
  #overlays: readonly OverlaySpec[] = [];
  #overlayLevel: number | null = null;
  readonly #remote = new Map<string, RemoteData>();
  readonly #loadJson: (url: string, signal: AbortSignal) => Promise<unknown>;
  readonly #downloads = new AbortController();
  // 三维内容（ADR 0081）：按 ID 的瓦片集，每组正在显示的那一个；暂停期间变了，恢复时再应用
  readonly #tilesets = new Map<string, TilesetEntry>();
  readonly #groupShown = new Map<string, string>();
  #sceneStatus: SceneStatus = NO_SCENE_STATUS;
  #sceneStale = false;
  // 路线漫游（ADR 0083）：场景里正在播放的，和报告出去的进度
  #roam: RoamEntry | null = null;
  #roamStatus: RoamStatus | null = null;
  // 交给工具的视图能力：只有拾取、投影和渲染要素查询（ADR 0034 第 2 条、ADR 0047 第 4 节）
  readonly #toolView: ToolView = Object.freeze({
    kind: '3d',
    pick: (point: ScreenPoint) => this.pick(point),
    project: (lngLat: LngLat, height?: number) => this.project(lngLat, height),
    queryRendered: () => []
  });

  constructor({
    session,
    container,
    active = true,
    onError = reportToConsole,
    onUnsupported = () => undefined,
    createScene,
    loadJson = fetchJson
  }: CesiumViewOptions<G>) {
    this.#session = session;
    this.#onError = safeReporter(onError, 'CesiumView');
    this.#onUnsupported = safeReporter(onUnsupported, 'CesiumView');
    this.#loadJson = loadJson;
    using stack = new DisposableStack();
    stack.defer(() => this.#ready.reject(new DOMException('CesiumView 已释放', 'AbortError')));
    stack.defer(() => this.#downloads.abort(new DOMException('CesiumView 已释放', 'AbortError')));

    let scene: SceneLike;
    try {
      scene = createScene(container);
    } catch (error) {
      // 例如不支持 WebGL：不抛出，交给 whenReady 和 statechange 表达
      this.#scene = undefined;
      this.#pan = undefined;
      this.#stack = stack.move();
      this.#fail(error);
      return;
    }
    this.#scene = scene;
    stack.use(scene);
    this.#pan = stack.use(
      new ModifierPan({
        container,
        // Cesium 的相机控制用指针事件，工具的输入来自鼠标事件：同一次按下的两种事件都截下
        downEvents: ['pointerdown', 'mousedown'],
        pan: (from, to) => {
          // 和用户按下鼠标一样：进行中的定位停下，接下来的移动是用户操作
          this.#onInteract(scene);
          scene.panBetween(from, to);
        },
        modifier: () => (this.#state === 'ready' ? (this.#session.tool.activeTool.panModifier ?? null) : null),
        // 没有就绪时不应用光标，进入 ready 时按当前工具应用
        onCursorChange: () => {
          if (this.#state === 'ready') {
            this.#applyCursor(scene);
          }
        },
        guard: callback => this.#guard(callback)
      })
    );
    for (const unsubscribe of [
      scene.on('interact', () => this.#guard(() => this.#onInteract(scene))),
      scene.on('camerachange', () => this.#guard(() => this.#onCameraChange(scene))),
      scene.on('cameraidle', () => this.#guard(() => this.#onCameraIdle(scene))),
      scene.on('pointer', event => this.#guard(() => this.#onInput(event))),
      scene.on('key', key => this.#guard(() => this.#onInput({ type: 'key', key }))),
      scene.on('resize', () => this.#emitter.emit('resize')),
      scene.on('settle', () => this.#onSettle()),
      scene.on('imageryerror', (sourceId, error) => this.#recordSourceError(sourceId, error)),
      scene.on('tilesetfailed', (id, error) => this.#onTilesetFailed(id, error)),
      scene.on('tilesetinitial', id => this.#guard(() => this.#onTilesetInitial(scene, id))),
      scene.on('routeprogress', distance => this.#onRouteProgress(distance)),
      scene.on('routeend', () => this.#onRouteEnd()),
      scene.on('failure', error => this.#fail(error))
    ]) {
      stack.defer(unsubscribe);
    }
    stack.defer(session.style.on('change', () => this.#guard(() => this.#onStyleChange(scene))));
    stack.defer(session.tool.on('change', () => this.#guard(() => this.#onToolChange(scene))));
    stack.defer(session.scene.on('change', () => this.#guard(() => this.#onSceneChange(scene))));
    stack.defer(() => this.#tilesets.forEach(({ controller }) => controller.abort()));
    stack.defer(session.camera.on('change', ({ cause }) => this.#onSessionCamera(cause)));
    this.#stack = stack.move();

    this.#applyStyle(scene);
    this.#applyScene(scene);
    if (active) {
      this.#activate(scene);
      // 视图重建时会话里可能已经在漫游：从起点接上
      this.#applyRoam(scene, false);
    } else {
      scene.setRendering(false);
      this.#setState('paused');
      this.#ready.resolve();
    }
  }

  get state(): ViewState {
    return this.#state;
  }

  get failure(): MapViewFailure | null {
    return this.#failure;
  }

  get sourceErrors(): SourceErrors {
    return this.#sourceErrors;
  }

  /** 三维内容的加载状态（ADR 0081 第 2 节） */
  get sceneStatus(): SceneStatus {
    return this.#sceneStatus;
  }

  onSceneStatusChange(callback: (status: SceneStatus) => void): Unsubscribe {
    return this.on('scenestatuschange', callback);
  }

  /** 路线漫游的进度（ADR 0083 第 2 节） */
  get roamStatus(): RoamStatus | null {
    return this.#roamStatus;
  }

  onRoamStatusChange(callback: (status: RoamStatus | null) => void): Unsubscribe {
    return this.on('roamstatuschange', callback);
  }

  whenReady(): Promise<void> {
    return this.#ready.promise;
  }

  /** 暂停：进行中的定位直接到终点并按 program 写回，记下精确相机，停止渲染 */
  pause(): void {
    this.#assertAlive();
    const scene = this.#scene;
    if (this.#state !== 'ready' || !scene) {
      return;
    }
    this.#pan?.cancel();
    if (scene.flying) {
      scene.completeFlight();
      this.#writeCamera(scene, 'program');
    }
    this.#motion = null;
    this.#saved = { pose: scene.savePose(), restorable: true };
    scene.setRendering(false);
    this.#setState('paused');
  }

  /** 恢复：先按容器调整画布，再追上暂停期间的样式变化，相机能还原就还原，否则从会话同步 */
  resume(): void {
    this.#assertAlive();
    const scene = this.#scene;
    if (this.#state !== 'paused' || !scene) {
      return;
    }
    scene.resize();
    if (this.#styleStale) {
      this.#applyStyle(scene);
    }
    // 暂停期间三维内容的变化在恢复相机以后再应用：结束钻地、漫游时从恢复后的相机出发；
    // 撤掉的漫游只在相机能还原（没被别的视图移动过）时飞回开始前的位置
    const back = this.#saved?.restorable === true;
    this.#activate(scene);
    if (this.#sceneStale) {
      this.#applyScene(scene);
    }
    this.#applyRoam(scene, back);
  }

  flyTo({ center, zoom, bearing, pitch }: Partial<CameraState>, { duration, padding }: FlyToOptions = {}): void {
    const scene = this.#readyScene();
    const current = this.#session.camera.current;
    const target: CameraState = {
      center: center ?? current.center,
      zoom: zoom ?? current.zoom,
      bearing: bearing ?? current.bearing,
      pitch: pitch ?? current.pitch
    };
    // 和二维一样，padding 只决定这一次把目标放在哪里，不留在相机上（ADR 0037）
    const placed = center ? { ...target, center: paddedCenter(center, target.zoom, target.bearing, padding) } : target;
    this.#detachRoam(scene);
    this.#move(scene, 'program', () => scene.flyTo(placed, duration));
  }

  fitBounds(bounds: ViewBounds, { padding, maxZoom, duration, pitch }: FitBoundsOptions = {}): void {
    const scene = this.#readyScene();
    const camera = fitBoundsCamera(bounds, scene.size(), {
      padding,
      maxZoom,
      pitch: pitch ?? this.#session.camera.current.pitch
    });
    this.#detachRoam(scene);
    this.#move(scene, 'program', () => scene.flyTo(camera, duration));
  }

  pick(point: ScreenPoint): PickResult {
    return this.#readyScene().pick(point);
  }

  project(lngLat: LngLat, height?: number): ScreenPoint | null {
    return this.#readyScene().project(lngLat, height);
  }

  /** 视点在椭球面以上的高度，状态栏显示（ADR 0080 第 6 节） */
  eyeHeight(): number {
    return this.#readyScene().eyeHeight();
  }

  /** 三维没有渲染要素可查（ADR 0047 第 4 节） */
  queryRendered(): RenderedFeature[] {
    this.#readyScene();
    return [];
  }

  on<E extends keyof CesiumViewEvents>(event: E, callback: CesiumViewEvents[E]): Unsubscribe {
    this.#assertAlive();
    return this.#emitter.on(event, callback);
  }

  [Symbol.dispose](): void {
    if (this.#state === 'disposed') {
      return;
    }
    this.#state = 'disposed';
    this.#failure = null;
    this.#sourceErrors = NO_SOURCE_ERRORS;
    this.#sceneStatus = NO_SCENE_STATUS;
    this.#roam = null;
    this.#roamStatus = null;
    this.#emitter.events = {};
    this.#stack.dispose();
  }

  #activate(scene: SceneLike): void {
    const saved = this.#saved;
    this.#saved = null;
    scene.setRendering(true);
    if (saved?.restorable) {
      scene.restorePose(saved.pose);
      // 还原的是三维自己的精确相机，会话按它换算后的值同步
      this.#writeCamera(scene, 'sync');
    } else {
      this.#move(scene, 'sync', () => scene.jumpTo(this.#session.camera.current));
    }
    this.#applyTool(scene);
    this.#setState('ready');
    this.#ready.resolve();
  }

  // 视图自己移动相机：在相机停下之前，这次移动引起的变化按 cause 写回；jumpTo 是同步的，立即写一次
  #move(scene: SceneLike, cause: CameraCause, move: () => void): void {
    this.#motion = cause;
    move();
    this.#writeCamera(scene, cause);
  }

  // 用户在画布上按下鼠标、滚动滚轮：进行中的定位停下，接下来的移动是用户操作；漫游时相机归漫游管
  #onInteract(scene: SceneLike): void {
    if (this.#state !== 'ready' || this.#roaming()) {
      return;
    }
    scene.cancelFlight();
    this.#motion = null;
  }

  // 不是视图自己发起的移动就是用户操作：第一次变化时开始一次新的相机操作（ADR 0038）
  #onCameraChange(scene: SceneLike): void {
    if (this.#state !== 'ready') {
      return;
    }
    if (this.#roaming()) {
      this.#writeCamera(scene, 'program');
      return;
    }
    if (this.#motion === null) {
      this.#motion = 'user';
      this.#session.camera.beginOperation();
    }
    this.#writeCamera(scene, this.#motion);
  }

  #onCameraIdle(scene: SceneLike): void {
    if (this.#state !== 'ready') {
      return;
    }
    this.#writeCamera(scene, this.#roaming() ? 'program' : (this.#motion ?? 'user'));
    this.#motion = null;
  }

  // 暂停期间会话的相机被别的视图改了：用户移动、程序定位过就不能还原离开时的精确相机
  #onSessionCamera(cause: CameraCause): void {
    if (this.#state === 'paused' && this.#saved && cause !== 'sync') {
      this.#saved.restorable = false;
    }
  }

  #writeCamera(scene: SceneLike, cause: CameraCause): void {
    const camera = scene.readCamera();
    if (!camera) {
      return;
    }
    this.#session.camera.set(camera, { view: '3d', cause });
    // 覆盖物按整数级别求值，换了一级才重新推导（ADR 0080 第 1 节）
    if (this.#overlays.length > 0 && Math.round(camera.zoom) !== this.#overlayLevel) {
      this.#applyOverlays(scene);
    }
  }

  #onStyleChange(scene: SceneLike): void {
    if (this.#state === 'ready') {
      this.#applyStyle(scene);
    } else if (this.#state === 'paused') {
      this.#styleStale = true;
    }
  }

  // 按支持清单把样式镜像到场景；不支持的图层每个只报告一次，数据源不在了的错误一并忘掉
  #applyStyle(scene: SceneLike): void {
    this.#styleStale = false;
    const plan = planSceneStyle(this.#session.style.current);
    scene.setImagery(plan.imagery);
    scene.setBaseColor(plan.baseColor);
    this.#overlays = plan.overlays;
    this.#download(plan.overlays);
    this.#applyOverlays(scene);
    for (const layer of plan.unsupported) {
      if (!this.#reported.has(layer.layerId)) {
        this.#reported.add(layer.layerId);
        this.#onUnsupported(layer);
      }
    }
    const sources = new Set([...plan.imagery, ...plan.overlays].map(({ sourceId }) => sourceId));
    const remaining = [...this.#sourceErrors].filter(([sourceId]) => sources.has(sourceId));
    if (remaining.length !== this.#sourceErrors.size) {
      this.#setSourceErrors(remaining.length > 0 ? new Map(remaining) : NO_SOURCE_ERRORS);
    }
  }

  #applyOverlays(scene: SceneLike): void {
    const level = Math.round(this.#session.camera.current.zoom);
    this.#overlayLevel = level;
    scene.setOverlays(planOverlays(this.#overlays, spec => this.#overlayData(spec), level));
  }

  #overlayData({ data }: OverlaySpec): GeoJSON | undefined {
    if (typeof data !== 'string') {
      return data;
    }
    const remote = this.#remote.get(data);
    return remote?.state === 'ready' ? remote.data : undefined;
  }

  // 地址上的数据每个地址下载一次；失败的地址不再被样式引用时忘掉，再次引用时重新下载
  #download(overlays: readonly OverlaySpec[]): void {
    const urls = new Set(overlays.flatMap(({ data }) => (typeof data === 'string' ? [data] : [])));
    for (const [url, remote] of this.#remote) {
      if (remote.state === 'failed' && !urls.has(url)) {
        this.#remote.delete(url);
      }
    }
    for (const url of urls) {
      if (!this.#remote.has(url)) {
        this.#remote.set(url, { state: 'loading' });
        void this.#downloadOne(url);
      }
    }
  }

  async #downloadOne(url: string): Promise<void> {
    const { signal } = this.#downloads;
    try {
      const data = await this.#loadJson(url, signal);
      if (signal.aborted) {
        return;
      }
      if (!isGeoJson(data)) {
        throw new Error(`${url} 的内容不是 GeoJSON`);
      }
      this.#remote.set(url, { state: 'ready', data });
      this.#onDownloaded();
    } catch (error) {
      if (signal.aborted) {
        return;
      }
      this.#remote.set(url, { state: 'failed' });
      // 引用这个地址的数据源都记一条错误，按二维的数据源 ID（ADR 0041）
      for (const { sourceId, data } of this.#overlays) {
        if (data === url) {
          this.#recordSourceError(sourceId, error);
        }
      }
    }
  }

  // 数据到了：就绪时立即画，暂停时等恢复
  #onDownloaded(): void {
    const scene = this.#scene;
    if (this.#state === 'ready' && scene) {
      this.#guard(() => this.#applyOverlays(scene));
    } else if (this.#state === 'paused') {
      this.#styleStale = true;
    }
  }

  #onSceneChange(scene: SceneLike): void {
    if (this.#state === 'ready') {
      this.#applyScene(scene);
      this.#applyRoam(scene, true);
    } else if (this.#state === 'paused') {
      this.#sceneStale = true;
    }
  }

  // 按会话的三维内容增删瓦片集：地址、重试次数变了就重新加载，其余的只改显示和光照
  #applyScene(scene: SceneLike): void {
    this.#sceneStale = false;
    const { tilesets, underground } = this.#session.scene.current;
    const wanted = new Map(tilesets.map(layer => [layer.id, layer]));
    let changed = false;
    for (const [id, entry] of this.#tilesets) {
      const layer = wanted.get(id);
      if (!layer || layer.url !== entry.layer.url || layer.attempt !== entry.layer.attempt) {
        entry.controller.abort();
        if (entry.applied) {
          scene.removeTileset(id);
        }
        this.#tilesets.delete(id);
        changed = true;
      }
    }
    for (const layer of tilesets) {
      const entry = this.#tilesets.get(layer.id);
      if (entry) {
        entry.layer = layer;
      } else {
        this.#loadTileset(scene, layer);
        changed = true;
      }
    }
    this.#applyVisibility(scene);
    scene.setUnderground(underground);
    if (changed) {
      this.#publishSceneStatus();
    }
  }

  #loadTileset(scene: SceneLike, layer: TilesetLayer): void {
    const entry: TilesetEntry = {
      layer,
      controller: new AbortController(),
      status: { state: 'loading' },
      applied: null,
      initial: false
    };
    this.#tilesets.set(layer.id, entry);
    void this.#prepareAndAdd(scene, entry);
  }

  // 整理索引、交给场景；中止的不报告，失败记进状态
  async #prepareAndAdd(scene: SceneLike, entry: TilesetEntry): Promise<void> {
    const { signal } = entry.controller;
    try {
      const prepared = await prepareTileset(entry.layer.url, this.#loadJson, signal);
      signal.throwIfAborted();
      const options = this.#optionsFor(entry);
      const camera = await scene.addTileset(entry.layer.id, prepared, options, signal);
      signal.throwIfAborted();
      entry.applied = options;
      entry.status = { state: 'ready', camera };
      this.#applyVisibility(scene);
    } catch (error) {
      if (signal.aborted) {
        return;
      }
      entry.status = { state: 'failed', error };
    }
    this.#publishSceneStatus();
  }

  // 同组（白膜的各种效果）要显示的那个首批瓦片到了，才撤下上一个（ADR 0081 第 5 节）
  #optionsFor({ layer }: TilesetEntry): TilesetOptions {
    if (layer.group === undefined || layer.show) {
      return { show: layer.show, lighting: layer.lighting };
    }
    const requested = this.#requestedIn(layer.group);
    const kept = requested !== undefined && !requested.initial && this.#groupShown.get(layer.group) === layer.id;
    return { show: kept, lighting: layer.lighting };
  }

  #requestedIn(group: string): TilesetEntry | undefined {
    return [...this.#tilesets.values()].find(({ layer }) => layer.group === group && layer.show);
  }

  #applyVisibility(scene: SceneLike): void {
    const groups = new Set([...this.#tilesets.values()].flatMap(({ layer }) => (layer.group ? [layer.group] : [])));
    for (const group of this.#groupShown.keys()) {
      groups.add(group);
    }
    for (const group of groups) {
      const requested = this.#requestedIn(group);
      if (!requested) {
        this.#groupShown.delete(group);
      } else if (requested.initial) {
        this.#groupShown.set(group, requested.layer.id);
      }
    }
    for (const entry of this.#tilesets.values()) {
      const options = this.#optionsFor(entry);
      if (entry.applied && !sameOptions(entry.applied, options)) {
        scene.updateTileset(entry.layer.id, options);
        entry.applied = options;
      }
    }
  }

  #onTilesetInitial(scene: SceneLike, id: string): void {
    const entry = this.#tilesets.get(id);
    if (entry && !entry.initial) {
      entry.initial = true;
      this.#applyVisibility(scene);
    }
  }

  // 瓦片失败：每个瓦片集记第一条，重试（换重试次数）后重新开始
  #onTilesetFailed(id: string, error: unknown): void {
    const entry = this.#tilesets.get(id);
    if (entry && entry.status.state !== 'failed') {
      entry.status = { state: 'failed', error };
      this.#publishSceneStatus();
    }
  }

  #publishSceneStatus(): void {
    this.#sceneStatus = new Map([...this.#tilesets].map(([id, { status }]) => [id, status]));
    this.#emitter.emit('scenestatuschange', this.#sceneStatus);
  }

  // 场景在播放路线：相机的变化都是漫游引起的
  #roaming(): boolean {
    return this.#roam !== null && !this.#roam.detached;
  }

  // 按会话的漫游意图开始、重新开始、改播放或结束（ADR 0083 第 3 节）；只在就绪时调用，back 决定结束时是否飞回
  #applyRoam(scene: SceneLike, back: boolean): void {
    const wanted = this.#session.scene.current.roam;
    const entry = this.#roam;
    if (!wanted) {
      if (entry) {
        this.#roam = null;
        if (!entry.detached) {
          scene.stopRoute(back);
        }
        this.#publishRoam(null);
      }
      return;
    }
    if (!entry || entry.roam.id !== wanted.id) {
      const path = new RoutePath(wanted.path);
      this.#roam = { roam: wanted, path, detached: false };
      scene.startRoute(path);
      scene.setRoutePlayback({ playing: wanted.playing, rate: wanted.rate });
      this.#publishRoam({ id: wanted.id, run: wanted.run, distance: 0, total: path.total, finished: false });
      return;
    }
    const previous = entry.roam;
    entry.roam = wanted;
    if (entry.detached) {
      return;
    }
    if (wanted.run !== previous.run) {
      scene.restartRoute();
      this.#publishRoam({ id: wanted.id, run: wanted.run, distance: 0, total: entry.path.total, finished: false });
    }
    if (wanted.playing !== previous.playing || wanted.rate !== previous.rate) {
      scene.setRoutePlayback({ playing: wanted.playing, rate: wanted.rate });
    }
  }

  // 页面开始了别的定位：路线立即停下、不飞回，相机交给这次定位；拥有者随后会撤掉漫游
  #detachRoam(scene: SceneLike): void {
    if (this.#roaming() && this.#roam) {
      this.#roam.detached = true;
      scene.stopRoute(false);
    }
  }

  #onRouteProgress(distance: number): void {
    const entry = this.#roam;
    const status = this.#roamStatus;
    if (!entry || entry.detached || !status) {
      return;
    }
    const total = entry.path.total;
    if (Math.abs(distance - status.distance) >= ROAM_REPORT_STEP || (distance >= total && status.distance < total)) {
      this.#publishRoam({ ...status, distance: Math.min(distance, total) });
    }
  }

  #onRouteEnd(): void {
    const entry = this.#roam;
    const status = this.#roamStatus;
    if (entry && !entry.detached && status) {
      this.#publishRoam({ ...status, distance: entry.path.total, finished: true });
    }
  }

  #publishRoam(status: RoamStatus | null): void {
    this.#roamStatus = status;
    this.#emitter.emit('roamstatuschange', status);
  }

  // 只有就绪的视图把输入交给工具：二三维切换时只有当前显示的视图在转交（ADR 0034 第 3 条）；
  // 临时拖动的松开和派生的单击不交给工具（ADR 0056 第 2 节）
  #onInput(event: MapInputEvent): void {
    if (this.#state === 'ready' && (event.type === 'key' || this.#pan?.swallows(event.type) !== true)) {
      this.#session.tool.dispatch(event, this.#toolView);
    }
  }

  // 切换工具时结束临时拖动
  #onToolChange(scene: SceneLike): void {
    this.#pan?.cancel();
    if (this.#state === 'ready') {
      this.#applyTool(scene);
    }
  }

  // 光标和手势是当前工具的声明（ADR 0079 第 6 节）；临时任务把焦点移到画布上，Esc 才能直接退出
  #applyTool(scene: SceneLike): void {
    const { gestures, persistent } = this.#session.tool.activeTool;
    this.#applyCursor(scene);
    scene.setGestures({ drag: gestures?.dragPan !== false });
    if (!persistent) {
      scene.focus();
    }
  }

  // 工具声明的光标，按住修饰键、临时拖动时换成手型（ADR 0056 第 2 节）
  #applyCursor(scene: SceneLike): void {
    const { cursor } = this.#session.tool.activeTool;
    const shown = this.#pan?.cursor(cursor) ?? cursor ?? '';
    scene.setCursor(shown === '' ? undefined : shown);
  }

  // 暂停时显示的是另一个视图，不算画面稳定
  #onSettle(): void {
    if (this.#state === 'ready') {
      this.#emitter.emit('settle');
    }
  }

  // 每个数据源只记第一条
  #recordSourceError(sourceId: string, error: unknown): void {
    if (this.#sourceErrors.has(sourceId)) {
      return;
    }
    this.#setSourceErrors(new Map([...this.#sourceErrors, [sourceId, error]]));
  }

  #setSourceErrors(errors: SourceErrors): void {
    this.#sourceErrors = errors;
    this.#emitter.emit('sourceerrorchange', errors);
  }

  #readyScene(): SceneLike {
    this.#assertAlive();
    if (this.#state !== 'ready' || !this.#scene) {
      throw new Error(`CesiumView 当前状态为 ${this.#state}，只能在 ready 时定位、拾取、投影和查询`);
    }
    return this.#scene;
  }

  // 创建场景失败、渲染出错都是引擎失败：不能恢复，只能释放后重新创建视图（ADR 0030）
  #fail(error: unknown): void {
    this.#ready.reject(error);
    const cause = error instanceof WebGLUnavailableError ? 'webgl-unavailable' : 'unknown';
    this.#setState('failed', { kind: 'engine', cause, error });
    this.#onError(error);
  }

  #setState(state: LiveViewState, failure: MapViewFailure | null = null): void {
    const nextFailure = state === 'failed' ? failure : null;
    if (this.#state === state && this.#failure === nextFailure) {
      return;
    }
    if (!canTransition(this.#state, this.#failure, state)) {
      this.#onError(new Error(`CesiumView 不能从 ${this.#state} 转换到 ${state}`));
      return;
    }
    this.#state = state;
    this.#failure = nextFailure;
    this.#emitter.emit('statechange', state);
  }

  // 场景的事件回调里不能抛错，否则会打断它自己的事件分发
  #guard(callback: () => void): void {
    try {
      callback();
    } catch (error) {
      this.#onError(error);
    }
  }

  #assertAlive(): void {
    if (this.#state === 'disposed') {
      throw new Error('CesiumView 已释放');
    }
  }
}
