import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { GPUInitializationError, Map as MapLibreMap } from 'maplibre-gl';
import { safeReporter } from '@yzt/utils';
import { createNanoEvents } from 'nanoevents';
import type { CameraCause, CameraState } from '../camera/camera-model';
import type { Unsubscribe } from '../events';
import type { MapSession } from '../session/map-session';
import { diffStyle, type StyleCommand } from '../style/diff-style';
import type { StyleChange } from '../style/style-model';
import type { Gestures, ToolView } from '../tool/tool-model';
import type {
  FitBoundsOptions,
  FlyToOptions,
  MapView,
  MapViewFailure,
  ViewBounds,
  ViewPadding,
  ViewState
} from '../view/map-view';
import type { LngLat, MapInputEvent, MapPointerEvent, PickResult, ScreenPoint } from '../view/view-input';
import { applyStyleCommand } from './apply-style-command';
import type { MapLibreMapOptions, MapLike, MapMouseEventLike, MapMouseEventType, MapMoveEventLike } from './map-like';

export interface MapLibreViewOptions<G extends string> {
  readonly session: MapSession<G>;
  readonly container: HTMLElement;
  /** 创建后是否显示，默认 true；为 false 时加载完成后进入 paused */
  readonly active?: boolean;
  /** minZoom、maxZoom、transformRequest 等，由 app 提供 */
  readonly mapOptions?: Omit<MapLibreMapOptions, 'container' | 'style' | 'center' | 'zoom' | 'bearing' | 'pitch'>;
  /** 测试时换成假地图 */
  readonly createMap?: (options: MapLibreMapOptions) => MapLike;
  /** 运行中的错误：MapLibre 的 error 事件、应用命令失败、数据更新失败；默认打印到控制台 */
  readonly onError?: (error: unknown) => void;
}

interface MapLibreViewEvents {
  statechange: (state: ViewState) => void;
  resize: () => void;
}

interface Deferred {
  readonly promise: Promise<void>;
  readonly settled: boolean;
  resolve(): void;
  reject(reason: unknown): void;
}

function deferred(): Deferred {
  let settled = false;
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  // 没人等待时被拒绝也不报"未处理的拒绝"，等待的人照样收到错误
  void promise.catch(() => undefined);
  return {
    promise,
    get settled() {
      return settled;
    },
    resolve() {
      settled = true;
      resolve();
    },
    reject(reason) {
      settled = true;
      reject(reason);
    }
  };
}

/**
 * 地图上的样式：整体加载中、已加载（即已应用的快照）、加载失败（ADR 0026）
 * 失败时也记下快照：之后 style.load 仍然到达时，以它为已加载
 */
interface MapStyle {
  readonly status: 'loading' | 'loaded' | 'failed';
  readonly revision: number;
  readonly style: StyleSpecification;
}

const CAMERA_CAUSES: readonly string[] = ['user', 'program', 'sync'] satisfies CameraCause[];

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

function createMapLibreMap(options: MapLibreMapOptions): MapLike {
  return new MapLibreMap(options);
}

function reportToConsole(error: unknown): void {
  console.error('[MapLibreView]', error);
}

/** 二维视图：唯一写 MapLibre 地图的地方，把会话的样式和相机同步到地图（ADR 0020、0022、0024、0026） */
export class MapLibreView<const G extends string> implements MapView {
  readonly kind = '2d';
  readonly #session: MapSession<G>;
  readonly #map: MapLike | undefined;
  readonly #onError: (error: unknown) => void;
  readonly #emitter = createNanoEvents<MapLibreViewEvents>();
  readonly #stack: DisposableStack;
  // 当前这一轮整体加载的结果（创建地图、整体重建、重新加载各算一轮），本轮的成功、失败、释放都结束它
  #ready = deferred();
  #state: ViewState = 'initializing';
  #failure: MapViewFailure | null = null;
  #active: boolean;
  #mapStyle: MapStyle;
  // 引擎本身失败（创建地图或 setStyle 抛错）：不能恢复，只能释放后重新创建视图
  #fatal = false;
  // 应用增量命令期间同步收到的 error 事件：MapLibre 的很多方法校验失败时不抛错，只发事件
  #applying = false;
  #rejected = false;
  // 当前工具让视图关掉的手势；切换工具时只恢复这些，页面创建地图时就关掉的不会被打开
  readonly #disabledGestures = new Set<keyof Gestures>();
  // 交给工具的视图能力：只有拾取和投影（ADR 0034 第 2 条）
  readonly #toolView: ToolView = Object.freeze({
    kind: '2d',
    pick: (point: ScreenPoint) => this.pick(point),
    project: (lngLat: LngLat) => this.project(lngLat)
  });

  constructor({
    session,
    container,
    active = true,
    mapOptions,
    createMap = createMapLibreMap,
    onError = reportToConsole
  }: MapLibreViewOptions<G>) {
    this.#session = session;
    this.#active = active;
    // 报告器自己抛错时不能打断状态转换和资源释放，也不能冒进 MapLibre 的事件分发
    this.#onError = safeReporter(onError, 'MapLibreView');
    const { current: style, revision } = session.style;
    this.#mapStyle = { status: 'loading', revision, style };

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
      map = createMap({ ...mapOptions, container, style, center: [lng, lat], zoom, bearing, pitch });
    } catch (error) {
      // 例如不支持 WebGL2 时的 GPUInitializationError：不抛出，交给 whenReady 和 statechange 表达
      this.#map = undefined;
      this.#stack = stack.move();
      this.#fail(error);
      return;
    }
    this.#map = map;
    stack.defer(() => map.remove());
    for (const subscription of [
      map.on('style.load', () => this.#guard(() => this.#onStyleLoad(map))),
      map.on('error', ({ error }) => this.#guard(() => this.#onMapError(map, error))),
      map.on('move', event => this.#guard(() => this.#onMove(map, event))),
      map.on('movestart', event => this.#guard(() => this.#onMoveStart(event))),
      map.on('resize', () => this.#guard(() => this.#emitter.emit('resize')))
    ]) {
      stack.defer(() => subscription.unsubscribe());
    }
    for (const type of Object.keys(POINTER_TYPES) as MapMouseEventType[]) {
      const subscription = map.on(type, event => this.#guard(() => this.#onInput(toPointerEvent(type, event))));
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

  get state(): ViewState {
    return this.#state;
  }

  get failure(): MapViewFailure | null {
    return this.#failure;
  }

  whenReady(): Promise<void> {
    return this.#ready.promise;
  }

  pause(): void {
    this.#assertAlive();
    this.#active = false;
    if (this.#state === 'ready') {
      this.#setState('paused');
    }
  }

  /** 恢复显示：追上暂停期间的样式变化，并把会话相机同步过来 */
  resume(): void {
    this.#assertAlive();
    this.#active = true;
    if (this.#state === 'paused' && this.#map !== undefined) {
      this.#activate(this.#map);
    }
  }

  flyTo({ center, zoom, bearing, pitch }: Partial<CameraState>, { duration, padding }: FlyToOptions = {}): void {
    const map = this.#readyMap();
    // MapLibre 的 padding 会留在地图上，改变"会话相机的中心就是画布中心"；换成只对这一次有效的 offset（ADR 0037）
    const offset = center && padding !== undefined ? centerOffset(padding) : undefined;
    map.flyTo(
      withoutUndefined({ center: center && [center[0], center[1]], zoom, bearing, pitch, duration, offset }),
      { cause: 'program' }
    );
  }

  fitBounds(
    [west, south, east, north]: ViewBounds,
    { padding, maxZoom, duration, pitch }: FitBoundsOptions = {}
  ): void {
    const map = this.#readyMap();
    map.fitBounds([west, south, east, north], withoutUndefined({ padding, maxZoom, duration, pitch }), {
      cause: 'program'
    });
  }

  /** 二维总是命中地图平面，没有高度 */
  pick({ x, y }: ScreenPoint): PickResult {
    const { lng, lat } = this.#readyMap().unproject([x, y]);
    return { kind: 'hit', surface: 'map', lngLat: [lng, lat] };
  }

  /** 二维忽略高度；结果可能在画布之外 */
  project([lng, lat]: LngLat): ScreenPoint {
    const { x, y } = this.#readyMap().project([lng, lat]);
    return { x, y };
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
    this.#emitter.events = {};
    this.#stack.dispose();
  }

  #onStyleLoad(map: MapLike): void {
    if (this.#fatal) {
      return;
    }
    // failed：之前的 error 并不致命，加载最终完成了，以 style.load 为准
    if (this.#mapStyle.status !== 'loaded') {
      this.#mapStyle = { ...this.#mapStyle, status: 'loaded' };
    }
    if (this.#state === 'ready') {
      this.#catchUp(map);
      // 运行中的整体重建完成并追上了；追赶又触发了重建时，本轮延续到那一次加载
      if (this.#mapStyle.status === 'loaded') {
        this.#ready.resolve();
      }
    } else if (this.#active) {
      // 首次加载、失败后恢复，或者恢复显示时因整体重建而中断的激活
      this.#activate(map);
    } else {
      // 包括暂停期间完成的加载：和以 active: false 创建时一样，样式加载完成本轮就结束
      this.#enter('paused');
    }
  }

  #onMapError(map: MapLike, error: Error): void {
    this.#onError(error);
    if (this.#fatal) {
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
    // 此时还不是 ready，jumpTo 触发的 move 不会写回；地图收敛过的实际值（如俯角上限）下面按 sync 写回，不算意图
    map.jumpTo({ center: [lng, lat], zoom, bearing, pitch }, { cause: 'sync' });
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
    if (map === undefined || this.#fatal) {
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
      this.#apply(map, change.commands, change.toRevision, change.style);
    } else {
      this.#catchUp(map);
    }
  }

  #catchUp(map: MapLike): void {
    const mapStyle = this.#mapStyle;
    const { current, revision } = this.#session.style;
    if (mapStyle.status === 'loaded' && mapStyle.revision !== revision) {
      this.#apply(map, diffStyle(mapStyle.style, current), revision, current);
    }
  }

  #apply(map: MapLike, commands: readonly StyleCommand[], revision: number, style: StyleSpecification): void {
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
    if (applied && !this.#rejected) {
      this.#mapStyle = { status: 'loaded', revision, style };
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
      this.#fatal ||
      mapStyle.status !== 'failed' ||
      this.#session.style.revision <= mapStyle.revision
    ) {
      return;
    }
    if (this.#state === 'failed') {
      this.#renewReady();
      this.#setState('initializing');
    }
    this.#rebuild(map);
  }

  // 用当前快照整体加载；完成后触发 style.load，期间的变化届时追上；失败时只有 error（见 #onMapError）
  #rebuild(map: MapLike): void {
    const { current, revision } = this.#session.style;
    // 新的一轮开始：激活因此中止时，等待的人等到本轮结束，而不是拿到上一轮早已成功的结果
    this.#renewReady();
    this.#mapStyle = { status: 'loading', revision, style: current };
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

  #writeCamera(map: MapLike, cause: CameraCause): void {
    const { lng, lat } = map.getCenter();
    this.#session.camera.set(
      { center: [lng, lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() },
      { view: '2d', cause }
    );
  }

  #readyMap(): MapLike {
    this.#assertAlive();
    if (this.#state !== 'ready' || this.#map === undefined) {
      throw new Error(`MapLibreView 当前状态为 ${this.#state}，只能在 ready 时定位、拾取和投影`);
    }
    return this.#map;
  }

  // 只有就绪且没有暂停的视图把输入交给工具：二三维切换时只有当前显示的视图在转交（ADR 0034 第 3 条）
  #onInput(event: MapInputEvent): void {
    if (this.#state === 'ready') {
      this.#session.tool.dispatch(event, this.#toolView);
    }
  }

  // 没有就绪时不应用，进入 ready（首次激活、恢复显示）时再按当前工具应用
  #onToolChange(): void {
    if (this.#state === 'ready' && this.#map !== undefined) {
      this.#applyTool(this.#map);
    }
  }

  // 光标和手势是当前工具的声明；只恢复自己关掉的手势。切换工具和进入 ready 时调用
  #applyTool(map: MapLike): void {
    const { cursor, gestures, persistent } = this.#session.tool.activeTool;
    map.getCanvas().style.cursor = cursor ?? '';
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

  #fail(error: unknown): void {
    this.#fatal = true;
    this.#ready.reject(error);
    const cause = error instanceof GPUInitializationError ? 'webgl-unavailable' : 'unknown';
    this.#setState('failed', { kind: 'engine', cause, error });
    this.#onError(error);
  }

  // 新一轮开始（整体重建、从 failed 重新加载），或失败后又收到 style.load 时：上一轮已经有结果就换一个新的；
  // 在改状态之前调用，监听 statechange 的人拿到的就是这一轮的
  #renewReady(): void {
    if (this.#ready.settled) {
      this.#ready = deferred();
    }
  }

  // 失败原因只在 failed 时保留；状态或原因任一变化都通知，监听者读到的原因不会是旧的
  #setState(state: ViewState, failure: MapViewFailure | null = null): void {
    const nextFailure = state === 'failed' ? failure : null;
    if (this.#state === state && this.#failure === nextFailure) {
      return;
    }
    this.#state = state;
    this.#failure = nextFailure;
    this.#emitter.emit('statechange', state);
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
