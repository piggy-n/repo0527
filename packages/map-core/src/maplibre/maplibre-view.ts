import type { ProjectionSpecification } from '@maplibre/maplibre-gl-style-spec';
import { GPUInitializationError, LngLat as MapLibreLngLat, Map as MapLibreMap } from 'maplibre-gl';
import { safeReporter } from '@mx/utils';
import { createNanoEvents } from 'nanoevents';
import type { CameraCause, CameraState, ViewKind } from '../camera/camera-model';
import type { Unsubscribe } from '../events';
import type { LoadJson } from '../scene/prepare-tileset';
import { NO_SCENE_STATUS, type RoamStatus, type SceneStatus } from '../scene/scene-content-model';
import type { MapSession } from '../session/map-session';
import { diffSnapshot, type StyleCommand, type StyleSnapshot } from '../style/diff-style';
import type { StyleImages } from '../style/style-image';
import type { StyleChange } from '../style/style-model';
import type { Gestures, ToolView } from '../tool/tool-model';
import {
  type FitBoundsOptions,
  type FlyToOptions,
  type MapView,
  type MapViewFailure,
  NO_SOURCE_ERRORS,
  type SourceErrors,
  type ViewBounds,
  type ViewPadding,
  type ViewState
} from '../view/map-view';
import type { RenderedFeature, RenderedQueryOptions, ScreenBox } from '../view/rendered-features';
import type { LngLat, MapInputEvent, MapPointerEvent, PickOptions, PickResult, ScreenPoint } from '../view/view-input';
import { canTransition, deferred, type LiveViewState } from '../view/view-lifecycle';
import { applyStyleCommand } from './apply-style-command';
import { sameCenterOnGlobe, zoomFlightDuration } from './globe-fly';
import type {
  CameraTransformLike,
  MapLibreMapOptions,
  MapLike,
  MapMouseEventLike,
  MapMouseEventType,
  MapMoveEventLike
} from './map-like';
import { MapLibreScene, type SceneModuleState } from './maplibre-scene';
import { MapLibreRoam } from './roam/maplibre-roam';
import type { SceneRendererLoader } from './scene-renderer';
import { ModifierPan } from '../view/modifier-pan';

export interface MapLibreViewOptions<G extends string> {
  readonly session: MapSession<G>;
  readonly container: HTMLElement;
  /** 创建后是否显示，默认 true；为 false 时加载完成后进入 paused */
  readonly active?: boolean;
  /** minZoom、maxZoom、transformRequest 等，由页面提供 */
  readonly mapOptions?: Omit<MapLibreMapOptions, 'container' | 'style' | 'center' | 'zoom' | 'bearing' | 'pitch'>;
  /** 测试时换成假地图 */
  readonly createMap?: (options: MapLibreMapOptions) => MapLike;
  /** 运行中的错误：MapLibre 的 error 事件、应用命令失败、数据更新失败；默认打印到控制台 */
  readonly onError?: (error: unknown) => void;
  /** 滚轮缩放的速率；不传的一项用 MapLibre 的默认值（滚轮 1/450、触控板 1/100） */
  readonly scrollZoomRates?: ScrollZoomRates;
  /** 三维的缩放上限；不给时同二维（`mapOptions.maxZoom`） */
  readonly sceneMaxZoom?: number;
  /**
   * MapLibre 引擎的三维（ADR 0147 第 2 节）：给出时这个视图同时担任二维和三维，第一次要加瓦片集时加载渲染器；
   * 不给时只有二维
   */
  readonly loadSceneRenderer?: SceneRendererLoader;
  /** 下载瓦片集的索引；默认用 fetch，测试时换掉 */
  readonly loadJson?: LoadJson;
}

/** 滚轮缩放的速率（ADR 0053 第 3 节）：wheel 是普通鼠标的滚轮，trackpad 是触控板，数值越小越慢 */
export interface ScrollZoomRates {
  readonly wheel?: number;
  readonly trackpad?: number;
}

interface MapLibreViewEvents {
  statechange: (state: ViewState) => void;
  resize: () => void;
  settle: () => void;
  sourceerrorchange: (errors: SourceErrors) => void;
  scenestatuschange: (status: SceneStatus) => void;
  roamstatuschange: (status: RoamStatus | null) => void;
}

/**
 * 地图上的样式：整体加载中、已加载（即已应用的快照）、加载失败（ADR 0026）
 * 失败时也记下快照：之后 style.load 仍然到达时，以它为已加载
 */
interface MapStyle extends StyleSnapshot {
  readonly status: 'loading' | 'loaded' | 'failed';
  readonly revision: number;
}

const CAMERA_CAUSES: readonly string[] = ['user', 'program', 'sync'] satisfies CameraCause[];

// 三维的投影和俯角上限（ADR 0147 第 2 节）：MapLibre 的地球预设在 z11～12 过渡到墨卡托；二维沿用页面的上限，没给时同 MapLibre 的 60
const GLOBE: ProjectionSpecification = Object.freeze({ type: 'globe' });
const MERCATOR: ProjectionSpecification = Object.freeze({ type: 'mercator' });
const MAX_PITCH_3D = 85;
const DEFAULT_MAX_PITCH = 60;
// MapLibre 默认的缩放上限：页面没给 maxZoom 时二维用它
const DEFAULT_MAX_ZOOM = 22;

function isCameraCause(value: unknown): value is CameraCause {
  return typeof value === 'string' && CAMERA_CAUSES.includes(value);
}

// 有原始 DOM 事件就是用户操作；否则看 jumpTo 等方法带的 eventData，都没有按程序定位处理
function causeOfMove({ originalEvent, cause }: MapMoveEventLike): CameraCause {
  if (originalEvent !== undefined) {
    return 'user';
  }
  return isCameraCause(cause) ? cause : 'program';
}

// MapLibre 合并默认选项时，值为 undefined 的键会覆盖默认值（例如 fitBounds 的 maxZoom 变成 undefined，中心点算出 NaN）
function withoutUndefined<T extends object>(options: T): T {
  return Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined)) as T;
}

// 去掉四边留白后的区域中心相对画布中心的偏移：左边留得多就往右移，上边留得多就往下移
function centerOffset(padding: ViewPadding): [number, number] {
  if (typeof padding === 'number') {
    return [0, 0];
  }
  const { top, right, bottom, left } = padding;
  return [(left - right) / 2, (top - bottom) / 2];
}

// 地图的鼠标事件对应的工具输入（ADR 0034 第 1 条）
const POINTER_TYPES: Readonly<Record<MapMouseEventType, MapPointerEvent['type']>> = {
  mousedown: 'down',
  mousemove: 'move',
  mouseup: 'up',
  click: 'click',
  dblclick: 'dblclick',
  mouseout: 'leave'
};

const GESTURES: readonly (keyof Gestures)[] = ['dragPan', 'doubleClickZoom', 'boxZoom'];

function toPointerEvent(type: MapMouseEventType, { point, originalEvent }: MapMouseEventLike): MapPointerEvent {
  return {
    type: POINTER_TYPES[type],
    point: { x: point.x, y: point.y },
    button: originalEvent.button,
    clickCount: originalEvent.detail,
    modifiers: {
      shift: originalEvent.shiftKey,
      ctrl: originalEvent.ctrlKey,
      alt: originalEvent.altKey,
      meta: originalEvent.metaKey
    }
  };
}

// MapLibre 相机当前的变换：换投影时整个换掉，每次现取（见 CameraTransformLike）
function cameraTransform(map: MapLike): CameraTransformLike {
  // oxlint-disable-next-line no-underscore-dangle -- MapLibre 6.12 只在 _camera 上提供相机的变换，没有公开的方法
  return map._camera.transform;
}

function createMapLibreMap(options: MapLibreMapOptions): MapLike {
  return new MapLibreMap(options);
}

function reportToConsole(error: unknown): void {
  console.error('[MapLibreView]', error);
}

async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`下载 ${url} 失败：${response.status}`);
  }
  const data: unknown = await response.json();
  return data;
}

/**
 * 二维视图：唯一写 MapLibre 地图的地方，把会话的样式和相机同步到地图（ADR 0020、0022、0024、0026）。
 * 给了三维渲染器时同时担任三维（ADR 0147 第 2 节），种类随上下文的维度切换
 */
export class MapLibreView<const G extends string> implements MapView {
  /** 支持的种类 */
  readonly kinds: readonly ViewKind[];
  #kind: ViewKind = '2d';
  readonly #session: MapSession<G>;
  readonly #map: MapLike | undefined;
  // 按住修饰键临时拖动（ADR 0056）；和地图一起创建
  readonly #pan: ModifierPan | undefined;
  readonly #onError: (error: unknown) => void;
  readonly #emitter = createNanoEvents<MapLibreViewEvents>();
  readonly #stack: DisposableStack;
  // 当前这一轮整体加载的结果（创建地图、整体重建、重新加载各算一轮），本轮的成功、失败、释放都结束它
  #ready = deferred();
  // 地图本身的生命周期；对外的 state、failure 在地图就绪时按当前种类给出（见 #presented）
  #state: ViewState = 'initializing';
  #failure: MapViewFailure | null = null;
  // 最近一次通知出去的对外状态：变化时才发 statechange
  #shownState: ViewState = 'initializing';
  #shownFailure: MapViewFailure | null = null;
  // 三维模块加载失败的原因，加载状态变化时换掉
  #moduleFailure: MapViewFailure | null = null;
  // 二维的俯角上限：页面的 maxPitch，没给时同 MapLibre
  readonly #maxPitch2d: number;
  // 二、三维的缩放上限：页面的 maxZoom（没给时同 MapLibre）和 sceneMaxZoom（没给时同二维）
  readonly #maxZoom2d: number;
  readonly #maxZoom3d: number;
  #sourceErrors = NO_SOURCE_ERRORS;
  #active: boolean;
  #mapStyle: MapStyle;
  // 正在进行的定位动画（flyTo、fitBounds）怎样直接到终点；动画结束、被打断时为 null
  #finishAnimation: (() => void) | null = null;
  // 应用增量命令期间同步收到的 error 事件：MapLibre 的很多方法校验失败时不抛错，只发事件
  #applying = false;
  #rejected = false;
  // 当前工具让视图关掉的手势；切换工具时只恢复这些，页面创建地图时就关掉的不会被打开
  readonly #disabledGestures = new Set<keyof Gestures>();
  // 三维内容（ADR 0147 第 2 节）；没给渲染器、地图没创建出来时没有
  readonly #scene: MapLibreScene | undefined;
  // 漫游（ADR 0147 第 4 节）：和三维内容一起创建
  readonly #roam: MapLibreRoam | undefined;
  // 漫游抬高期间二维图层隐藏着：应用样式命令、整体重建以后再隐藏一遍
  #layersHidden = false;
  // 交给工具的视图能力：只有种类、拾取、投影和渲染要素查询（ADR 0034 第 2 条、ADR 0047 第 4 节）；种类随维度变化
  readonly #toolView: ToolView = (() => {
    const currentKind = () => this.#kind;
    return Object.freeze({
      get kind(): ViewKind {
        return currentKind();
      },
      pick: (point: ScreenPoint, options?: PickOptions) => this.pick(point, options),
      project: (lngLat: LngLat, height?: number) => this.project(lngLat, height),
      queryRendered: (area: ScreenPoint | ScreenBox, options: RenderedQueryOptions) => this.queryRendered(area, options)
    });
  })();

  constructor({
    session,
    container,
    active = true,
    mapOptions,
    createMap = createMapLibreMap,
    onError = reportToConsole,
    scrollZoomRates,
    sceneMaxZoom,
    loadSceneRenderer,
    loadJson = fetchJson
  }: MapLibreViewOptions<G>) {
    this.#session = session;
    this.#active = active;
    this.kinds = loadSceneRenderer ? ['2d', '3d'] : ['2d'];
    this.#maxPitch2d = mapOptions?.maxPitch ?? DEFAULT_MAX_PITCH;
    this.#maxZoom2d = mapOptions?.maxZoom ?? DEFAULT_MAX_ZOOM;
    this.#maxZoom3d = sceneMaxZoom ?? this.#maxZoom2d;
    // 报告器自己抛错时不能打断状态转换和资源释放，也不能冒进 MapLibre 的事件分发
    this.#onError = safeReporter(onError, 'MapLibreView');
    const { current: style, images, revision, sceneBefore } = session.style;
    this.#mapStyle = { status: 'loading', revision, style, images, sceneBefore };

    using stack = new DisposableStack();
    stack.defer(() => this.#ready.reject(new DOMException('MapLibreView 已释放', 'AbortError')));

    let map: MapLike;
    try {
      const {
        center: [lng, lat],
        zoom,
        bearing,
        pitch
      } = session.camera.current;
      map = createMap({
        // 不用 MapLibre 的版权控件：右下角是基础组，署名由页面决定（ADR 0053 第 5 节）
        attributionControl: false,
        ...mapOptions,
        container,
        style,
        center: [lng, lat],
        zoom,
        bearing,
        pitch
      });
    } catch (error) {
      // 例如不支持 WebGL2 时的 GPUInitializationError：不抛出，交给 whenReady 和 statechange 表达
      this.#map = undefined;
      this.#pan = undefined;
      this.#scene = undefined;
      this.#roam = undefined;
      this.#stack = stack.move();
      this.#fail(error);
      return;
    }
    this.#map = map;
    stack.defer(() => map.remove());
    this.#pan = stack.use(
      new ModifierPan({
        container: map.getCanvasContainer(),
        // 地图内容跟着指针走，视野反向移动
        pan: (from, to) => map.panBy([from.x - to.x, from.y - to.y], { animate: false }, { cause: 'user' }),
        modifier: () => (this.state === 'ready' ? (this.#session.tool.activeTool.panModifier ?? null) : null),
        // 没有就绪时不应用光标，进入 ready 时按当前工具应用
        onCursorChange: () => {
          if (this.#state === 'ready') {
            this.#applyCursor(map);
          }
        },
        guard: callback => this.#guard(callback)
      })
    );
    if (scrollZoomRates?.wheel !== undefined) {
      map.scrollZoom.setWheelZoomRate(scrollZoomRates.wheel);
    }
    if (scrollZoomRates?.trackpad !== undefined) {
      map.scrollZoom.setZoomRate(scrollZoomRates.trackpad);
    }
    for (const subscription of [
      map.on('style.load', () => this.#guard(() => this.#onStyleLoad(map))),
      map.on('error', ({ error, sourceId }) => this.#guard(() => this.#onMapError(map, error, sourceId))),
      map.on('move', event => this.#guard(() => this.#onMove(map, event))),
      map.on('movestart', event => this.#guard(() => this.#onMoveStart(event))),
      // 动画到达终点、被打断都算结束：暂停时不再需要直接到终点
      map.on('moveend', () => (this.#finishAnimation = null)),
      map.on('resize', () => this.#guard(() => this.#emitter.emit('resize'))),
      map.on('idle', () => this.#guard(() => this.#onIdle()))
    ]) {
      stack.defer(() => subscription.unsubscribe());
    }
    // 漫游先于三维内容释放：它还要用渲染器
    this.#scene = loadSceneRenderer
      ? stack.use(
          new MapLibreScene({
            map,
            scene: session.scene,
            loadRenderer: loadSceneRenderer,
            loadJson,
            onError: this.#onError,
            onStatus: status => this.#onSceneStatus(status),
            onModuleChange: state => this.#onModuleChange(state),
            onContent: content => this.#guard(() => this.#roam?.apply(content, true))
          })
        )
      : undefined;
    this.#roam = loadSceneRenderer
      ? stack.use(
          new MapLibreRoam({
            map,
            cameraTransform: () => cameraTransform(map),
            container,
            renderer: () => this.#scene?.renderer ?? null,
            tilesetState: id => this.#scene?.status.get(id)?.state,
            currentCamera: () => this.#session.camera.current,
            flyTo: (camera, duration) => this.#guard(() => this.#fly(map, camera, { duration })),
            onTakeover: state => this.#guard(() => this.#onRoamTakeover(map, state)),
            onStatus: status => this.#emitter.emit('roamstatuschange', status)
          })
        )
      : undefined;
    if (this.#scene) {
      const scene = this.#scene;
      for (const subscription of [
        map.on('render', () => this.#guard(() => scene.endFrame())),
        map.on('webglcontextlost', () => this.#guard(() => scene.loseContext()))
      ]) {
        stack.defer(() => subscription.unsubscribe());
      }
    }
    for (const type of Object.keys(POINTER_TYPES) as MapMouseEventType[]) {
      const subscription = map.on(type, event =>
        this.#guard(() => {
          const input = toPointerEvent(type, event);
          // 当前工具接管这次按下（如拖动编辑的节点）时不平移地图（ADR 0122）
          if (input.type === 'down' && input.button === 0 && this.#capturesPress(input.point)) {
            event.preventDefault();
          }
          this.#onInput(input);
        })
      );
      stack.defer(() => subscription.unsubscribe());
    }
    // 按键只在地图获得焦点时收到，不影响页面上其他输入框
    const canvasContainer = map.getCanvasContainer();
    const onKeyDown = ({ key }: KeyboardEvent) => this.#guard(() => this.#onInput({ type: 'key', key }));
    canvasContainer.addEventListener('keydown', onKeyDown);
    stack.defer(() => canvasContainer.removeEventListener('keydown', onKeyDown));
    stack.defer(session.style.on('change', change => this.#onStyleChange(change)));
    stack.defer(session.tool.on('change', () => this.#guard(() => this.#onToolChange())));
    this.#stack = stack.move();
  }

  /** 当前的种类：只支持二维的视图总是 2d */
  get kind(): ViewKind {
    return this.#kind;
  }

  /** 地图就绪时按当前种类给出：三维在三维模块加载中是 initializing，加载失败是 failed（原因是 module） */
  get state(): ViewState {
    return this.#presented().state;
  }

  /** 三维内容的加载状态（ADR 0081 第 2 节）；显示二维时为空 */
  get sceneStatus(): SceneStatus {
    return this.#kind === '3d' ? (this.#scene?.status ?? NO_SCENE_STATUS) : NO_SCENE_STATUS;
  }

  onSceneStatusChange(callback: (status: SceneStatus) => void): Unsubscribe {
    return this.on('scenestatuschange', callback);
  }

  /** 漫游的进度（ADR 0083、0086、0147 第 4 节）；没有漫游时为 null */
  get roamStatus(): RoamStatus | null {
    return this.#roam?.status ?? null;
  }

  onRoamStatusChange(callback: (status: RoamStatus | null) => void): Unsubscribe {
    return this.on('roamstatuschange', callback);
  }

  /**
   * 换成另一种种类（ADR 0147 第 2 节）：由上下文在切换维度时调用，画布不变；投影、俯角和缩放上限跟着换，相机按会话同步过来。
   * 第一次切到三维时加载三维模块，加上模型层、追上积下的三维内容；切回二维时撤下模型层。不支持的种类抛错
   */
  setKind(kind: ViewKind): void {
    this.#assertAlive();
    if (!this.kinds.includes(kind)) {
      throw new Error(`MapLibreView 不支持 ${kind}`);
    }
    if (kind === this.#kind) {
      return;
    }
    this.#pan?.cancel();
    // 离开三维：漫游停下，地图还原、相机回到开始前（页面切二维前一般已经结束了漫游）
    if (kind !== '3d') {
      this.#guard(() => this.#roam?.suspend());
    }
    this.#kind = kind;
    // 加载失败过的不自动重新加载，等 retry
    if (kind === '3d' && this.#scene?.module.kind === 'idle') {
      this.#scene.load();
    }
    const map = this.#map;
    // 没有就绪时，激活时按当前种类设置
    if (this.#state === 'ready' && map !== undefined) {
      this.#guard(() => this.#applyKind(map));
    }
    this.#syncScene();
    this.#emitter.emit('scenestatuschange', this.sceneStatus);
    this.#notifyState();
  }

  get failure(): MapViewFailure | null {
    return this.#presented().failure;
  }

  /** 当前种类的模块加载失败时重新加载，不重建地图；其他时候什么也不做（引擎失败要重建视图） */
  retry(): void {
    this.#assertAlive();
    if (this.#kind === '3d' && this.#scene?.module.kind === 'failed') {
      this.#scene.load();
    }
  }

  get sourceErrors(): SourceErrors {
    return this.#sourceErrors;
  }

  /** 三维时还要等这一次三维模块的加载 */
  whenReady(): Promise<void> {
    const scene = this.#scene;
    if (this.#kind !== '3d' || scene === undefined) {
      return this.#ready.promise;
    }
    const loaded = scene.whenLoaded();
    return this.#ready.promise.then(() => loaded);
  }

  pause(): void {
    this.#assertAlive();
    this.#active = false;
    this.#pan?.cancel();
    this.#roam?.pause();
    if (this.#state === 'ready') {
      // 还在进行的定位动画直接到终点，在暂停之前按 program 写回会话：暂停期间地图的移动不写回，
      // 恢复时按会话的相机同步，否则会回到动画的中途（页面被缓存时实测，ADR 0063）
      const finish = this.#finishAnimation;
      this.#finishAnimation = null;
      if (finish) {
        this.#guard(finish);
      }
      this.#setState('paused');
    }
  }

  /** 恢复显示：先按容器的尺寸调整画布，再追上暂停期间的样式变化，并把会话相机同步过来 */
  resume(): void {
    this.#assertAlive();
    this.#active = true;
    if (this.#state === 'paused' && this.#map !== undefined) {
      this.#activate(this.#map);
    }
    this.#guard(() => this.#roam?.resume());
  }

  /** 漫游时先让它停下、不飞回，相机交给这次定位 */
  flyTo(camera: Partial<CameraState>, options: FlyToOptions = {}): void {
    const map = this.#readyMap();
    this.#roam?.detach();
    this.#fly(map, camera, options);
  }

  // MapLibre 的 padding 会留在地图上，改变"会话相机的中心就是画布中心"；换成只对这一次有效的 offset（ADR 0037）
  #fly(map: MapLike, { center, zoom, bearing, pitch }: Partial<CameraState>, { duration, padding }: FlyToOptions): void {
    const offset = center && padding !== undefined ? centerOffset(padding) : undefined;
    const options: Parameters<MapLike['flyTo']>[0] = withoutUndefined({
      center: center && [center[0], center[1]],
      zoom,
      bearing,
      pitch,
      duration,
      offset
    });
    if (this.#sameCenterOnGlobe(map, center)) {
      const eased = withoutUndefined({ ...options, duration: duration ?? this.#zoomFlight(map, zoom) });
      map.easeTo(eased, { cause: 'program' });
      this.#animating(eased.duration, () => map.easeTo({ ...eased, duration: 0 }, { cause: 'program' }));
      return;
    }
    map.flyTo(options, { cause: 'program' });
    this.#animating(duration, () => map.flyTo({ ...options, duration: 0 }, { cause: 'program' }));
  }

  // 地球投影下中心不变时不能用 flyTo，见 globe-fly.ts。二维不算路径的 acos，不受影响
  #sameCenterOnGlobe(map: MapLike, center: LngLat | undefined): boolean {
    if (map.getProjection()?.type !== 'globe') {
      return false;
    }
    const { lng, lat } = map.getCenter();
    return !center || sameCenterOnGlobe([lng, lat], center);
  }

  // flyTo 没给时长时自己算，easeTo 的默认时长是固定的；缩放没变时交给 easeTo 的默认值，和 flyTo 这时的做法相同
  #zoomFlight(map: MapLike, zoom: number | undefined): number | undefined {
    return zoom === undefined || zoom === map.getZoom() ? undefined : zoomFlightDuration(map.getZoom(), zoom);
  }

  fitBounds(
    [west, south, east, north]: ViewBounds,
    { padding, maxZoom, duration, pitch }: FitBoundsOptions = {}
  ): void {
    const map = this.#readyMap();
    this.#roam?.detach();
    const bounds: [number, number, number, number] = [west, south, east, north];
    const options = this.#fitOptions(map, bounds, withoutUndefined({ padding, maxZoom, duration, pitch }));
    map.fitBounds(bounds, options, { cause: 'program' });
    this.#animating(options.duration, () => map.fitBounds(bounds, { ...options, duration: 0 }, { cause: 'program' }));
  }

  // fitBounds 默认走 flyTo：目标的中心不变时（定位过以后只缩放过，再定位一次）换成走直线，见 globe-fly.ts
  #fitOptions<Options extends { readonly padding?: ViewPadding; readonly maxZoom?: number; readonly duration?: number }>(
    map: MapLike,
    bounds: [number, number, number, number],
    options: Options
  ): Options & { readonly duration?: number; readonly linear?: true } {
    if (map.getProjection()?.type !== 'globe') {
      return options;
    }
    const target = map.cameraForBounds(bounds, options);
    if (!target?.center) {
      return options;
    }
    const { lng, lat } = MapLibreLngLat.convert(target.center);
    if (!this.#sameCenterOnGlobe(map, [lng, lat])) {
      return options;
    }
    return { ...options, linear: true, ...withoutUndefined({ duration: options.duration ?? this.#zoomFlight(map, target.zoom) }) };
  }

  /**
   * 三维时先打显示着的模型（带椭球高），再打地面，指向天空时是 miss；二维总是命中地图平面，没有高度。
   * 悬停时模型里不打高斯泼溅（ADR 0149）
   */
  pick(point: ScreenPoint, options?: PickOptions): PickResult {
    const map = this.#readyMap();
    if (this.#kind === '3d') {
      const model = this.#scene?.pick(point, options);
      if (model) {
        return { kind: 'hit', surface: 'model', lngLat: model.lngLat, height: model.height };
      }
      // 漫游抬高期间二维隐藏着，地图上的点也不是真实的位置
      if (this.#layersHidden) {
        return { kind: 'miss' };
      }
      // 俯角大时地平线以上是天空，地球投影时球外也是：MapLibre 的 unproject 仍会给出一个地面上的点
      if (!cameraTransform(map).isPointOnMapSurface(point)) {
        return { kind: 'miss' };
      }
    }
    const { lng, lat } = map.unproject([point.x, point.y]);
    return { kind: 'hit', surface: 'map', lngLat: [lng, lat] };
  }

  /**
   * 二维忽略高度，结果可能在画布之外；三维时不在地面上的点按模型层最近一帧的相机投影，
   * 还没画过、在相机背后时为 null（地面上的点两种算法相差不到 0.1 像素，用 MapLibre 的），地面上的点在地球背面时为 null
   */
  project(lngLat: LngLat): ScreenPoint;
  project(lngLat: LngLat, height?: number): ScreenPoint | null;
  project([lng, lat]: LngLat, height?: number): ScreenPoint | null {
    const map = this.#readyMap();
    if (this.#kind === '3d') {
      // 漫游抬高期间地面上的点也跟着抬高，由渲染器加上抬高量
      if ((height !== undefined && height !== 0) || (this.#roam?.lift ?? 0) > 0) {
        return this.#scene?.project([lng, lat], height ?? 0) ?? null;
      }
      if (cameraTransform(map).isLocationOccluded({ lng, lat })) {
        return null;
      }
    }
    const { x, y } = map.project([lng, lat]);
    return { x, y };
  }

  /** 三维时视点在海平面以上的高度（米），来自 MapLibre 自己的相机，漫游抬高期间减掉抬高量；二维时为 null */
  eyeHeight(): number | null {
    const map = this.#readyMap();
    return this.#kind === '3d' ? cameraTransform(map).getCameraAltitude() - (this.#roam?.lift ?? 0) : null;
  }

  /** 三维时视点的朝向（度，正北为 0、顺时针，0～360）；二维时为 null */
  heading(): number | null {
    const map = this.#readyMap();
    return this.#kind === '3d' ? ((map.getBearing() % 360) + 360) % 360 : null;
  }

  /** 这些数据源在已应用的样式里的图层上画出的要素，从上到下；几何只在要时换算 */
  queryRendered(
    area: ScreenPoint | ScreenBox,
    { sources, withGeometry = false }: RenderedQueryOptions
  ): RenderedFeature[] {
    const map = this.#readyMap();
    // 就绪后整体重建时状态仍是 ready，但新样式的图层要等加载完成才能查询
    if (this.#mapStyle.status !== 'loaded') {
      return [];
    }
    const wanted = new Set(sources);
    // 按加载完成的样式找图层，传给 MapLibre 的图层都存在
    const layers = this.#mapStyle.style.layers.flatMap(layer =>
      'source' in layer && wanted.has(layer.source) ? [layer.id] : []
    );
    if (layers.length === 0) {
      return [];
    }
    const geometry: [number, number] | [[number, number], [number, number]] =
      'x' in area
        ? [area.x, area.y]
        : [
            [area.from.x, area.from.y],
            [area.to.x, area.to.y]
          ];
    return map.queryRenderedFeatures(geometry, { layers }).map(feature => {
      const { source, layer, properties } = feature;
      return withGeometry
        ? { sourceId: source, layerId: layer.id, properties, geometry: feature.geometry }
        : { sourceId: source, layerId: layer.id, properties };
    });
  }

  on<E extends keyof MapLibreViewEvents>(event: E, callback: MapLibreViewEvents[E]): Unsubscribe {
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
    this.#emitter.events = {};
    this.#stack.dispose();
  }

  #onStyleLoad(map: MapLike): void {
    if (this.#engineFailed) {
      return;
    }
    // failed：之前的 error 并不致命，加载最终完成了，以 style.load 为准
    if (this.#mapStyle.status !== 'loaded') {
      this.#mapStyle = { ...this.#mapStyle, status: 'loaded' };
    }
    this.#addImages(map, this.#mapStyle.images);
    if (this.#state === 'ready') {
      this.#catchUp(map);
      // 运行中的整体重建完成并追上了；追赶又触发了重建时，本轮延续到那一次加载
      if (this.#mapStyle.status === 'loaded') {
        this.#ready.resolve();
      }
      // 整体加载的新样式带着自己的投影：按当前种类再设一次；地图上的全部图层也换了，三维模型层要重新加上，
      // 漫游抬高期间新的图层也要隐藏
      this.#applyProjection(map);
      this.#syncScene();
      if (this.#layersHidden) {
        this.#setLayersVisible(map, false);
      }
    } else if (this.#active) {
      // 首次加载、失败后恢复，或者恢复显示时因整体重建而中断的激活
      this.#activate(map);
    } else {
      // 包括暂停期间完成的加载：和以 active: false 创建时一样，样式加载完成本轮就结束
      this.#enter('paused');
    }
  }

  #onMapError(map: MapLike, error: Error, sourceId: unknown): void {
    this.#onError(error);
    if (this.#engineFailed) {
      return;
    }
    // 数据源的错误只记下来：不算样式加载失败，应用命令期间收到也不整体重建（ADR 0041 第 6 节）
    if (typeof sourceId === 'string') {
      this.#recordSourceError(sourceId, error);
      return;
    }
    if (this.#applying) {
      this.#rejected = true;
      return;
    }
    if (this.#mapStyle.status !== 'loading') {
      return;
    }
    // 整份样式校验失败时 MapLibre 只发 error，不会再有 style.load
    this.#mapStyle = { ...this.#mapStyle, status: 'failed' };
    if (this.#session.style.revision > this.#mapStyle.revision) {
      // 加载期间已经有了更新的提交：不进入 failed，直接用最新的快照再加载；
      // 放到微任务里，等 MapLibre 发完这次加载的全部错误再调用 setStyle，不在它分发事件的过程中重入
      queueMicrotask(() => this.#reloadIfNewer(map));
      return;
    }
    this.#ready.reject(error);
    this.#setState('failed', { kind: 'style', error });
  }

  // 首次进入 ready 和恢复显示共用：先追上样式，相机先跟随会话、再把地图的实际值写回，最后才进入 ready
  #activate(map: MapLike): void {
    // 容器离开文档、还没显示（宽高为 0）时 MapLibre 使用默认的 400×300，尺寸监听要到下一帧才重新量；
    // 先按实际尺寸调整，否则就绪时排队的定位按旧尺寸算，动画途中才变大，目标会停在旧尺寸的中心（见 map-core.md 的激活说明）
    map.resize();
    this.#catchUp(map);
    if (this.#mapStyle.status !== 'loaded') {
      // 追赶时触发了整体重建：中止激活，等 style.load 后再激活，重建失败则进入 failed
      return;
    }
    const {
      center: [lng, lat],
      zoom,
      bearing,
      pitch
    } = this.#session.camera.current;
    // 同时担任二三维时先按当前种类设投影和上限（ADR 0147 第 2 节），再跳到会话的相机：三维的缩放上限比二维高时，
    // 先放宽才跳得过去；此时还不是 ready，收回俯角、缩放时的 move 不会写回
    if (this.kinds.length > 1) {
      this.#setLimits(map);
      this.#applyProjection(map);
    }
    // 此时还不是 ready，jumpTo 触发的 move 不会写回；地图收敛过的实际值（如俯角上限）下面按 sync 写回，不算意图。
    // 漫游接管着地图时相机归漫游，恢复时由它放回第一人称的位置
    if (!this.#roam?.engaged) {
      map.jumpTo({ center: [lng, lat], zoom, bearing, pitch }, { cause: 'sync' });
    }
    this.#writeCamera(map, 'sync');
    this.#applyTool(map);
    this.#enter('ready');
  }

  // 加载完成或激活后进入 ready、paused，whenReady 随之结束
  #enter(state: 'ready' | 'paused'): void {
    this.#renewReady();
    this.#setState(state);
    this.#ready.resolve();
  }

  #onStyleChange(change: StyleChange): void {
    const map = this.#map;
    if (map === undefined || this.#engineFailed) {
      return;
    }
    const mapStyle = this.#mapStyle;
    if (mapStyle.status === 'failed') {
      this.#reloadIfNewer(map);
      return;
    }
    if (this.#state !== 'ready' || mapStyle.status !== 'loaded' || change.toRevision <= mapStyle.revision) {
      // 暂停、加载中：等能应用时再从已加载的快照对比
      return;
    }
    if (change.fromRevision === mapStyle.revision) {
      this.#apply(map, change.commands, change.toRevision, change);
    } else {
      this.#catchUp(map);
    }
  }

  // 整体加载的新样式里没有图片（MapLibre 的图片不在样式规范里）：按这次加载的快照加上，此时瓦片还没开始解析
  #addImages(map: MapLike, images: StyleImages): void {
    for (const [id, image] of Object.entries(images)) {
      applyStyleCommand(map, { command: 'addImage', args: [id, image] }, this.#onError);
    }
  }

  #catchUp(map: MapLike): void {
    const mapStyle = this.#mapStyle;
    const { current, images, revision, sceneBefore } = this.#session.style;
    if (mapStyle.status === 'loaded' && mapStyle.revision !== revision) {
      const snapshot = { style: current, images, sceneBefore };
      this.#apply(map, diffSnapshot(mapStyle, snapshot), revision, snapshot);
    }
  }

  #apply(map: MapLike, commands: readonly StyleCommand[], revision: number, snapshot: StyleSnapshot): void {
    let applied = false;
    this.#applying = true;
    this.#rejected = false;
    try {
      // 遇到不支持的命令就停下，整体重建
      applied = commands.every(command => applyStyleCommand(map, command, this.#onError));
    } catch (error) {
      this.#onError(error);
    } finally {
      this.#applying = false;
    }
    // 数据源移除（包括换了地址的先移除再添加）后，旧的错误不再属于它
    this.#forgetSourceErrors(commands.flatMap(({ command, args }) => (command === 'removeSource' ? [args[0]] : [])));
    if (applied && !this.#rejected) {
      const { style, images, sceneBefore } = snapshot;
      this.#mapStyle = { status: 'loaded', revision, style, images, sceneBefore };
      // 增量命令新加的图层排在最上面：模型层挪回页面声明的位置；漫游抬高期间命令改出来的可见图层再隐藏
      this.#scene?.place(sceneBefore);
      if (this.#layersHidden) {
        this.#setLayersVisible(map, false);
      }
    } else {
      // 地图和记录可能已经不一致
      this.#rebuild(map);
    }
  }

  // 加载失败的修订不再重试；会话里有更新的提交时用最新的快照重新整体加载，暂停时也一样
  #reloadIfNewer(map: MapLike): void {
    const mapStyle = this.#mapStyle;
    if (
      this.#state === 'disposed' ||
      this.#engineFailed ||
      mapStyle.status !== 'failed' ||
      this.#session.style.revision <= mapStyle.revision
    ) {
      return;
    }
    this.#rebuild(map);
  }

  // 用当前快照整体加载；完成后触发 style.load，期间的变化届时追上；失败时只有 error（见 #onMapError）
  #rebuild(map: MapLike): void {
    const { current, images, revision, sceneBefore } = this.#session.style;
    // 新的一轮开始：激活因此中止时，等待的人等到本轮结束，而不是拿到上一轮早已成功的结果
    this.#renewReady();
    // 从失败开始的新一轮先回到 initializing（先换 Promise 再通知）：失败后重新加载，以及报错后加载仍然完成、激活时追赶触发的重建
    if (this.#state === 'failed') {
      this.#setState('initializing');
    }
    this.#mapStyle = { status: 'loading', revision, style: current, images, sceneBefore };
    // 整体加载会去掉三维模型层，加载完成后再加上
    this.#syncScene();
    // 所有数据源重新创建，错误会重新出现
    this.#forgetSourceErrors();
    try {
      map.setStyle(current, { diff: false });
    } catch (error) {
      this.#fail(error);
    }
  }

  #onMove(map: MapLike, event: MapMoveEventLike): void {
    if (this.#state === 'ready') {
      this.#writeCamera(map, causeOfMove(event));
    }
  }

  // 用户开始拖动或缩放是一次新的相机操作，之前没完成的定位作废；程序定位的开始、动画的每一帧不是（ADR 0038）
  #onMoveStart(event: MapMoveEventLike): void {
    if (this.#state === 'ready' && causeOfMove(event) === 'user') {
      this.#session.camera.beginOperation();
    }
  }

  // 记下定位动画怎样直接到终点（暂停时用）；duration 为 0 时已经同步到位
  #animating(duration: number | undefined, finish: () => void): void {
    this.#finishAnimation = duration === 0 ? null : finish;
  }

  // 加载中、暂停时的画面不算：加载中样式还没生效，暂停时显示的是另一个视图；三维模块还没加载好时也不算
  #onIdle(): void {
    if (this.state === 'ready') {
      this.#emitter.emit('settle');
    }
  }

  // 漫游时地图的中心不在地面上、还可能抬高着：会话的相机由漫游按真实的视点换算（ADR 0147 第 4 节）
  #writeCamera(map: MapLike, cause: CameraCause): void {
    const roaming = this.#roam?.sessionCamera(map.getCanvas().clientHeight);
    if (roaming) {
      this.#session.camera.set(roaming, { view: this.#kind, cause });
      return;
    }
    const { lng, lat } = map.getCenter();
    this.#session.camera.set(
      { center: [lng, lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() },
      { view: this.#kind, cause }
    );
  }

  // 漫游接管、抬高变了：抬高时隐藏二维图层；接管结束后按当前工具恢复手势、光标
  #onRoamTakeover(map: MapLike, { engaged, lifted }: { readonly engaged: boolean; readonly lifted: boolean }): void {
    if (lifted !== this.#layersHidden) {
      this.#layersHidden = lifted;
      this.#setLayersVisible(map, !lifted);
    }
    if (!engaged && this.#state === 'ready') {
      this.#applyTool(map);
    }
  }

  // 已应用的快照里的图层：隐藏时都设成不可见，恢复时按快照的取值；样式还没加载完时等 style.load 再设
  #setLayersVisible(map: MapLike, visible: boolean): void {
    const { status, style } = this.#mapStyle;
    if (status !== 'loaded') {
      return;
    }
    for (const layer of style.layers) {
      map.setLayoutProperty(layer.id, 'visibility', visible ? (layer.layout?.visibility ?? 'visible') : 'none');
    }
  }

  // 模型层只在显示三维、视图就绪、样式已加载时挂在地图上，插在已应用的快照声明的位置
  #syncScene(): void {
    this.#scene?.update(
      this.#kind === '3d' && this.#state === 'ready',
      this.#mapStyle.status === 'loaded',
      this.#mapStyle.sceneBefore
    );
  }

  // 已经就绪时换种类：先按会话的相机跳过去（中心不变，俯角、缩放放进新的上限，不做动画），再改上限和投影，
  // MapLibre 就不会自己收回而发出 program 的移动；投影换完后地图收敛过的实际值按 sync 写回
  #applyKind(map: MapLike): void {
    const {
      center: [lng, lat],
      zoom,
      bearing,
      pitch
    } = this.#session.camera.current;
    map.jumpTo(
      { center: [lng, lat], zoom: Math.min(zoom, this.#maxZoom()), bearing, pitch: Math.min(pitch, this.#maxPitch()) },
      { cause: 'sync' }
    );
    this.#setLimits(map);
    this.#applyProjection(map);
    this.#writeCamera(map, 'sync');
  }

  #maxPitch(): number {
    return this.#kind === '3d' ? MAX_PITCH_3D : this.#maxPitch2d;
  }

  #maxZoom(): number {
    return this.#kind === '3d' ? this.#maxZoom3d : this.#maxZoom2d;
  }

  // 按当前种类设俯角、缩放上限。漫游接管着地图时上限归漫游（放宽了，结束时还原成接管前的），页面停用后恢复时也不动
  #setLimits(map: MapLike): void {
    if (this.#roam?.engaged) {
      return;
    }
    const maxPitch = this.#maxPitch();
    if (map.getMaxPitch() !== maxPitch) {
      map.setMaxPitch(maxPitch);
    }
    const maxZoom = this.#maxZoom();
    if (map.getMaxZoom() !== maxZoom) {
      map.setMaxZoom(maxZoom);
    }
  }

  // 三维是地球，二维是样式自己的投影（没有时墨卡托）；只在同时担任二三维、样式已加载时设置，整体重建的样式加载完成时再设
  #applyProjection(map: MapLike): void {
    if (this.kinds.length <= 1 || this.#mapStyle.status !== 'loaded') {
      return;
    }
    const wanted = this.#kind === '3d' ? GLOBE : (this.#mapStyle.style.projection ?? MERCATOR);
    const current = map.getProjection() ?? MERCATOR;
    if (JSON.stringify(current.type) !== JSON.stringify(wanted.type)) {
      map.setProjection(wanted);
    }
  }

  #onModuleChange(state: SceneModuleState): void {
    this.#moduleFailure = state.kind === 'failed' ? Object.freeze({ kind: 'module', error: state.error }) : null;
    this.#notifyState();
  }

  // 对外的状态：地图没有就绪、显示二维时就是地图的；显示三维时还看三维模块（ADR 0147 第 2 节）
  #presented(): { readonly state: ViewState; readonly failure: MapViewFailure | null } {
    const module = this.#scene?.module;
    if (this.#state !== 'ready' || this.#kind !== '3d' || module === undefined) {
      return { state: this.#state, failure: this.#failure };
    }
    if (module.kind === 'ready') {
      return { state: 'ready', failure: null };
    }
    if (module.kind === 'failed') {
      return { state: 'failed', failure: this.#moduleFailure };
    }
    // 加载中（切到三维时就开始加载，不会停在还没要过）
    return { state: 'initializing', failure: null };
  }

  // 对外的状态或失败原因变了才通知
  #notifyState(): void {
    if (this.#state === 'disposed') {
      return;
    }
    const { state, failure } = this.#presented();
    if (state === this.#shownState && failure === this.#shownFailure) {
      return;
    }
    this.#shownState = state;
    this.#shownFailure = failure;
    this.#emitter.emit('statechange', state);
  }

  // 显示二维时三维内容的状态不报告；切到三维时 setKind 报告一次
  #onSceneStatus(status: SceneStatus): void {
    if (this.#kind === '3d') {
      this.#emitter.emit('scenestatuschange', status);
      // 漫游可能在等要抬高的瓦片集就绪
      this.#guard(() => this.#roam?.onSceneStatus());
    }
  }

  // 对外就绪时才能用：显示三维时三维模块也要加载好
  #readyMap(): MapLike {
    this.#assertAlive();
    const { state } = this.#presented();
    if (state !== 'ready' || this.#map === undefined) {
      throw new Error(`MapLibreView 当前状态为 ${state}，只能在 ready 时定位、拾取、投影和查询`);
    }
    return this.#map;
  }

  // 只有就绪且没有暂停的视图把输入交给工具：二三维切换时只有当前显示的视图在转交（ADR 0034 第 3 条）；
  // 三维模块没加载好时同样不转交；临时拖动的松开和派生的单击不交给工具（ADR 0056 第 2 节）
  #onInput(event: MapInputEvent): void {
    // 漫游接管键鼠，相当于一个工具：输入不交给当前工具（三维里能点选，路线漫游时点一下会弹出要素详情）
    if (this.#roam?.engaged) {
      return;
    }
    if (this.state === 'ready' && (event.type === 'key' || this.#pan?.swallows(event.type) !== true)) {
      this.#session.tool.dispatch(event, this.#toolView);
    }
  }

  #capturesPress(point: ScreenPoint): boolean {
    return this.state === 'ready' && this.#session.tool.capturesPress(point, this.#toolView);
  }

  // 没有就绪时不应用，进入 ready（首次激活、恢复显示）时再按当前工具应用；切换工具时结束临时拖动
  #onToolChange(): void {
    this.#pan?.cancel();
    if (this.#state === 'ready' && this.#map !== undefined) {
      this.#applyTool(this.#map);
    }
  }

  // 光标和手势是当前工具的声明；只恢复自己关掉的手势。切换工具和进入 ready 时调用
  #applyTool(map: MapLike): void {
    // 漫游接管着手势和光标：结束时再按当前工具应用
    if (this.#roam?.engaged) {
      return;
    }
    const { gestures, persistent } = this.#session.tool.activeTool;
    this.#applyCursor(map);
    // 临时任务多由面板、工具栏上的按钮激活（也可能在加载期间），焦点还在按钮上，按键到不了地图；
    // 移到地图上，Esc 才能直接退出。常驻模式不移，进入页面时不会抢走焦点
    if (!persistent) {
      map.getCanvas().focus({ preventScroll: true });
    }
    for (const name of GESTURES) {
      const handler = map[name];
      if (gestures?.[name] === false) {
        if (handler.isEnabled()) {
          handler.disable();
          this.#disabledGestures.add(name);
        }
      } else if (this.#disabledGestures.delete(name)) {
        handler.enable();
      }
    }
  }

  // 工具声明的光标，按住修饰键、临时拖动时换成手型（ADR 0056 第 2 节）
  #applyCursor(map: MapLike): void {
    const { cursor } = this.#session.tool.activeTool;
    map.getCanvas().style.cursor = this.#pan?.cursor(cursor) ?? cursor ?? '';
  }

  #fail(error: unknown): void {
    this.#ready.reject(error);
    const cause = error instanceof GPUInitializationError ? 'webgl-unavailable' : 'unknown';
    this.#setState('failed', { kind: 'engine', cause, error });
    this.#onError(error);
  }

  // 每个数据源只记第一条；MapLibre 移除数据源（包括整体 setStyle）时断开它的事件转发，之后不会再收到它的错误
  #recordSourceError(sourceId: string, error: Error): void {
    if (this.#sourceErrors.has(sourceId)) {
      return;
    }
    this.#setSourceErrors(new Map([...this.#sourceErrors, [sourceId, error]]));
  }

  // 不传时全部清掉
  #forgetSourceErrors(sourceIds?: readonly string[]): void {
    const forgotten = sourceIds ?? [...this.#sourceErrors.keys()];
    if (!forgotten.some(id => this.#sourceErrors.has(id))) {
      return;
    }
    const remaining = [...this.#sourceErrors].filter(([id]) => !forgotten.includes(id));
    this.#setSourceErrors(remaining.length > 0 ? new Map(remaining) : NO_SOURCE_ERRORS);
  }

  #setSourceErrors(errors: SourceErrors): void {
    this.#sourceErrors = errors;
    this.#emitter.emit('sourceerrorchange', errors);
  }

  // 新一轮开始（整体重建、从 failed 重新加载），或失败后又收到 style.load 时：上一轮已经有结果就换一个新的；
  // 在改状态之前调用，监听 statechange 的人拿到的就是这一轮的
  #renewReady(): void {
    if (this.#ready.settled) {
      this.#ready = deferred();
    }
  }

  // 引擎本身失败（创建地图或 setStyle 抛错）：不能恢复，只能释放后重新创建视图
  get #engineFailed(): boolean {
    return this.#failure?.kind === 'engine';
  }

  // 失败原因只在 failed 时保留；状态或原因任一变化都通知，监听者读到的原因不会是旧的。
  // 不在转换表里的转换不执行，报给 onError：调用方都在 MapLibre 的事件处理里，抛错也只会被 #guard 接住
  #setState(state: LiveViewState, failure: MapViewFailure | null = null): void {
    const nextFailure = state === 'failed' ? failure : null;
    if (this.#state === state && this.#failure === nextFailure) {
      return;
    }
    if (!canTransition(this.#state, this.#failure, state)) {
      this.#onError(new Error(`MapLibreView 不能从 ${this.#state} 转换到 ${state}`));
      return;
    }
    this.#state = state;
    this.#failure = nextFailure;
    this.#syncScene();
    this.#notifyState();
  }

  // MapLibre 的事件回调里不能抛错，否则会打断它自己的事件分发
  #guard(callback: () => void): void {
    try {
      callback();
    } catch (error) {
      this.#onError(error);
    }
  }

  #assertAlive(): void {
    if (this.#state === 'disposed') {
      throw new Error('MapLibreView 已释放');
    }
  }
}
