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
  resolve(): void;
  reject(reason: unknown): void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  // 没人等待时被拒绝也不报"未处理的拒绝"，等待的人照样收到错误
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
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

function createMapLibreMap(options: MapLibreMapOptions): MapLike {
  return new MapLibreMap(options);
}

function reportToConsole(error: unknown): void {
  console.error('[MapLibreView]', error);
}

/** 二维视图：唯一写 MapLibre 地图的地方，把会话的样式和相机同步到地图（ADR 0020、0022、0024） */
export class MapLibreView<const G extends string> implements MapView {
  readonly kind = '2d';
  readonly #session: MapSession<G>;
  readonly #map: MapLike | undefined;
  readonly #onError: (error: unknown) => void;
  readonly #emitter = createNanoEvents<MapLibreViewEvents>();
  readonly #ready = deferred();
  readonly #stack: DisposableStack;
  #state: ViewState = 'initializing';
  #active: boolean;
  // 初始加载和整体重建期间为 false，此时样式方法不可用
  #styleLoaded = false;
  // 已应用到地图的快照，暂停恢复、加载完成、重建之后都从它对比到当前快照
  #applied: { version: number; style: StyleSpecification };

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
    this.#applied = { version, style };

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
      map.on('style.load', () => this.#guard(() => this.#onStyleLoad())),
      map.on('error', ({ error }) => this.#onError(error)),
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
    if (this.#state !== 'paused' || this.#map === undefined) {
      return;
    }
    this.#setState('ready');
    if (this.#styleLoaded) {
      this.#catchUp(this.#map);
    }
    const {
      center: [lng, lat],
      zoom,
      bearing,
      pitch
    } = this.#session.camera.current;
    this.#map.jumpTo({ center: [lng, lat], zoom, bearing, pitch }, { cause: 'sync' });
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

  #onStyleLoad(): void {
    this.#styleLoaded = true;
    if (this.#state === 'initializing') {
      this.#setState(this.#active ? 'ready' : 'paused');
      this.#ready.resolve();
    }
    if (this.#state === 'ready' && this.#map !== undefined) {
      this.#catchUp(this.#map);
    }
  }

  #onStyleChange(change: StyleChange): void {
    if (this.#state !== 'ready' || !this.#styleLoaded || this.#map === undefined) {
      // 暂停、加载中、重建中：等能应用时再从已应用的快照对比
      return;
    }
    if (change.toVersion <= this.#applied.version) {
      return;
    }
    if (change.fromVersion === this.#applied.version) {
      this.#apply(this.#map, change.commands, change.toVersion, change.style);
    } else {
      this.#catchUp(this.#map);
    }
  }

  #catchUp(map: MapLike): void {
    const { current, version } = this.#session.style;
    if (version !== this.#applied.version) {
      this.#apply(map, diffStyle(this.#applied.style, current), version, current);
    }
  }

  #apply(map: MapLike, commands: readonly StyleCommand[], version: number, style: StyleSpecification): void {
    try {
      for (const command of commands) {
        if (!applyStyleCommand(map, command, this.#onError)) {
          this.#rebuild(map);
          return;
        }
      }
      this.#applied = { version, style };
    } catch (error) {
      this.#onError(error);
      this.#rebuild(map);
    }
  }

  // 用当前快照整体重建；重建完成会再次触发 style.load，期间的变化届时追上
  #rebuild(map: MapLike): void {
    const { current, version } = this.#session.style;
    this.#styleLoaded = false;
    this.#applied = { version, style: current };
    try {
      map.setStyle(current, { diff: false });
    } catch (error) {
      this.#fail(error);
    }
  }

  #onMove(map: MapLike, event: MapMoveEventLike): void {
    if (this.#state !== 'ready') {
      return;
    }
    const { lng, lat } = map.getCenter();
    this.#session.camera.set(
      { center: [lng, lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() },
      { view: '2d', cause: causeOfMove(event) }
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
    this.#setState('failed');
    this.#ready.reject(error);
    this.#onError(error);
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
