import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { Map as MapLibreMap } from 'maplibre-gl';
import { createNanoEvents } from 'nanoevents';
import type { CameraCause, CameraState } from '../camera/camera-model';
import type { Unsubscribe } from '../events';
import type { MapSession } from '../session/map-session';
import { diffStyle, type StyleCommand } from '../style/diff-style';
import type { StyleChange } from '../style/style-model';
import type { FitBoundsOptions, FlyToOptions, MapView, ViewBounds, ViewState } from '../view/map-view';
import { applyStyleCommand } from './apply-style-command';
import type { MapLibreMapOptions, MapLike, MapMoveEventLike } from './map-like';

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

/** 地图上的样式：整体加载中、已加载（即已应用的快照）、加载失败（ADR 0026） */
type MapStyle =
  | { readonly status: 'loading' | 'loaded'; readonly version: number; readonly style: StyleSpecification }
  | { readonly status: 'failed'; readonly version: number };

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
  // 当前这一轮加载的结果；失败后重新加载时换一个新的
  #ready = deferred();
  #state: ViewState = 'initializing';
  #active: boolean;
  #mapStyle: MapStyle;
  // 引擎本身失败（创建地图或 setStyle 抛错）：不能恢复，只能释放后重新创建视图
  #fatal = false;
  // 应用增量命令期间同步收到的 error 事件：MapLibre 的很多方法校验失败时不抛错，只发事件
  #applying = false;
  #rejected = false;

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
    this.#onError = onError;
    const { current: style, version } = session.style;
    this.#mapStyle = { status: 'loading', version, style };

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
      map.on('error', ({ error }) => this.#guard(() => this.#onMapError(error))),
      map.on('move', event => this.#guard(() => this.#onMove(map, event)))
    ]) {
      stack.defer(() => subscription.unsubscribe());
    }
    stack.defer(session.style.on('change', change => this.#onStyleChange(change)));
    this.#stack = stack.move();
  }

  get state(): ViewState {
    return this.#state;
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

  flyTo({ center, zoom, bearing, pitch }: Partial<CameraState>, { duration }: FlyToOptions = {}): void {
    const map = this.#readyMap();
    map.flyTo(withoutUndefined({ center: center && [center[0], center[1]], zoom, bearing, pitch, duration }), {
      cause: 'program'
    });
  }

  fitBounds([west, south, east, north]: ViewBounds, { padding, maxZoom, duration }: FitBoundsOptions = {}): void {
    const map = this.#readyMap();
    map.fitBounds([west, south, east, north], withoutUndefined({ padding, maxZoom, duration }), { cause: 'program' });
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
    this.#emitter.events = {};
    this.#stack.dispose();
  }

  #onStyleLoad(map: MapLike): void {
    if (this.#fatal) {
      return;
    }
    if (this.#mapStyle.status === 'loading') {
      const { version, style } = this.#mapStyle;
      this.#mapStyle = { status: 'loaded', version, style };
    }
    // failed：之前的 error 并不致命，加载最终完成了，以 style.load 为准
    if (this.#state === 'initializing' || this.#state === 'failed') {
      this.#renewReady();
      if (this.#active) {
        this.#activate(map);
      } else {
        this.#setState('paused');
      }
      this.#ready.resolve();
    } else if (this.#state === 'ready') {
      this.#catchUp(map);
    }
  }

  #onMapError(error: Error): void {
    this.#onError(error);
    if (this.#fatal) {
      return;
    }
    if (this.#applying) {
      this.#rejected = true;
    } else if (this.#mapStyle.status === 'loading') {
      // 整份样式校验失败时 MapLibre 只发 error，不会再有 style.load
      this.#mapStyle = { status: 'failed', version: this.#mapStyle.version };
      this.#renewReady();
      this.#ready.reject(error);
      this.#setState('failed');
    }
  }

  // 首次进入 ready 和恢复显示共用：追上样式，相机先跟随会话、再把地图的实际值写回，最后才发出 ready
  #activate(map: MapLike): void {
    this.#catchUp(map);
    const {
      center: [lng, lat],
      zoom,
      bearing,
      pitch
    } = this.#session.camera.current;
    // 此时还不是 ready，jumpTo 触发的 move 不会写回；地图收敛过的实际值（如俯角上限）下面按 sync 写回，不算意图
    map.jumpTo({ center: [lng, lat], zoom, bearing, pitch }, { cause: 'sync' });
    this.#writeCamera(map, 'sync');
    this.#setState('ready');
  }

  #onStyleChange(change: StyleChange): void {
    const map = this.#map;
    if (map === undefined || this.#fatal) {
      return;
    }
    const mapStyle = this.#mapStyle;
    if (mapStyle.status === 'failed') {
      // 加载失败的版本不再重试；出现更新的版本时重新整体加载，暂停时也一样
      if (change.toVersion > mapStyle.version) {
        this.#reload(map);
      }
      return;
    }
    if (this.#state !== 'ready' || mapStyle.status !== 'loaded' || change.toVersion <= mapStyle.version) {
      // 暂停、加载中：等能应用时再从已加载的快照对比
      return;
    }
    if (change.fromVersion === mapStyle.version) {
      this.#apply(map, change.commands, change.toVersion, change.style);
    } else {
      this.#catchUp(map);
    }
  }

  #catchUp(map: MapLike): void {
    const mapStyle = this.#mapStyle;
    const { current, version } = this.#session.style;
    if (mapStyle.status === 'loaded' && mapStyle.version !== version) {
      this.#apply(map, diffStyle(mapStyle.style, current), version, current);
    }
  }

  #apply(map: MapLike, commands: readonly StyleCommand[], version: number, style: StyleSpecification): void {
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
      this.#mapStyle = { status: 'loaded', version, style };
    } else {
      // 地图和记录可能已经不一致
      this.#rebuild(map);
    }
  }

  #reload(map: MapLike): void {
    this.#renewReady();
    this.#setState('initializing');
    this.#rebuild(map);
  }

  // 用当前快照整体加载；完成后触发 style.load，期间的变化届时追上；失败时只有 error（见 #onMapError）
  #rebuild(map: MapLike): void {
    const { current, version } = this.#session.style;
    this.#mapStyle = { status: 'loading', version, style: current };
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
      throw new Error(`MapLibreView 当前状态为 ${this.#state}，不能定位`);
    }
    return this.#map;
  }

  #fail(error: unknown): void {
    this.#fatal = true;
    this.#renewReady();
    this.#ready.reject(error);
    this.#setState('failed');
    this.#onError(error);
  }

  // whenReady() 表示当前这一轮加载的结果：已经有结果时（如运行中重建失败，它早已结束）换一个新的；
  // 在改状态之前调用，监听 statechange 的人拿到的就是这一轮的
  #renewReady(): void {
    if (this.#ready.settled) {
      this.#ready = deferred();
    }
  }

  #setState(state: ViewState): void {
    if (this.#state !== state) {
      this.#state = state;
      this.#emitter.emit('statechange', state);
    }
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
