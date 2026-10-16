import type { LayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Geometry } from 'geojson';
import { GPUInitializationError, type Map as MapLibreMap } from 'maplibre-gl';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { CameraChange, CameraState } from '../camera/camera-model';
import { MapSession } from '../session/map-session';
import { type StyleGroup, StyleModel } from '../style/style-model';
import type { MapTool, ToolView } from '../tool/tool-model';
import { type MapViewFailure, NO_SOURCE_ERRORS, type SourceErrors, type ViewState } from '../view/map-view';
import type { MapInputEvent } from '../view/view-input';
import type {
  CameraEventData,
  GestureHandlerLike,
  MapLibreMapOptions,
  MapLike,
  MapMouseEventLike,
  MapMouseEventType,
  MapMoveEventLike,
  MapSubscription,
  RenderedFeatureLike
} from './map-like';
import { MapLibreView, type MapLibreViewOptions } from './maplibre-view';

const NANJING: CameraState = { center: [118.8, 32.05], zoom: 8, bearing: 0, pitch: 0 };

// 会话的样式通知在微任务里发出
const nextMicrotask = () => Promise.resolve();

// 立即可知的结果：还没结束的 Promise 得到 'pending'，测试因断言失败而不是超时
function settled<T>(promise: Promise<T>): Promise<T | 'pending'> {
  return Promise.race([promise, new Promise<'pending'>(resolve => setTimeout(() => resolve('pending'), 0))]);
}

interface FakeEvent {
  readonly error?: Error;
  readonly sourceId?: string;
  readonly originalEvent?: unknown;
  readonly cause?: unknown;
  readonly point?: { readonly x: number; readonly y: number };
}

// 手势的开关，记下 enable、disable 的调用
class FakeGesture implements GestureHandlerLike {
  readonly calls: string[] = [];
  enabled = true;

  isEnabled(): boolean {
    return this.enabled;
  }

  enable(): void {
    this.enabled = true;
    this.calls.push('enable');
  }

  disable(): void {
    this.enabled = false;
    this.calls.push('disable');
  }
}

interface FakeCamera {
  lng: number;
  lat: number;
  zoom: number;
  bearing: number;
  pitch: number;
}

const CAMERA_CALLS = new Set(['jumpTo', 'flyTo', 'panBy', 'fitBounds', 'remove']);

// 只模拟适配器用到的行为：记录调用；相机方法立即到位，并像 MapLibre 一样同步触发 move、合并 eventData
// 记下设置过的滚轮缩放速率
class FakeScrollZoom {
  wheelRate: number | undefined;
  trackpadRate: number | undefined;

  setWheelZoomRate(rate: number) {
    this.wheelRate = rate;
  }

  setZoomRate(rate: number) {
    this.trackpadRate = rate;
  }
}

class FakeMap implements MapLike {
  readonly calls: unknown[][] = [];
  readonly maxPitch = 60;
  readonly #listeners = new Map<string, Set<(event: FakeEvent) => void>>();
  camera: FakeCamera;
  // 调用时抛错
  failOn: string | undefined;
  // 像 MapLibre 的校验失败一样：同步触发 error 事件，不抛错，也不生效
  rejectOn: string | undefined;
  // 照常生效，但同步触发一条带 sourceId 的 error（数据源加载失败）
  sourceErrorOn: string | undefined;
  removed = false;
  readonly canvas = document.createElement('canvas');
  readonly canvasContainer = document.createElement('div');
  readonly dragPan = new FakeGesture();
  readonly doubleClickZoom = new FakeGesture();
  readonly boxZoom = new FakeGesture();
  readonly scrollZoom = new FakeScrollZoom();

  constructor(readonly options: MapLibreMapOptions) {
    const [lng, lat] = options.center as [number, number];
    // MapLibre 创建地图时同样会收敛相机，但此时适配器还没有订阅 move
    this.camera = {
      lng,
      lat,
      zoom: options.zoom ?? 0,
      bearing: options.bearing ?? 0,
      pitch: Math.min(options.pitch ?? 0, this.maxPitch)
    };
    this.canvasContainer.append(this.canvas);
    // 像 MapLibre 一样在画布容器的冒泡阶段收到按下，再发出地图事件；画布在 (0, 0)
    this.canvasContainer.addEventListener('mousedown', event =>
      this.fire('mousedown', { point: { x: event.clientX, y: event.clientY }, originalEvent: event })
    );
  }

  addSource = this.#record('addSource');
  removeSource = this.#record('removeSource');
  addLayer = this.#record('addLayer');
  removeLayer = this.#record('removeLayer');
  setPaintProperty = this.#record('setPaintProperty');
  setLayoutProperty = this.#record('setLayoutProperty');
  setFilter = this.#record('setFilter');
  setLayerZoomRange = this.#record('setLayerZoomRange');
  addImage = this.#record('addImage');
  updateImage = this.#record('updateImage');
  removeImage = this.#record('removeImage');
  setStyle = this.#record('setStyle');

  getSource(): unknown {
    return undefined;
  }

  on(type: 'style.load', listener: () => void): MapSubscription;
  on(type: 'error', listener: (event: { readonly error: Error; readonly sourceId?: unknown }) => void): MapSubscription;
  on(type: 'move', listener: (event: MapMoveEventLike) => void): MapSubscription;
  on(type: 'movestart', listener: (event: MapMoveEventLike) => void): MapSubscription;
  on(type: 'moveend', listener: (event: MapMoveEventLike) => void): MapSubscription;
  on(type: 'resize', listener: () => void): MapSubscription;
  on(type: 'idle', listener: () => void): MapSubscription;
  on(type: MapMouseEventType, listener: (event: MapMouseEventLike) => void): MapSubscription;
  on(type: string, listener: (event: never) => void): MapSubscription {
    // 各个重载的回调都能接收 FakeEvent 中各自需要的字段
    const callback = listener as (event: FakeEvent) => void;
    const listeners = this.#listeners.get(type) ?? new Set();
    this.#listeners.set(type, listeners.add(callback));
    return { unsubscribe: () => listeners.delete(callback) };
  }

  listenerCount(): number {
    return [...this.#listeners.values()].reduce((count, listeners) => count + listeners.size, 0);
  }

  fire(type: string, event: FakeEvent = {}): void {
    for (const listener of this.#listeners.get(type) ?? []) {
      listener(event);
    }
  }

  // 每次 resize 时 calls 的长度：resize 不是样式命令，不记进 calls，只用来比较先后
  readonly resizedAt: number[] = [];

  // 像 MapLibre 一样同步发出 resize
  resize(): void {
    this.resizedAt.push(this.calls.length);
    this.fire('resize');
  }

  getCenter() {
    return { lng: this.camera.lng, lat: this.camera.lat };
  }

  getZoom(): number {
    return this.camera.zoom;
  }

  getBearing(): number {
    return this.camera.bearing;
  }

  getPitch(): number {
    return this.camera.pitch;
  }

  jumpTo(
    camera: { center: [number, number]; zoom: number; bearing: number; pitch: number },
    eventData: CameraEventData
  ): void {
    this.calls.push(['jumpTo', camera, eventData]);
    const [lng, lat] = camera.center;
    this.moveTo({ lng, lat, zoom: camera.zoom, bearing: camera.bearing, pitch: camera.pitch }, eventData);
  }

  flyTo(camera: { center?: [number, number]; zoom?: number; duration?: number }, eventData: CameraEventData): void {
    this.calls.push(['flyTo', camera, eventData]);
    const [lng, lat] = camera.center ?? [this.camera.lng, this.camera.lat];
    this.#animated(camera.duration, () =>
      this.moveTo({ ...this.camera, lng, lat, zoom: camera.zoom ?? this.camera.zoom }, eventData)
    );
  }

  // 和 unproject 一样每 100 像素 1 度
  panBy([x, y]: [number, number], options: { animate: false }, eventData: CameraEventData): void {
    this.calls.push(['panBy', [x, y], options, eventData]);
    this.moveTo({ ...this.camera, lng: this.camera.lng + x / 100, lat: this.camera.lat - y / 100 }, eventData);
  }

  fitBounds(
    bounds: [number, number, number, number],
    options: { maxZoom?: number; duration?: number },
    eventData: CameraEventData
  ): void {
    this.calls.push(['fitBounds', bounds, options, eventData]);
    const [west, south, east, north] = bounds;
    this.#animated(options.duration, () =>
      this.moveTo(
        { ...this.camera, lng: (west + east) / 2, lat: (south + north) / 2, zoom: options.maxZoom ?? 10 },
        eventData
      )
    );
  }

  // animate 为真时，带时长的 flyTo、fitBounds 先不到位（动画进行中），endAnimation 时才到位；新的定位打断它，像 MapLibre 一样发出 moveend
  animate = false;
  #inFlight: (() => void) | null = null;

  #animated(duration: number | undefined, arrive: () => void): void {
    if (this.#inFlight) {
      this.#inFlight = null;
      this.fire('moveend');
    }
    if (this.animate && duration !== 0) {
      this.#inFlight = arrive;
      return;
    }
    arrive();
    this.fire('moveend');
  }

  /** 动画被打断（用户开始拖动）：停在原地，发出 moveend */
  interrupt(): void {
    this.#inFlight = null;
    this.fire('moveend');
  }

  /** 动画到达终点 */
  endAnimation(): void {
    const arrive = this.#inFlight;
    this.#inFlight = null;
    arrive?.();
    this.fire('moveend');
  }

  // queryRenderedFeatures 返回的要素，用例按需设置
  rendered: RenderedFeatureLike[] = [];

  queryRenderedFeatures(
    geometry: [number, number] | [[number, number], [number, number]],
    options: { layers: string[] }
  ): RenderedFeatureLike[] {
    this.calls.push(['queryRenderedFeatures', geometry, options]);
    return this.rendered;
  }

  // 屏幕坐标与经纬度的固定换算：画布左上角 (0, 0) 是 (118, 33)，每 100 像素 1 度，向下纬度减小
  unproject([x, y]: [number, number]) {
    return { lng: 118 + x / 100, lat: 33 - y / 100 };
  }

  project([lng, lat]: [number, number]) {
    return { x: (lng - 118) * 100, y: (33 - lat) * 100 };
  }

  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  getCanvasContainer(): HTMLElement {
    return this.canvasContainer;
  }

  remove(): void {
    this.removed = true;
    this.calls.push(['remove']);
  }

  /** 模拟鼠标事件：MapLibre 的事件带画布上的点和原始的 DOM 事件 */
  mouse(type: MapMouseEventType, x: number, y: number, init: MouseEventInit = {}): void {
    this.fire(type, { point: { x, y }, originalEvent: new MouseEvent(type, init) });
  }

  /** 在画布上按下鼠标（DOM 事件）：先经过适配器在捕获阶段的监听，没被截下才发出地图事件 */
  press(x: number, y: number, init: MouseEventInit = {}): void {
    this.canvas.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: x, clientY: y, ...init }));
  }

  /** 模拟用户拖动：带原始的 DOM 事件 */
  drag(lng: number, lat: number): void {
    this.moveTo({ ...this.camera, lng, lat }, { originalEvent: new MouseEvent('mousemove') });
  }

  // 立即到位的移动：和 jumpTo 一样先发 movestart 再发 move
  moveTo(camera: FakeCamera, event: FakeEvent): void {
    this.camera = { ...camera, pitch: Math.min(camera.pitch, this.maxPitch) };
    this.fire('movestart', event);
    this.fire('move', event);
  }

  styleCalls(): unknown[][] {
    return this.calls.filter(([name]) => !CAMERA_CALLS.has(String(name)));
  }

  #record(name: string) {
    return (...args: unknown[]) => {
      if (this.failOn === name) {
        throw new Error(`${name} failed`);
      }
      if (this.rejectOn === name) {
        this.fire('error', { error: new Error(`${name} rejected`) });
        return;
      }
      this.calls.push([name, ...args]);
      if (this.sourceErrorOn === name) {
        this.fire('error', { error: new Error(`${String(args[0])} failed to load`), sourceId: String(args[0]) });
      }
    };
  }
}

// 记下收到的输入和视图的工具
function recordingTool(options: Partial<MapTool> = {}) {
  const inputs: MapInputEvent[] = [];
  const views: ToolView[] = [];
  const tool: MapTool = {
    persistent: false,
    handleInput: (event, view) => {
      inputs.push(event);
      views.push(view);
    },
    ...options
  };
  return { tool, inputs, views };
}

// 临时拖动的移动、松开在文档上（指针可以移出画布）
const moveOnDocument = (x: number, y: number, init: MouseEventInit = {}) =>
  document.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, buttons: 1, ...init }));
const releaseOnDocument = () => document.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
const holdCtrl = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true }));

// 像点/框选一样：关掉拖动平移，按住 Ctrl 临时拖动
function pickTool() {
  return recordingTool({ persistent: true, cursor: 'crosshair', gestures: { dragPan: false }, panModifier: 'ctrl' });
}

type Groups = 'basemap' | 'business';

function setup(
  options: Partial<
    Pick<MapLibreViewOptions<Groups>, 'active' | 'mapOptions' | 'createMap' | 'onError' | 'scrollZoomRates'>
  > = {},
  camera = NANJING
) {
  const stack = new DisposableStack();
  const session = stack.use(new MapSession({ groups: ['basemap', 'business'], camera }));
  const errors: unknown[] = [];
  const states: ViewState[] = [];
  let map: FakeMap | undefined;
  const view = stack.use(
    new MapLibreView({
      session,
      container: document.createElement('div'),
      createMap: mapOptions => (map = new FakeMap(mapOptions)),
      onError: error => errors.push(error),
      ...options
    })
  );
  if (view.state !== 'failed') {
    view.on('statechange', state => states.push(state));
  }
  return {
    session,
    view,
    errors,
    states,
    get map(): FakeMap {
      if (map === undefined) {
        throw new Error('地图没有创建');
      }
      return map;
    },
    [Symbol.dispose]: () => stack.dispose()
  };
}

function lineGroup(id: string, color = '#336699'): StyleGroup {
  return {
    sources: { [id]: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } },
    layers: [{ id: `${id}-line`, type: 'line', source: id, paint: { 'line-color': color } }]
  };
}

// 渲染要素查询返回的几何
const POINT: Geometry = { type: 'Point', coordinates: [119, 31] };

// 只有样式图片的分组
const stripe = { width: 1, height: 1, data: new Uint8Array(4), sdf: true };
const imageGroup = (images: StyleGroup['images']): StyleGroup => ({ sources: {}, layers: [], images });

// 矢量瓦片的数据源：年份不同时地址不同
function tileGroup(id: string, year: number): StyleGroup {
  return {
    sources: { [id]: { type: 'vector', tiles: [`https://tiles.test/${id}_${year}/{z}/{x}/{y}.pbf`] } },
    layers: [{ id: `${id}-fill`, type: 'fill', source: id, 'source-layer': id }]
  };
}

// 就绪后加上 tdt、dltb 两个数据源，返回之后数据源错误的每次变化
async function addTwoSources(ctx: ReturnType<typeof setup>): Promise<SourceErrors[]> {
  ctx.map.fire('style.load');
  ctx.session.style.setGroups({ basemap: lineGroup('tdt'), business: lineGroup('dltb') });
  await nextMicrotask();
  const changes: SourceErrors[] = [];
  ctx.view.on('sourceerrorchange', errors => changes.push(errors));
  return changes;
}

function names(calls: unknown[][]): unknown[] {
  return calls.map(([name]) => name);
}

// 自己会抛错的错误报告器
function throwingReporter(): never {
  throw new Error('报告器出错');
}

// 地图就绪 → 暂停 → 修改样式（addLayer 会被拒绝），恢复显示时追赶触发整体重建
async function resumeIntoRebuild() {
  const ctx = setup();
  ctx.map.fire('style.load');
  ctx.view.pause();
  ctx.map.rejectOn = 'addLayer';
  ctx.session.style.setGroup('business', lineGroup('dltb'));
  await nextMicrotask();
  ctx.view.resume();
  ctx.map.rejectOn = undefined;
  return ctx;
}

describe('MapLibreView', () => {
  it('works with the MapLibre map', () => {
    expectTypeOf<MapLibreMap>().toExtend<MapLike>();
  });

  describe('failure', () => {
    it('引擎失败：不支持 WebGL2 时原因是 webgl-unavailable', () => {
      const unavailable = new GPUInitializationError({}, null);
      using ctx = setup({
        createMap: () => {
          throw unavailable;
        }
      });

      expect(ctx.view.failure).toEqual({ kind: 'engine', cause: 'webgl-unavailable', error: unavailable });
    });

    it('引擎失败：其他创建错误、运行中 setStyle 抛错时原因是 unknown，之后的事件不改变它', async () => {
      using ctx = setup();
      ctx.map.fire('style.load');
      const business = lineGroup('dltb');
      ctx.session.style.setGroup('business', business);
      await nextMicrotask();
      // 修改已有图层的未知属性是不支持的命令，触发整体重建，setStyle 本身抛错
      ctx.map.failOn = 'setStyle';
      const flagged = { ...business.layers[0], 'custom-flag': true } as unknown as LayerSpecification;
      ctx.session.style.setGroup('business', { ...business, layers: [flagged] });
      await nextMicrotask();

      ctx.map.failOn = undefined;
      ctx.map.fire('error', { error: new Error('invalid style') });

      expect(ctx.view.failure).toEqual({ kind: 'engine', cause: 'unknown', error: new Error('setStyle failed') });
    });

    it('样式失败后同一轮里加载又完成、追赶时整体重建遇到引擎失败：原因换成引擎失败，之后不再恢复', async () => {
      using ctx = setup();
      const seen: string[] = [];
      ctx.view.on('statechange', state => seen.push(`${state}${ctx.view.failure ? `(${ctx.view.failure.kind})` : ''}`));
      ctx.map.fire('error', { error: new Error('invalid style') });
      // 同一轮里：提交了新的样式（通知还在微任务里），报错之后的加载又完成了，追赶时增量命令被拒绝、整体重建时 setStyle 抛错
      ctx.map.rejectOn = 'addLayer';
      ctx.map.failOn = 'setStyle';
      ctx.session.style.setGroup('business', lineGroup('dltb'));
      ctx.map.fire('style.load');

      expect(ctx.view.failure).toMatchObject({ kind: 'engine', error: new Error('setStyle failed') });
      await nextMicrotask();
      ctx.map.rejectOn = undefined;
      ctx.map.failOn = undefined;
      ctx.map.fire('style.load');

      expect(ctx.view.state).toBe('failed');
      expect(ctx.view.failure?.kind).toBe('engine');
      expect(seen).toStrictEqual(['failed(style)', 'initializing', 'failed(engine)']);
      expect(ctx.errors.filter(error => error instanceof Error && error.message.includes('不能从'))).toStrictEqual([]);
    });

    it('样式失败：监听者收到 failed 时已经能读到原因；出现新版本重新加载时清空', async () => {
      using ctx = setup();
      const seen: unknown[] = [];
      ctx.view.on('statechange', state => seen.push([state, ctx.view.failure]));
      const invalid = new Error('layers[0].paint.line-width: number expected');

      ctx.map.fire('error', { error: invalid });
      ctx.session.style.setGroup('business', lineGroup('dltb'));
      await nextMicrotask();
      ctx.map.fire('style.load');

      expect(seen).toEqual([
        ['failed', { kind: 'style', error: invalid }],
        ['initializing', null],
        ['ready', null]
      ]);
    });

    it('没有失败时为 null；释放后为 null', () => {
      using ctx = setup({
        createMap: () => {
          throw new Error('WebGL2 unavailable');
        }
      });
      using healthy = setup();
      expect(healthy.view.failure).toBeNull();
      expect(ctx.view.failure?.kind).toBe('engine');

      ctx.view[Symbol.dispose]();

      expect(ctx.view.failure).toBeNull();
    });
  });

  describe('onError 自身抛错', () => {
    it('样式加载失败时照常进入 failed、结束 whenReady，异常不冒进 MapLibre 的事件分发', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        using ctx = setup({ onError: throwingReporter });
        const invalid = new Error('layers[0].paint.line-width: number expected');

        expect(() => ctx.map.fire('error', { error: invalid })).not.toThrow();

        expect(ctx.view.state).toBe('failed');
        expect(ctx.view.failure).toEqual({ kind: 'style', error: invalid });
        await expect(settled(ctx.view.whenReady())).rejects.toBe(invalid);
        // 报告器失败时改为打印到控制台，原始错误不丢
        expect(consoleError).toHaveBeenCalledWith(expect.any(String), new Error('报告器出错'), invalid);
      } finally {
        consoleError.mockRestore();
      }
    });

    it('创建地图失败时照常进入 failed，构造不抛错', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        const failure = new Error('WebGL2 unavailable');
        const create = () =>
          setup({
            onError: throwingReporter,
            createMap: () => {
              throw failure;
            }
          });

        expect(() => create()[Symbol.dispose]()).not.toThrow();
        using ctx = create();
        expect(ctx.view.state).toBe('failed');
        await expect(settled(ctx.view.whenReady())).rejects.toBe(failure);
      } finally {
        consoleError.mockRestore();
      }
    });

    it('应用命令期间的错误照常触发整体重建', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        using ctx = setup({ onError: throwingReporter });
        ctx.map.fire('style.load');
        ctx.map.rejectOn = 'addLayer';

        ctx.session.style.setGroup('business', lineGroup('dltb'));
        await nextMicrotask();

        expect(names(ctx.map.styleCalls())).toContain('setStyle');
      } finally {
        consoleError.mockRestore();
      }
    });
  });

  describe('数据源错误（ADR 0041 第 5、6 节）', () => {
    it('就绪时收到：每个数据源只记第一条，照常交给 onError，视图状态和样式都不变', async () => {
      using ctx = setup();
      const changes = await addTwoSources(ctx);
      const first = new Error('Unable to parse the tile');
      const again = new Error('Unable to parse another tile');

      ctx.map.fire('error', { error: first, sourceId: 'dltb' });
      ctx.map.fire('error', { error: again, sourceId: 'dltb' });

      expect(ctx.view.sourceErrors).toStrictEqual(new Map([['dltb', first]]));
      expect(changes).toStrictEqual([ctx.view.sourceErrors]);
      expect(ctx.errors).toStrictEqual([first, again]);
      expect(ctx.view.state).toBe('ready');
      expect(names(ctx.map.styleCalls())).not.toContain('setStyle');
    });

    it('样式加载期间收到：不算样式加载失败，style.load 后照常就绪，记录保留', async () => {
      using ctx = setup();
      const failed = new Error('dltb failed to load');

      ctx.map.fire('error', { error: failed, sourceId: 'dltb' });
      expect(ctx.view.state).toBe('initializing');
      ctx.map.fire('style.load');

      await expect(settled(ctx.view.whenReady())).resolves.toBeUndefined();
      expect(ctx.states).toStrictEqual(['ready']);
      expect(ctx.view.sourceErrors.get('dltb')).toBe(failed);
    });

    it('应用命令期间同步收到：不整体重建，照样记下', async () => {
      using ctx = setup();
      ctx.map.fire('style.load');
      ctx.map.sourceErrorOn = 'addSource';

      ctx.session.style.setGroup('business', lineGroup('dltb'));
      await nextMicrotask();

      expect(names(ctx.map.styleCalls())).toStrictEqual(['addSource', 'addLayer']);
      expect([...ctx.view.sourceErrors.keys()]).toStrictEqual(['dltb']);
    });

    it('数据源移除时清掉它的记录，其他数据源的保留', async () => {
      using ctx = setup();
      const changes = await addTwoSources(ctx);
      ctx.map.fire('error', { error: new Error('tdt'), sourceId: 'tdt' });
      ctx.map.fire('error', { error: new Error('dltb'), sourceId: 'dltb' });

      ctx.session.style.setGroup('business', { sources: {}, layers: [] });
      await nextMicrotask();

      expect([...ctx.view.sourceErrors.keys()]).toStrictEqual(['tdt']);
      expect(changes.map(errors => Array.from(errors.keys()))).toStrictEqual([['tdt'], ['tdt', 'dltb'], ['tdt']]);
    });

    it('数据源换了地址（如换年份，先移除再添加）：清掉它的记录', async () => {
      using ctx = setup();
      ctx.map.fire('style.load');
      ctx.session.style.setGroup('business', tileGroup('dltb', 2022));
      await nextMicrotask();
      ctx.map.fire('error', { error: new Error('2022 failed'), sourceId: 'dltb' });

      ctx.session.style.setGroup('business', tileGroup('dltb', 2023));
      await nextMicrotask();

      const replaced = names(ctx.map.styleCalls()).slice(2);
      expect(replaced).toStrictEqual(['removeLayer', 'removeSource', 'addSource', 'addLayer']);
      expect(ctx.view.sourceErrors).toBe(NO_SOURCE_ERRORS);
    });

    it('整体重建开始时全部清掉，没有变化的数据源也一样；释放后为空', async () => {
      using ctx = setup();
      const changes = await addTwoSources(ctx);
      ctx.map.fire('error', { error: new Error('tdt'), sourceId: 'tdt' });

      // 只改 business：tdt 不会被移除，记录只能由整体重建清掉
      ctx.map.rejectOn = 'addLayer';
      ctx.session.style.setGroup('business', lineGroup('lcsh'));
      await nextMicrotask();

      expect(names(ctx.map.styleCalls()).at(-1)).toBe('setStyle');
      expect(ctx.view.sourceErrors).toBe(NO_SOURCE_ERRORS);
      expect(changes.at(-1)).toBe(NO_SOURCE_ERRORS);
      ctx.map.rejectOn = undefined;
      ctx.map.fire('style.load');
      ctx.map.fire('error', { error: new Error('tdt again'), sourceId: 'tdt' });
      expect(ctx.view.sourceErrors.size).toBe(1);

      ctx.view[Symbol.dispose]();
      expect(ctx.view.sourceErrors).toBe(NO_SOURCE_ERRORS);
    });
  });

  describe('lifecycle', () => {
    it('creates the map from the current style snapshot and the session camera', () => {
      using ctx = setup({ mapOptions: { maxZoom: 18 } });

      expect(ctx.map.options).toMatchObject({ center: [118.8, 32.05], zoom: 8, bearing: 0, pitch: 0, maxZoom: 18 });
      // 不用 MapLibre 的版权控件（ADR 0053 第 5 节）
      expect(ctx.map.options.attributionControl).toBe(false);
      expect(ctx.map.options.style).toBe(ctx.session.style.current);
      expect(ctx.map.options.container).toBeInstanceOf(HTMLElement);
      expect(ctx.view.state).toBe('initializing');
    });

    it('becomes ready when the style has loaded', async () => {
      using ctx = setup();

      ctx.map.fire('style.load');

      await expect(ctx.view.whenReady()).resolves.toBeUndefined();
      expect(ctx.states).toEqual(['ready']);
    });

    it('enters paused after loading when created inactive', async () => {
      using ctx = setup({ active: false });

      ctx.map.fire('style.load');

      await expect(ctx.view.whenReady()).resolves.toBeUndefined();
      expect(ctx.view.state).toBe('paused');
    });

    it('enters paused after loading when paused while initializing', () => {
      using ctx = setup();

      ctx.view.pause();
      ctx.map.fire('style.load');

      expect(ctx.states).toEqual(['paused']);
    });

    it('fails without throwing when the map cannot be created', async () => {
      const failure = new Error('WebGL2 unavailable');
      const create = () =>
        setup({
          createMap: () => {
            throw failure;
          }
        });

      expect(() => create()[Symbol.dispose]()).not.toThrow();
      using ctx = create();
      expect(ctx.view.state).toBe('failed');
      await expect(settled(ctx.view.whenReady())).rejects.toBe(failure);
      expect(ctx.errors).toEqual([failure]);
      expect(() => ctx.view.flyTo({ zoom: 10 })).toThrow('当前状态为 failed');
    });

    it('fails when MapLibre rejects the initial style with error events only', async () => {
      using ctx = setup();
      const invalid = new Error('layers[0].paint.line-width: number expected');

      // MapLibre 校验整份样式失败时只触发 error，不触发 style.load
      ctx.map.fire('error', { error: invalid });

      expect(ctx.view.state).toBe('failed');
      expect(ctx.states).toEqual(['failed']);
      await expect(settled(ctx.view.whenReady())).rejects.toBe(invalid);
      expect(ctx.errors).toEqual([invalid]);
    });

    it('reloads the next style revision after a failed load and becomes ready again', async () => {
      using ctx = setup();
      ctx.map.fire('error', { error: new Error('invalid style') });

      ctx.session.style.setGroup('business', lineGroup('dltb'));
      await nextMicrotask();

      expect(ctx.map.styleCalls()).toEqual([['setStyle', ctx.session.style.current, { diff: false }]]);
      expect(ctx.view.state).toBe('initializing');
      const ready = ctx.view.whenReady();
      ctx.map.fire('style.load');
      await expect(settled(ready)).resolves.toBeUndefined();
      expect(ctx.states).toEqual(['failed', 'initializing', 'ready']);
    });

    it('does not reload the same style revision again after a failed load', async () => {
      using ctx = setup();
      ctx.map.fire('error', { error: new Error('invalid style') });

      ctx.view.pause();
      ctx.view.resume();
      ctx.map.fire('error', { error: new Error('tile 404') });
      await nextMicrotask();

      expect(ctx.map.styleCalls()).toEqual([]);
      expect(ctx.view.state).toBe('failed');
    });

    it('keeps pause and resume made while initializing or failed', async () => {
      using ctx = setup();
      ctx.view.pause();
      ctx.map.fire('error', { error: new Error('invalid style') });
      ctx.session.style.setGroup('business', lineGroup('dltb'));
      await nextMicrotask();

      ctx.map.fire('style.load');
      expect(ctx.view.state).toBe('paused');
      ctx.view.resume();
      expect(ctx.states).toEqual(['failed', 'initializing', 'paused', 'ready']);
    });

    it('becomes ready when style.load still arrives after an error event', async () => {
      using ctx = setup();

      // 加载期间的 error 不一定致命，以 style.load 为准
      ctx.map.fire('error', { error: new Error('sprite 404') });
      ctx.map.fire('style.load');

      expect(ctx.states).toEqual(['failed', 'ready']);
      await expect(settled(ctx.view.whenReady())).resolves.toBeUndefined();
    });

    it('catches up the changes made while reloading', async () => {
      using ctx = setup();
      ctx.map.fire('error', { error: new Error('invalid style') });
      ctx.session.style.setGroup('business', lineGroup('dltb'));
      await nextMicrotask();

      ctx.session.style.setGroup('basemap', lineGroup('tdt'));
      await nextMicrotask();
      expect(names(ctx.map.styleCalls())).toEqual(['setStyle']);

      ctx.map.fire('style.load');
      expect(names(ctx.map.styleCalls())).toEqual(['setStyle', 'addSource', 'addLayer']);
    });

    it('fails again without retrying when the reloaded revision is rejected too', async () => {
      using ctx = setup();
      ctx.map.fire('error', { error: new Error('invalid style') });
      ctx.session.style.setGroup('business', lineGroup('dltb'));
      await nextMicrotask();

      ctx.map.fire('error', { error: new Error('still invalid') });
      ctx.map.fire('error', { error: new Error('tile 404') });
      await nextMicrotask();

      expect(ctx.states).toEqual(['failed', 'initializing', 'failed']);
      expect(names(ctx.map.styleCalls())).toEqual(['setStyle']);
    });

    it('releases the map and stops following the session on disposal', async () => {
      using ctx = setup();
      const { view, map, session } = ctx;
      const ready = view.whenReady();

      view[Symbol.dispose]();

      await expect(settled(ready)).rejects.toMatchObject({ name: 'AbortError' });
      expect(map.removed).toBe(true);
      expect(map.listenerCount()).toBe(0);
      map.fire('style.load');
      session.style.setGroup('business', lineGroup('dltb'));
      await nextMicrotask();
      expect(view.state).toBe('disposed');
      expect(map.styleCalls()).toEqual([]);
      expect(() => view.pause()).toThrow('MapLibreView 已释放');
      expect(() => view[Symbol.dispose]()).not.toThrow();
    });

    it('unsubscribes from the session on disposal', () => {
      const unsubscribe = vi.fn<() => void>();
      // 释放后的状态检查会挡住晚到的通知，所以直接确认取消订阅被调用，避免会话一直引用视图
      using spy = vi.spyOn(StyleModel.prototype, 'on').mockReturnValue(unsubscribe);
      using ctx = setup();

      ctx.view[Symbol.dispose]();

      expect(spy).toHaveBeenCalledOnce();
      expect(unsubscribe).toHaveBeenCalledOnce();
    });
  });

  describe('style', () => {
    it('applies the commands of a style change when ready', async () => {
      using ctx = setup();
      ctx.map.fire('style.load');

      ctx.session.style.setGroup('business', lineGroup('dltb'));
      await nextMicrotask();

      expect(names(ctx.map.styleCalls())).toEqual(['addSource', 'addLayer']);
    });

    it('catches up after loading when the session changed meanwhile', async () => {
      using ctx = setup();

      ctx.session.style.setGroup('business', lineGroup('dltb'));
      await nextMicrotask();
      expect(ctx.map.styleCalls()).toEqual([]);

      ctx.map.fire('style.load');
      expect(names(ctx.map.styleCalls())).toEqual(['addSource', 'addLayer']);
    });

    it('ignores changes while paused and catches up with one diff on resume', async () => {
      using ctx = setup();
      ctx.map.fire('style.load');
      ctx.view.pause();
      const business = lineGroup('dltb');

      ctx.session.style.setGroup('business', business);
      await nextMicrotask();
      ctx.session.style.setGroup('business', { ...business, layers: [{ ...business.layers[0], paint: { 'line-color': '#993366' } }] as LayerSpecification[] });
      await nextMicrotask();
      expect(ctx.map.styleCalls()).toEqual([]);

      ctx.view.resume();
      const calls = ctx.map.styleCalls();
      expect(names(calls)).toEqual(['addSource', 'addLayer']);
      expect(calls[1]?.[1]).toMatchObject({ paint: { 'line-color': '#993366' } });
    });

    it('rebuilds from the current snapshot when the map rejects a command', async () => {
      using ctx = setup();
      ctx.map.fire('style.load');

      ctx.map.failOn = 'addLayer';
      ctx.session.style.setGroup('business', lineGroup('dltb'));
      await nextMicrotask();

      expect(ctx.errors).toEqual([new Error('addLayer failed')]);
      expect(ctx.map.styleCalls().at(-1)).toEqual(['setStyle', ctx.session.style.current, { diff: false }]);

      // 重建完成之前的变化，等 style.load 后再追上
      ctx.map.failOn = undefined;
      ctx.session.style.setGroup('basemap', lineGroup('tdt'));
      await nextMicrotask();
      expect(names(ctx.map.styleCalls())).toEqual(['addSource', 'setStyle']);

      ctx.map.fire('style.load');
      expect(ctx.map.styleCalls().slice(2)).toEqual([
        ['addSource', 'tdt', lineGroup('tdt').sources.tdt],
        ['addLayer', lineGroup('tdt').layers[0], 'dltb-line']
      ]);
    });

    describe('images', () => {

      it('adds the images of the snapshot it was created from on style.load', async () => {
        using stack = new DisposableStack();
        const session = stack.use(new MapSession({ groups: ['basemap', 'business'], camera: NANJING }));
        session.style.setGroup('business', imageGroup({ stripe }));
        await nextMicrotask();
        let map: FakeMap | undefined;
        stack.use(
          new MapLibreView({
            session,
            container: document.createElement('div'),
            createMap: options => (map = new FakeMap(options))
          })
        );

        map?.fire('style.load');
        expect(map?.styleCalls()).toStrictEqual([
          ['addImage', 'stripe', { width: 1, height: 1, data: stripe.data }, { pixelRatio: 1, sdf: true }]
        ]);
      });

      it('applies image-only commits while ready: add, update pixels, remove', async () => {
        using ctx = setup();
        ctx.map.fire('style.load');

        ctx.session.style.setGroup('business', imageGroup({ stripe }));
        await nextMicrotask();
        ctx.session.style.setGroup('business', imageGroup({ stripe: { ...stripe, data: new Uint8Array(4).fill(9) } }));
        await nextMicrotask();
        ctx.session.style.setGroup('business', imageGroup({}));
        await nextMicrotask();

        expect(names(ctx.map.styleCalls())).toEqual(['addImage', 'updateImage', 'removeImage']);
      });

      it('catches up image changes made while paused on resume', async () => {
        using ctx = setup();
        ctx.map.fire('style.load');
        ctx.view.pause();

        ctx.session.style.setGroup('business', imageGroup({ stripe }));
        await nextMicrotask();
        expect(ctx.map.styleCalls()).toEqual([]);

        ctx.view.resume();
        expect(names(ctx.map.styleCalls())).toEqual(['addImage']);
      });

      it('records the images it applied, so a later catch-up compares from them', async () => {
        using ctx = setup();
        ctx.map.fire('style.load');
        ctx.session.style.setGroup('business', imageGroup({ stripe }));
        await nextMicrotask();
        ctx.view.pause();

        ctx.session.style.setGroup('business', imageGroup({}));
        await nextMicrotask();
        ctx.view.resume();

        expect(names(ctx.map.styleCalls())).toEqual(['addImage', 'removeImage']);
      });

      it('adds every image of the rebuilt snapshot after a rebuild, then catches up the commits made meanwhile', async () => {
        using ctx = setup();
        ctx.map.fire('style.load');
        ctx.session.style.setGroup('business', imageGroup({ stripe }));
        await nextMicrotask();

        ctx.map.failOn = 'addLayer';
        ctx.session.style.setGroup('basemap', lineGroup('tdt'));
        await nextMicrotask();
        expect(names(ctx.map.styleCalls()).at(-1)).toBe('setStyle');

        // 重建完成之前又换了图片
        ctx.map.failOn = undefined;
        const dots = { width: 2, height: 1, data: new Uint8Array(8) };
        ctx.session.style.setGroup('business', imageGroup({ dots }));
        await nextMicrotask();
        const before = ctx.map.styleCalls().length;

        ctx.map.fire('style.load');
        expect(ctx.map.styleCalls().slice(before).map(([name, id]) => [name, id])).toEqual([
          ['addImage', 'stripe'],
          ['addImage', 'dots'],
          ['removeImage', 'stripe']
        ]);
      });
    });

    it('rebuilds from the current snapshot when the map rejects a command with an error event', async () => {
      using ctx = setup();
      ctx.map.fire('style.load');

      // MapLibre 的 addLayer 校验失败时不抛错，只触发 error 事件，图层实际上没有加上
      ctx.map.rejectOn = 'addLayer';
      ctx.session.style.setGroup('business', lineGroup('dltb'));
      await nextMicrotask();

      expect(ctx.errors).toEqual([new Error('addLayer rejected')]);
      expect(ctx.map.styleCalls().at(-1)).toEqual(['setStyle', ctx.session.style.current, { diff: false }]);
    });

    it('fails instead of rebuilding again when the rebuilt snapshot is rejected as well', async () => {
      using ctx = setup();
      ctx.map.fire('style.load');
      ctx.map.rejectOn = 'addLayer';
      ctx.session.style.setGroup('business', lineGroup('dltb'));
      await nextMicrotask();

      // 整份样式同样通不过校验：只有 error，没有 style.load
      ctx.map.fire('error', { error: new Error('invalid style') });
      expect(ctx.view.state).toBe('failed');
      expect(names(ctx.map.styleCalls())).toEqual(['addSource', 'setStyle']);

      // 修正后的新版本重新完整加载一次
      ctx.map.rejectOn = undefined;
      ctx.session.style.setGroup('business', lineGroup('dltb', '#993366'));
      await nextMicrotask();
      expect(names(ctx.map.styleCalls())).toEqual(['addSource', 'setStyle', 'setStyle']);
      ctx.map.fire('style.load');
      expect(ctx.view.state).toBe('ready');
    });

    it('renews whenReady with the failure when a rebuild fails after the view was ready', async () => {
      using ctx = setup();
      ctx.map.fire('style.load');
      await ctx.view.whenReady();
      ctx.map.rejectOn = 'addLayer';
      ctx.session.style.setGroup('business', lineGroup('dltb'));
      await nextMicrotask();
      const invalid = new Error('invalid style');
      let readyOnStateChange: Promise<void> | undefined;
      ctx.view.on('statechange', () => {
        readyOnStateChange = ctx.view.whenReady();
      });

      ctx.map.fire('error', { error: invalid });

      await expect(settled(ctx.view.whenReady())).rejects.toBe(invalid);
      // 监听 statechange 的人拿到的就是这一轮的结果，而不是之前已经结束的那个
      expect(readyOnStateChange).toBe(ctx.view.whenReady());
    });

    it('stays failed when setStyle itself throws', async () => {
      using ctx = setup();
      ctx.map.fire('style.load');
      const business = lineGroup('dltb');
      ctx.session.style.setGroup('business', business);
      await nextMicrotask();

      // 不支持的命令触发整体重建，setStyle 本身抛错：引擎出了问题，不能恢复
      ctx.map.failOn = 'setStyle';
      const flagged = { ...business.layers[0], 'custom-flag': true } as unknown as LayerSpecification;
      ctx.session.style.setGroup('business', { ...business, layers: [flagged] });
      await nextMicrotask();
      expect(ctx.view.state).toBe('failed');
      expect(ctx.errors).toEqual([new Error('setStyle failed')]);

      // 之后的 error、新版本、style.load 都不再改变状态
      ctx.map.failOn = undefined;
      ctx.map.fire('error', { error: new Error('invalid style') });
      ctx.session.style.setGroup('business', lineGroup('dltb', '#993366'));
      await nextMicrotask();
      ctx.map.fire('style.load');
      expect(names(ctx.map.styleCalls())).toEqual(['addSource', 'addLayer']);
      expect(ctx.states).toEqual(['ready', 'failed']);
      // whenReady 仍然是引擎失败的原因
      await expect(settled(ctx.view.whenReady())).rejects.toEqual(new Error('setStyle failed'));
    });

    it('does not reload for a pending notification of the revision that just failed', async () => {
      using ctx = setup();
      ctx.map.fire('style.load');
      ctx.view.pause();
      ctx.map.rejectOn = 'addLayer';

      // 提交后立即恢复显示：恢复时就追上了这个版本，它的通知还排在微任务里
      ctx.session.style.setGroup('business', lineGroup('dltb'));
      ctx.view.resume();
      ctx.map.fire('error', { error: new Error('invalid style') });
      expect(ctx.view.state).toBe('failed');
      await nextMicrotask();

      expect(names(ctx.map.styleCalls())).toEqual(['addSource', 'setStyle']);
    });

    it('rebuilds without reporting an error for a command it does not support', async () => {
      using ctx = setup();
      ctx.map.fire('style.load');
      const business = lineGroup('dltb');
      ctx.session.style.setGroup('business', business);
      await nextMicrotask();

      // 未知的图层属性会让 style-spec 生成 setLayerProperty，MapLibre 没有对应的公开方法
      const flagged = { ...business.layers[0], 'custom-flag': true } as unknown as LayerSpecification;
      ctx.session.style.setGroup('business', { ...business, layers: [flagged] });
      await nextMicrotask();

      expect(ctx.map.styleCalls().at(-1)).toEqual(['setStyle', ctx.session.style.current, { diff: false }]);
      expect(ctx.errors).toEqual([]);
    });

    it('reports MapLibre error events without rebuilding', async () => {
      using ctx = setup();
      ctx.map.fire('style.load');
      const failure = new Error('tile 404');

      ctx.map.fire('error', { error: failure });

      expect(ctx.errors).toEqual([failure]);
      expect(ctx.map.styleCalls()).toEqual([]);
      // 样式已经加载完成，这类错误不影响状态，之后照常增量同步
      expect(ctx.view.state).toBe('ready');
      ctx.session.style.setGroup('business', lineGroup('dltb'));
      await nextMicrotask();
      expect(names(ctx.map.styleCalls())).toEqual(['addSource', 'addLayer']);
    });
  });

  describe('style recovery', () => {
    it('reloads the latest revision at once when the loading revision fails after a newer one was committed', async () => {
      using ctx = setup();
      // 加载期间提交的版本：通知到达时还在加载，先不处理
      ctx.session.style.setGroup('business', lineGroup('dltb'));
      await nextMicrotask();
      const ready = ctx.view.whenReady();

      ctx.map.fire('error', { error: new Error('invalid style') });
      await nextMicrotask();

      // 已经有可以尝试的新版本，不进入 failed
      expect(ctx.map.styleCalls()).toEqual([['setStyle', ctx.session.style.current, { diff: false }]]);
      expect(ctx.states).toEqual([]);
      ctx.map.fire('style.load');
      await expect(settled(ready)).resolves.toBeUndefined();
      expect(ctx.states).toEqual(['ready']);
    });

    it('reloads the latest revision at once when a rebuild fails after a newer one was committed', async () => {
      using ctx = setup();
      ctx.map.fire('style.load');
      ctx.map.rejectOn = 'addLayer';
      ctx.session.style.setGroup('business', lineGroup('dltb'));
      await nextMicrotask();
      ctx.map.rejectOn = undefined;
      ctx.session.style.setGroup('business', lineGroup('dltb', '#993366'));
      await nextMicrotask();

      ctx.map.fire('error', { error: new Error('invalid style') });
      await nextMicrotask();

      expect(names(ctx.map.styleCalls())).toEqual(['addSource', 'setStyle', 'setStyle']);
      expect(ctx.map.styleCalls().at(-1)).toEqual(['setStyle', ctx.session.style.current, { diff: false }]);
      expect(ctx.states).toEqual(['ready']);
    });

    it('treats every error of one failed load as the failure of that load', async () => {
      using ctx = setup();
      ctx.session.style.setGroup('business', lineGroup('dltb'));
      await nextMicrotask();

      // MapLibre 对每条校验错误各发一次 error；重新加载要等它们发完，否则后面的会被当成新版本的失败
      ctx.map.fire('error', { error: new Error('layers[0].paint.line-width: number expected') });
      ctx.map.fire('error', { error: new Error('layers[1].paint.line-color: color expected') });
      await nextMicrotask();

      expect(ctx.map.styleCalls()).toEqual([['setStyle', ctx.session.style.current, { diff: false }]]);
      ctx.map.fire('style.load');
      expect(ctx.states).toEqual(['ready']);
    });

    it('does not reload after disposal even if a newer revision was waiting', async () => {
      using ctx = setup();
      ctx.session.style.setGroup('business', lineGroup('dltb'));
      await nextMicrotask();

      ctx.map.fire('error', { error: new Error('invalid style') });
      ctx.view[Symbol.dispose]();
      await nextMicrotask();

      expect(ctx.map.styleCalls()).toEqual([]);
    });

    it('keeps syncing incrementally from the snapshot that finally loaded after an error', async () => {
      using ctx = setup();
      ctx.map.fire('error', { error: new Error('sprite 404') });
      ctx.map.fire('style.load');

      ctx.session.style.setGroup('business', lineGroup('dltb'));
      await nextMicrotask();

      expect(names(ctx.map.styleCalls())).toEqual(['addSource', 'addLayer']);
      expect(ctx.states).toEqual(['failed', 'ready']);
    });

    it('catches up the revisions committed while loading when the load completes after an error', async () => {
      using ctx = setup();
      ctx.session.style.setGroup('business', lineGroup('dltb'));
      await nextMicrotask();

      // 同一次加载里先报了非致命的错误，随后仍然完成
      ctx.map.fire('error', { error: new Error('sprite 404') });
      ctx.map.fire('style.load');
      await nextMicrotask();

      expect(names(ctx.map.styleCalls())).toEqual(['addSource', 'addLayer']);
      expect(ctx.states).toEqual(['ready']);
    });

    it('stays initializing when catching up on the first activation triggers a rebuild', async () => {
      using ctx = setup();
      ctx.map.rejectOn = 'addLayer';
      ctx.session.style.setGroup('business', lineGroup('dltb'));
      await nextMicrotask();
      const ready = ctx.view.whenReady();

      ctx.map.fire('style.load');

      expect(ctx.view.state).toBe('initializing');
      expect(ctx.map.styleCalls().at(-1)).toEqual(['setStyle', ctx.session.style.current, { diff: false }]);
      expect(names(ctx.map.calls)).not.toContain('jumpTo');
      expect(await settled(ready)).toBe('pending');

      // 重建完成后再激活
      ctx.map.rejectOn = undefined;
      ctx.map.fire('style.load');
      await expect(settled(ready)).resolves.toBeUndefined();
      expect(ctx.states).toEqual(['ready']);
    });

    it('fails without having been ready when the rebuild on the first activation is rejected', async () => {
      using ctx = setup();
      ctx.map.rejectOn = 'addLayer';
      ctx.session.style.setGroup('business', lineGroup('dltb'));
      await nextMicrotask();
      const invalid = new Error('invalid style');

      ctx.map.fire('style.load');
      ctx.map.fire('error', { error: invalid });

      expect(ctx.states).toEqual(['failed']);
      await expect(settled(ctx.view.whenReady())).rejects.toBe(invalid);
    });

    it('stays paused when catching up on resume triggers a rebuild', async () => {
      using ctx = setup();
      ctx.map.fire('style.load');
      ctx.view.pause();
      ctx.map.rejectOn = 'addLayer';
      ctx.session.style.setGroup('business', lineGroup('dltb'));
      await nextMicrotask();
      const jumps = ctx.map.calls.filter(([name]) => name === 'jumpTo').length;

      ctx.view.resume();

      expect(ctx.view.state).toBe('paused');
      expect(ctx.map.calls.filter(([name]) => name === 'jumpTo')).toHaveLength(jumps);
      ctx.map.rejectOn = undefined;
      ctx.map.fire('style.load');
      expect(ctx.states).toEqual(['ready', 'paused', 'ready']);
    });
  });

  describe('whenReady', () => {
    it('waits for the rebuild started on resume and then allows locating', async () => {
      using ctx = await resumeIntoRebuild();
      const ready = ctx.view.whenReady();

      expect(ctx.view.state).toBe('paused');
      expect(await settled(ready)).toBe('pending');
      ctx.map.fire('style.load');

      await expect(settled(ready)).resolves.toBeUndefined();
      expect(ctx.view.state).toBe('ready');
      expect(() => ctx.view.flyTo({ zoom: 10 })).not.toThrow();
    });

    it('rejects the same promise when the rebuild started on resume fails', async () => {
      using ctx = await resumeIntoRebuild();
      const ready = ctx.view.whenReady();
      const invalid = new Error('invalid style');

      ctx.map.fire('error', { error: invalid });

      await expect(settled(ready)).rejects.toBe(invalid);
      expect(ctx.view.whenReady()).toBe(ready);
    });

    it('rejects the same promise with AbortError when disposed during the rebuild', async () => {
      using ctx = await resumeIntoRebuild();
      const ready = ctx.view.whenReady();

      ctx.view[Symbol.dispose]();

      await expect(settled(ready)).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('waits for a rebuild started while ready', async () => {
      using ctx = setup();
      ctx.map.fire('style.load');
      ctx.map.rejectOn = 'addLayer';
      ctx.session.style.setGroup('business', lineGroup('dltb'));
      await nextMicrotask();
      const ready = ctx.view.whenReady();

      expect(await settled(ready)).toBe('pending');
      ctx.map.fire('style.load');

      await expect(settled(ready)).resolves.toBeUndefined();
    });

    it('keeps waiting when catching up after a rebuild starts another rebuild', async () => {
      using ctx = setup();
      ctx.map.fire('style.load');
      ctx.map.rejectOn = 'addLayer';
      ctx.session.style.setGroup('business', lineGroup('dltb'));
      await nextMicrotask();
      // 重建期间又提交了一个版本，重建完成后追赶它时 addLayer 仍被拒绝
      ctx.session.style.setGroup('basemap', lineGroup('tdt'));
      await nextMicrotask();
      const ready = ctx.view.whenReady();

      ctx.map.fire('style.load');

      expect(names(ctx.map.styleCalls()).filter(name => name === 'setStyle')).toHaveLength(2);
      expect(await settled(ready)).toBe('pending');
      ctx.map.rejectOn = undefined;
      ctx.map.fire('style.load');
      await expect(settled(ready)).resolves.toBeUndefined();
    });

    it('hands out the new round on the statechange of a reload after failure', async () => {
      using ctx = setup();
      ctx.map.fire('error', { error: new Error('invalid style') });
      let readyOnInitializing: Promise<void> | undefined;
      ctx.view.on('statechange', state => {
        if (state === 'initializing') {
          readyOnInitializing = ctx.view.whenReady();
        }
      });

      ctx.session.style.setGroup('business', lineGroup('dltb'));
      await nextMicrotask();
      ctx.map.fire('style.load');

      expect(readyOnInitializing).toBeDefined();
      await expect(settled(readyOnInitializing ?? Promise.reject(new Error('missing')))).resolves.toBeUndefined();
    });

    it('resolves when a rebuild completes while paused', async () => {
      using ctx = setup();
      ctx.map.fire('style.load');
      ctx.map.rejectOn = 'addLayer';
      ctx.session.style.setGroup('business', lineGroup('dltb'));
      await nextMicrotask();
      ctx.view.pause();
      const ready = ctx.view.whenReady();

      expect(await settled(ready)).toBe('pending');
      ctx.map.fire('style.load');

      // 和以 active: false 创建时一样：样式加载完成就结束，视图仍是 paused
      await expect(settled(ready)).resolves.toBeUndefined();
      expect(ctx.view.state).toBe('paused');
    });

    it('keeps the same promise when a failed load is retried with a newer revision', async () => {
      using ctx = setup();
      ctx.session.style.setGroup('business', lineGroup('dltb'));
      await nextMicrotask();
      const ready = ctx.view.whenReady();

      ctx.map.fire('error', { error: new Error('invalid style') });
      await nextMicrotask();

      expect(ctx.view.whenReady()).toBe(ready);
      ctx.map.fire('style.load');
      await expect(settled(ready)).resolves.toBeUndefined();
    });
  });

  describe('camera', () => {
    it('sets the wheel and trackpad zoom rates when given, leaving MapLibre defaults otherwise (ADR 0053)', () => {
      using given = setup({ scrollZoomRates: { wheel: 1 / 600, trackpad: 1 / 150 } });
      using partial = setup({ scrollZoomRates: { wheel: 1 / 500 } });
      using none = setup();

      expect([given.map.scrollZoom.wheelRate, given.map.scrollZoom.trackpadRate]).toStrictEqual([1 / 600, 1 / 150]);
      expect([partial.map.scrollZoom.wheelRate, partial.map.scrollZoom.trackpadRate]).toStrictEqual([1 / 500, undefined]);
      expect([none.map.scrollZoom.wheelRate, none.map.scrollZoom.trackpadRate]).toStrictEqual([undefined, undefined]);
    });

    it('writes the camera back to the session with the cause of the move', () => {
      using ctx = setup();
      ctx.map.fire('style.load');
      const changes: CameraChange[] = [];
      ctx.session.camera.on('change', change => changes.push(change));

      ctx.map.drag(119, 32);
      ctx.view.flyTo({ zoom: 10 });
      ctx.map.moveTo({ ...ctx.map.camera, zoom: 11 }, {});

      expect(changes.map(({ view, cause }) => [view, cause])).toEqual([
        ['2d', 'user'],
        ['2d', 'program'],
        ['2d', 'program']
      ]);
      expect(ctx.session.camera.current).toEqual({ center: [119, 32], zoom: 11, bearing: 0, pitch: 0 });
    });

    it('starts a camera operation when the user starts moving the map, not on program moves or animation frames', () => {
      using ctx = setup();
      ctx.map.fire('style.load');
      const operation = ctx.session.camera.beginOperation();

      ctx.view.flyTo({ zoom: 10 });
      ctx.map.fire('move', { cause: 'program' });
      ctx.map.fire('movestart', { cause: 'sync' });
      expect(ctx.session.camera.operation).toBe(operation);
      expect(operation.aborted).toBe(false);

      ctx.map.drag(119, 32);
      expect(operation.aborted).toBe(true);
      // 同一次拖动后面的每一帧只有 move，不再开始新的操作
      const dragging = ctx.session.camera.operation;
      ctx.map.fire('move', { originalEvent: new MouseEvent('mousemove') });
      expect(ctx.session.camera.operation).toBe(dragging);
      expect(dragging.aborted).toBe(false);
    });

    it('ignores the user moving the map while initializing or paused', () => {
      using ctx = setup();
      const operation = ctx.session.camera.operation;

      ctx.map.drag(119, 32);
      ctx.map.fire('style.load');
      ctx.view.pause();
      ctx.map.drag(120, 31);

      expect(operation.aborted).toBe(false);
    });

    it('does not write the camera back while initializing or paused', () => {
      using ctx = setup();

      ctx.map.drag(119, 32);
      ctx.map.fire('style.load');
      ctx.view.pause();
      ctx.map.drag(120, 31);

      expect(ctx.session.camera.current).toEqual(NANJING);
    });

    it('syncs the session camera on resume and records the echo as sync', () => {
      using ctx = setup();
      ctx.map.fire('style.load');
      ctx.view.pause();
      ctx.session.camera.set({ ...NANJING, center: [120, 31], pitch: 75 }, { view: '3d', cause: 'user' });
      const changes: CameraChange[] = [];
      ctx.session.camera.on('change', change => changes.push(change));
      let pitchWhenReady: number | undefined;
      ctx.view.on('statechange', () => (pitchWhenReady = ctx.session.camera.current.pitch));

      ctx.view.resume();

      expect(ctx.map.calls).toContainEqual(['jumpTo', { center: [120, 31], zoom: 8, bearing: 0, pitch: 75 }, { cause: 'sync' }]);
      // 二维把俯角收到上限后按 sync 写回会话；进入 ready 时会话已经是地图的实际值
      expect(changes.map(({ view, cause }) => [view, cause])).toEqual([['2d', 'sync']]);
      expect(ctx.session.camera.current.pitch).toBe(60);
      expect(pitchWhenReady).toBe(60);
    });

    it('applies the session camera changed while initializing and writes back what the map settled on', () => {
      using ctx = setup();
      // 初始化期间三维改了相机，俯角超出二维的上限
      ctx.session.camera.set({ ...NANJING, center: [120, 31], pitch: 75 }, { view: '3d', cause: 'user' });
      const changes: CameraChange[] = [];
      ctx.session.camera.on('change', change => changes.push(change));
      let pitchWhenReady: number | undefined;
      ctx.view.on('statechange', () => (pitchWhenReady = ctx.session.camera.current.pitch));

      ctx.map.fire('style.load');

      expect(ctx.map.calls).toContainEqual(['jumpTo', { center: [120, 31], zoom: 8, bearing: 0, pitch: 75 }, { cause: 'sync' }]);
      expect(changes.map(({ view, cause }) => [view, cause])).toEqual([['2d', 'sync']]);
      expect(ctx.session.camera.current).toEqual({ center: [120, 31], zoom: 8, bearing: 0, pitch: 60 });
      expect(pitchWhenReady).toBe(60);
    });

    it('writes back the camera that the map clamped when it was created', () => {
      using ctx = setup({}, { ...NANJING, pitch: 75 });

      ctx.map.fire('style.load');

      expect(ctx.session.camera.current.pitch).toBe(60);
    });

    it('leaves the camera alone when it loads paused and syncs it on resume', () => {
      using ctx = setup({ active: false });
      ctx.session.camera.set({ ...NANJING, center: [120, 31] }, { view: '3d', cause: 'user' });

      ctx.map.fire('style.load');
      expect(names(ctx.map.calls)).not.toContain('jumpTo');

      ctx.view.resume();
      expect(ctx.map.getCenter()).toEqual({ lng: 120, lat: 31 });
    });

    it('finishes a program animation at its end when paused, writing it to the session first; resume stays there (ADR 0063)', () => {
      using ctx = setup();
      ctx.map.fire('style.load');
      ctx.map.animate = true;
      ctx.view.fitBounds([118, 31, 120, 33], { duration: 1100, maxZoom: 9 });
      expect(ctx.session.camera.current.center).not.toEqual([119, 32]);
      const changes: CameraChange[] = [];
      ctx.session.camera.on('change', change => changes.push(change));

      ctx.view.pause();

      // 按同样的参数、时长 0 直接到终点，在进入 paused 之前按 program 写回
      expect(ctx.map.calls.at(-1)).toStrictEqual([
        'fitBounds',
        [118, 31, 120, 33],
        { maxZoom: 9, duration: 0 },
        { cause: 'program' }
      ]);
      expect(ctx.session.camera.current).toMatchObject({ center: [119, 32], zoom: 9 });
      expect(changes.map(({ cause }) => cause)).toStrictEqual(['program']);
      expect(ctx.view.state).toBe('paused');
      ctx.view.resume();
      expect(ctx.map.getCenter()).toEqual({ lng: 119, lat: 32 });
    });

    it('does not replay an animation that already reached its end when paused', () => {
      using ctx = setup();
      ctx.map.fire('style.load');
      ctx.map.animate = true;
      ctx.view.flyTo({ center: [120, 31], zoom: 8 }, { duration: 500 });
      ctx.map.endAnimation();
      const before = ctx.map.calls.length;

      ctx.view.pause();

      expect(ctx.map.calls.length).toBe(before);
      expect(ctx.session.camera.current.center).toStrictEqual([120, 31]);
    });

    it('does not replay an animation the user interrupted when paused', () => {
      using ctx = setup();
      ctx.map.fire('style.load');
      ctx.map.animate = true;
      ctx.view.fitBounds([118, 31, 120, 33], { duration: 1100 });
      // 用户开始拖动：MapLibre 停下动画、发出 moveend，之后的移动带原始的 DOM 事件
      ctx.map.interrupt();
      ctx.map.moveTo({ ...ctx.map.camera, lng: 117.5 }, { originalEvent: new MouseEvent('mousemove') });
      const before = ctx.map.calls.length;

      ctx.view.pause();

      expect(ctx.map.calls.length).toBe(before);
      expect(ctx.session.camera.current.center[0]).toBe(117.5);
    });

    it('does not replay a move without animation when paused', () => {
      using ctx = setup();
      ctx.map.fire('style.load');
      ctx.map.animate = true;
      ctx.view.fitBounds([118, 31, 120, 33], { duration: 1100 });
      ctx.view.flyTo({ center: [119.5, 32.5] }, { duration: 0 });
      const before = ctx.map.calls.length;

      ctx.view.pause();

      expect(ctx.map.calls.length).toBe(before);
      expect(ctx.session.camera.current.center).toStrictEqual([119.5, 32.5]);
    });

    it('resizes the canvas to its container on resume, before syncing the camera (ADR 0063)', () => {
      using ctx = setup();
      ctx.map.fire('style.load');
      ctx.view.pause();
      ctx.session.camera.set({ ...NANJING, center: [120, 31] }, { view: '3d', cause: 'user' });
      const before = ctx.map.calls.length;
      const states: ViewState[] = [];
      ctx.view.on('statechange', state => states.push(state));

      ctx.view.resume();

      // 恢复时只调整一次尺寸，在同步相机的 jumpTo 之前，进入 ready 之前
      expect(ctx.map.resizedAt).toStrictEqual([before]);
      expect(names(ctx.map.calls.slice(before))).toContain('jumpTo');
      expect(states).toStrictEqual(['ready']);
    });

    it('tells listeners when the map resizes, and stops after dispose', () => {
      const ctx = setup();
      let resizes = 0;
      ctx.view.on('resize', () => resizes++);

      ctx.map.fire('resize');
      expect(resizes).toBe(1);
      ctx.view[Symbol.dispose]();
      ctx.map.fire('resize');

      expect(resizes).toBe(1);
      ctx.session[Symbol.dispose]();
    });

    it('tells listeners when the picture settles, only while ready', () => {
      const ctx = setup();
      let settles = 0;
      ctx.view.on('settle', () => settles++);

      // 样式还没加载完时的 idle 不算
      ctx.map.fire('idle');
      expect(settles).toBe(0);
      ctx.map.fire('style.load');
      ctx.map.fire('idle');
      expect(settles).toBe(1);
      ctx.view.pause();
      ctx.map.fire('idle');
      expect(settles).toBe(1);
      ctx.view.resume();
      ctx.map.fire('idle');
      expect(settles).toBe(2);
      ctx.view[Symbol.dispose]();
      ctx.map.fire('idle');

      expect(settles).toBe(2);
      ctx.session[Symbol.dispose]();
    });

    it('locates with flyTo and fitBounds as program moves', () => {
      using ctx = setup();
      ctx.map.fire('style.load');
      // 进入 ready 时同步相机的 jumpTo 不在比较范围内
      const before = ctx.map.calls.length;
      const changes: CameraChange[] = [];
      ctx.session.camera.on('change', change => changes.push(change));

      ctx.view.flyTo({ center: [120, 31], zoom: 10 }, { duration: 500 });
      ctx.view.fitBounds([118, 31, 120, 33], { padding: 20 });
      ctx.view.fitBounds([118, 31, 120, 33], { duration: 500, pitch: 0 });

      // 不能出现值为 undefined 的键：MapLibre 合并默认选项时会被它覆盖（maxZoom 变成 undefined，算出 NaN）
      expect(ctx.map.calls.slice(before)).toStrictEqual([
        ['flyTo', { center: [120, 31], zoom: 10, duration: 500 }, { cause: 'program' }],
        ['fitBounds', [118, 31, 120, 33], { padding: 20 }, { cause: 'program' }],
        ['fitBounds', [118, 31, 120, 33], { duration: 500, pitch: 0 }, { cause: 'program' }]
      ]);
      // 第二次 fitBounds 定位到同一个范围，相机没变，不发出变化
      expect(changes.map(({ cause }) => cause)).toEqual(['program', 'program']);
    });

    it('turns flyTo padding into a one-off offset, and only when there is a center', () => {
      using ctx = setup();
      ctx.map.fire('style.load');
      const before = ctx.map.calls.length;

      ctx.view.flyTo({ center: [120, 31], zoom: 14 }, { padding: { top: 16, right: 400, bottom: 16, left: 16 } });
      ctx.view.flyTo({ center: [120, 31] }, { padding: { top: 100, right: 16, bottom: 20, left: 16 } });
      ctx.view.flyTo({ center: [120, 31] }, { padding: 16 });
      ctx.view.flyTo({ zoom: 12 }, { padding: { top: 16, right: 400, bottom: 16, left: 16 } });

      // 偏移是去掉留白后的区域中心相对画布中心：右边留得多往左，上边留得多往下；没有中心时偏移会把地图平移走，不加
      expect(ctx.map.calls.slice(before)).toStrictEqual([
        ['flyTo', { center: [120, 31], zoom: 14, offset: [-192, 0] }, { cause: 'program' }],
        ['flyTo', { center: [120, 31], offset: [0, 40] }, { cause: 'program' }],
        ['flyTo', { center: [120, 31], offset: [0, 0] }, { cause: 'program' }],
        ['flyTo', { zoom: 12 }, { cause: 'program' }]
      ]);
    });

    it('refuses to locate unless ready', () => {
      using ctx = setup();

      expect(() => ctx.view.flyTo({ zoom: 10 })).toThrow('当前状态为 initializing');
      ctx.map.fire('style.load');
      ctx.view.pause();
      expect(() => ctx.view.fitBounds([118, 31, 120, 33])).toThrow('当前状态为 paused');
    });
  });
  describe('tools and input', () => {
    const NO_MODIFIERS = { shift: false, ctrl: false, alt: false, meta: false };

    it('picks the map plane and projects back to the screen once ready', () => {
      using ctx = setup();
      expect(() => ctx.view.pick({ x: 100, y: 200 })).toThrow('只能在 ready 时定位、拾取、投影和查询');

      ctx.map.fire('style.load');

      expect(ctx.view.pick({ x: 100, y: 200 })).toStrictEqual({ kind: 'hit', surface: 'map', lngLat: [119, 31] });
      expect(ctx.view.project([119, 31])).toStrictEqual({ x: 100, y: 200 });
      ctx.view.pause();
      expect(() => ctx.view.project([119, 31])).toThrow('当前状态为 paused');
    });

    it('turns map mouse events into input for the active tool', () => {
      using ctx = setup();
      const { tool, inputs } = recordingTool();
      ctx.session.tool.register('probe', tool);
      ctx.session.tool.activate('probe');
      ctx.map.fire('style.load');

      ctx.map.mouse('mousedown', 10, 20, { button: 2, detail: 1, shiftKey: true, metaKey: true });
      for (const type of ['mousemove', 'mouseup', 'click', 'dblclick', 'mouseout'] as const) {
        ctx.map.mouse(type, 30, 40, { detail: 2, ctrlKey: true, altKey: true });
      }

      expect(inputs).toStrictEqual([
        {
          type: 'down',
          point: { x: 10, y: 20 },
          button: 2,
          clickCount: 1,
          modifiers: { ...NO_MODIFIERS, shift: true, meta: true }
        },
        ...(['move', 'up', 'click', 'dblclick', 'leave'] as const).map(type => ({
          type,
          point: { x: 30, y: 40 },
          button: 0,
          clickCount: 2,
          modifiers: { ...NO_MODIFIERS, ctrl: true, alt: true }
        }))
      ]);
    });

    it('gives tools only the kind, pick, project and rendered query of the view', async () => {
      using ctx = setup();
      const { tool, views } = recordingTool();
      ctx.session.tool.register('probe', tool);
      ctx.session.tool.activate('probe');
      ctx.map.fire('style.load');
      ctx.session.style.setGroup('business', lineGroup('dltb'));
      await nextMicrotask();
      ctx.map.rendered = [{ source: 'dltb', layer: { id: 'dltb-line' }, properties: { guid: 'a' }, geometry: POINT }];

      ctx.map.mouse('click', 100, 200);
      const [view] = views;

      expect(Object.keys(view ?? {})).toStrictEqual(['kind', 'pick', 'project', 'queryRendered']);
      expect(Object.isFrozen(view)).toBe(true);
      expect(view?.kind).toBe('2d');
      expect(view?.pick({ x: 100, y: 200 })).toStrictEqual({ kind: 'hit', surface: 'map', lngLat: [119, 31] });
      expect(view?.project([119, 31])).toStrictEqual({ x: 100, y: 200 });
      expect(view?.queryRendered({ x: 100, y: 200 }, { sources: ['dltb'] })).toStrictEqual([
        { sourceId: 'dltb', layerId: 'dltb-line', properties: { guid: 'a' } }
      ]);
    });

    it('queries what the layers of the given sources drew, top first; geometry only when asked for', async () => {
      using ctx = setup();
      expect(() => ctx.view.queryRendered({ x: 1, y: 2 }, { sources: ['dltb'] })).toThrow('只能在 ready 时');
      ctx.map.fire('style.load');
      ctx.session.style.setGroups({ basemap: lineGroup('tdt'), business: lineGroup('dltb') });
      await nextMicrotask();
      const top = { source: 'dltb', layer: { id: 'dltb-line' }, properties: { guid: 'a' }, geometry: POINT };
      const below = { source: 'tdt', layer: { id: 'tdt-line' }, properties: { name: '路' }, geometry: POINT };
      ctx.map.rendered = [top, below];
      ctx.map.calls.length = 0;

      expect(ctx.view.queryRendered({ x: 100, y: 200 }, { sources: ['dltb'] })).toStrictEqual([
        { sourceId: 'dltb', layerId: 'dltb-line', properties: { guid: 'a' } },
        { sourceId: 'tdt', layerId: 'tdt-line', properties: { name: '路' } }
      ]);
      const box = { from: { x: 50, y: 60 }, to: { x: 0, y: 0 } };
      expect(ctx.view.queryRendered(box, { sources: ['dltb', 'tdt'], withGeometry: true })).toStrictEqual([
        { sourceId: 'dltb', layerId: 'dltb-line', properties: { guid: 'a' }, geometry: POINT },
        { sourceId: 'tdt', layerId: 'tdt-line', properties: { name: '路' }, geometry: POINT }
      ]);
      // 没有图层的数据源不交给 MapLibre（它对不存在的图层会报错）
      expect(ctx.view.queryRendered({ x: 1, y: 1 }, { sources: ['missing'] })).toStrictEqual([]);
      // 图层按已应用的样式从下到上列出，矩形照原样交给 MapLibre
      expect(ctx.map.calls).toStrictEqual([
        ['queryRenderedFeatures', [100, 200], { layers: ['dltb-line'] }],
        [
          'queryRenderedFeatures',
          [
            [50, 60],
            [0, 0]
          ],
          { layers: ['tdt-line', 'dltb-line'] }
        ]
      ]);
    });

    it('passes keys pressed on the focused map; Escape ends a temporary tool', () => {
      using ctx = setup();
      const { tool, inputs } = recordingTool();
      ctx.session.tool.register('probe', tool);
      ctx.session.tool.activate('probe');
      ctx.map.fire('style.load');

      ctx.map.canvasContainer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

      expect(inputs).toStrictEqual([{ type: 'key', key: 'Escape' }]);
      expect(ctx.session.tool.active).toBe('browse');
    });

    it('passes no input before it is ready or while paused', () => {
      using ctx = setup();
      const { tool, inputs } = recordingTool();
      ctx.session.tool.register('probe', tool);
      ctx.session.tool.activate('probe');

      ctx.map.mouse('click', 1, 1);
      ctx.map.canvasContainer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      ctx.map.fire('style.load');
      ctx.view.pause();
      ctx.map.mouse('click', 2, 2);
      ctx.view.resume();
      ctx.map.mouse('click', 3, 3);

      expect(inputs.map(event => (event.type === 'key' ? event.key : event.point.x))).toStrictEqual([3]);
      expect(ctx.session.tool.active).toBe('probe');
    });

    it('applies the cursor of the active tool and turns off the gestures it declares', () => {
      using ctx = setup();
      ctx.session.tool.register('measure', {
        persistent: false,
        cursor: 'crosshair',
        gestures: { doubleClickZoom: false, boxZoom: false }
      });
      ctx.map.fire('style.load');

      ctx.session.tool.activate('measure');

      expect(ctx.map.canvas.style.cursor).toBe('crosshair');
      expect([ctx.map.dragPan.enabled, ctx.map.doubleClickZoom.enabled, ctx.map.boxZoom.enabled]).toStrictEqual([
        true,
        false,
        false
      ]);

      ctx.session.tool.release('measure');

      expect(ctx.map.canvas.style.cursor).toBe('');
      expect([ctx.map.dragPan.enabled, ctx.map.doubleClickZoom.enabled, ctx.map.boxZoom.enabled]).toStrictEqual([
        true,
        true,
        true
      ]);
    });

    it('moves keyboard focus to the map when a temporary task becomes active, so Esc reaches the tool', () => {
      using ctx = setup();
      ctx.session.tool.register('measure', { persistent: false });
      ctx.session.tool.register('pick', { persistent: true });
      const focus = vi.spyOn(ctx.map.canvas, 'focus');
      ctx.map.fire('style.load');

      // 常驻模式不抢焦点；临时任务多由面板、工具栏上的按钮激活，焦点还在按钮上，按键到不了地图
      ctx.session.tool.activate('pick');
      expect(focus).not.toHaveBeenCalled();
      ctx.session.tool.activate('measure');
      expect(focus.mock.calls).toStrictEqual([[{ preventScroll: true }]]);
      ctx.session.tool.release('measure');

      expect(focus).toHaveBeenCalledOnce();
    });

    it('takes focus when it becomes ready with a temporary task already active, but not with a persistent one', () => {
      using ctx = setup();
      ctx.session.tool.register('measure', { persistent: false });
      const focus = vi.spyOn(ctx.map.canvas, 'focus');
      // 进入页面时是"移动"，就绪时不抢焦点
      ctx.map.fire('style.load');
      expect(focus).not.toHaveBeenCalled();

      // 加载期间（画布重建、暂停时）开启的临时任务，就绪后补上焦点，Esc 才能退出
      ctx.view.pause();
      ctx.session.tool.activate('measure');
      ctx.view.resume();

      expect(focus.mock.calls).toStrictEqual([[{ preventScroll: true }]]);
    });

    it('only turns back on the gestures it turned off itself', () => {
      using ctx = setup();
      ctx.session.tool.register('draw', { persistent: false, gestures: { dragPan: false, doubleClickZoom: false } });
      // 例如页面创建地图时就关掉了双击放大
      ctx.map.doubleClickZoom.enabled = false;
      ctx.map.fire('style.load');

      ctx.session.tool.activate('draw');
      ctx.session.tool.release('draw');

      expect(ctx.map.dragPan.calls).toStrictEqual(['disable', 'enable']);
      expect(ctx.map.doubleClickZoom.calls).toStrictEqual([]);
      expect(ctx.map.doubleClickZoom.enabled).toBe(false);
    });

    it('applies the tool chosen before it was ready, and changes made while paused on resume', () => {
      using ctx = setup();
      ctx.session.tool.register('measure', { persistent: false, cursor: 'crosshair' });
      ctx.session.tool.register('pick', { persistent: true, cursor: 'pointer' });
      ctx.session.tool.activate('measure');
      expect(ctx.map.canvas.style.cursor).toBe('');

      ctx.map.fire('style.load');
      expect(ctx.map.canvas.style.cursor).toBe('crosshair');

      ctx.view.pause();
      ctx.session.tool.activate('pick');
      expect(ctx.map.canvas.style.cursor).toBe('crosshair');

      ctx.view.resume();
      expect(ctx.map.canvas.style.cursor).toBe('pointer');
    });

    describe('temporary pan with a modifier (ADR 0056)', () => {
      it('pans by itself; the press, its release and click do not reach MapLibre or the tool, moves still do', () => {
        using ctx = setup();
        const { tool, inputs } = pickTool();
        ctx.session.tool.register('pick', tool);
        ctx.session.tool.activate('pick');
        ctx.map.fire('style.load');
        const engineDowns: unknown[] = [];
        ctx.map.on('mousedown', event => engineDowns.push(event));
        const changes: CameraChange[] = [];
        ctx.session.camera.on('change', change => changes.push(change));

        holdCtrl();
        expect(ctx.map.canvas.style.cursor).toBe('grab');
        ctx.map.press(100, 100, { ctrlKey: true });
        expect(ctx.map.canvas.style.cursor).toBe('grabbing');
        moveOnDocument(150, 100);
        // MapLibre 照常发出移动的地图事件：经过工具模型，鼠标位置跟着更新
        ctx.map.mouse('mousemove', 150, 100);
        releaseOnDocument();
        ctx.map.mouse('mouseup', 150, 100);
        ctx.map.mouse('click', 150, 100, { detail: 1 });

        expect(engineDowns).toStrictEqual([]);
        expect(inputs.map(event => event.type)).toStrictEqual(['move']);
        expect(ctx.map.calls.filter(([name]) => name === 'panBy')).toStrictEqual([
          ['panBy', [-50, 0], { animate: false }, { cause: 'user' }]
        ]);
        expect(changes.map(({ state, cause }) => [state.center, cause])).toStrictEqual([[[118.3, 32.05], 'user']]);
        // 松开时没有按着 Ctrl
        expect(ctx.map.canvas.style.cursor).toBe('crosshair');

        // 下一次没按修饰键的按下照常交给工具
        ctx.map.press(10, 10);
        ctx.map.mouse('mouseup', 10, 10);
        ctx.map.mouse('click', 10, 10, { detail: 1 });
        expect(inputs.map(event => event.type)).toStrictEqual(['move', 'down', 'up', 'click']);
      });

      it('leaves Ctrl presses alone before ready, while paused and for tools that declare no modifier', () => {
        using ctx = setup();
        const pick = pickTool();
        const plain = recordingTool({ persistent: true });
        ctx.session.tool.register('pick', pick.tool);
        ctx.session.tool.register('plain', plain.tool);
        ctx.session.tool.activate('pick');
        const engineDowns: unknown[] = [];
        ctx.map.on('mousedown', event => engineDowns.push(event));

        ctx.map.press(0, 0, { ctrlKey: true });
        moveOnDocument(20, 20);
        releaseOnDocument();
        ctx.map.fire('style.load');
        ctx.view.pause();
        ctx.map.press(0, 0, { ctrlKey: true });
        moveOnDocument(20, 20);
        releaseOnDocument();
        ctx.view.resume();
        ctx.session.tool.activate('plain');
        holdCtrl();
        ctx.map.press(0, 0, { ctrlKey: true });
        moveOnDocument(20, 20);

        expect(engineDowns).toHaveLength(3);
        expect(plain.inputs.map(event => event.type)).toStrictEqual(['down']);
        expect(ctx.map.calls.filter(([name]) => name === 'panBy')).toStrictEqual([]);
        expect(ctx.map.canvas.style.cursor).toBe('');
      });

      it('ends the pan when the tool changes, even to another tool that declares a modifier', () => {
        using ctx = setup();
        ctx.session.tool.register('pick', pickTool().tool);
        ctx.session.tool.register('select', { ...pickTool().tool, cursor: 'cell' });
        ctx.session.tool.register('measure', { persistent: false, cursor: 'copy' });
        ctx.session.tool.activate('pick');
        ctx.map.fire('style.load');

        ctx.map.press(0, 0, { ctrlKey: true });
        ctx.session.tool.activate('measure');
        // 不用等下一次移动，立刻换成新工具的光标
        expect(ctx.map.canvas.style.cursor).toBe('copy');
        moveOnDocument(20, 20);
        releaseOnDocument();
        ctx.session.tool.activate('pick');
        ctx.map.press(0, 0, { ctrlKey: true });
        ctx.session.tool.activate('select');
        // Ctrl 还按着，新工具也声明了 Ctrl：拖动结束，回到按住时的手型
        expect(ctx.map.canvas.style.cursor).toBe('grab');
        moveOnDocument(20, 20);

        expect(ctx.map.calls.filter(([name]) => name === 'panBy')).toStrictEqual([]);
      });
    });

    it('reports errors thrown by a tool instead of throwing into MapLibre', () => {
      using ctx = setup();
      const failure = new Error('tool failed');
      ctx.session.tool.register('broken', {
        persistent: false,
        handleInput: () => {
          throw failure;
        }
      });
      ctx.session.tool.activate('broken');
      ctx.map.fire('style.load');

      expect(() => ctx.map.mouse('click', 1, 1)).not.toThrow();
      expect(ctx.errors).toStrictEqual([failure]);
    });

    it('stops passing input and applying tools after it is disposed', () => {
      const ctx = setup();
      const { tool, inputs } = recordingTool({ cursor: 'crosshair' });
      ctx.session.tool.register('probe', tool);
      ctx.map.fire('style.load');
      const map = ctx.map;
      // 释放后状态是 disposed，留着的按键监听也不会转交输入，只能直接确认它被移除了
      const removeListener = vi.spyOn(map.canvasContainer, 'removeEventListener');

      ctx.view[Symbol.dispose]();
      expect(removeListener.mock.calls.map(([type]) => type)).toContain('keydown');
      ctx.session.tool.activate('probe');
      map.mouse('click', 1, 1);
      map.canvasContainer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

      expect(inputs).toStrictEqual([]);
      expect(map.canvas.style.cursor).toBe('');
      expect(map.listenerCount()).toBe(0);
      ctx[Symbol.dispose]();
    });
  });
});

// 测试自己的转换表，不导入实现里的那份：两份一致才说明实现照表执行（见 map-core.md"状态转换"）。
// failed → failed 只允许从样式失败出发（换成新的原因或升级为引擎失败），引擎失败之后不能再有任何转换
const ALLOWED_TRANSITIONS: Readonly<Record<string, readonly ViewState[]>> = {
  initializing: ['ready', 'paused', 'failed'],
  ready: ['paused', 'failed'],
  paused: ['ready', 'failed'],
  failed: ['initializing', 'ready', 'paused', 'failed']
};

const SEQUENCE_STEPS = ['load', 'error', 'commit', 'reject', 'pause', 'resume', 'breakEngine', 'dispose'] as const;
type SequenceStep = (typeof SEQUENCE_STEPS)[number];
// 交错的序列里，走完微任务也是一个事件：提交、加载、报错可以落在同一轮里
const INTERLEAVED_STEPS = [...SEQUENCE_STEPS, 'flush'] as const;
type InterleavedStep = (typeof INTERLEAVED_STEPS)[number];

// 所有长度为 length 的序列；检查每一步之后的状态，较短的序列作为前缀都被覆盖到
function sequencesOf<T>(steps: readonly T[], length: number): T[][] {
  return length === 0 ? [[]] : sequencesOf(steps, length - 1).flatMap(prefix => steps.map(step => [...prefix, step]));
}

// 走完会话通知（微任务）、加载失败后排进微任务的重新加载
async function flushMicrotasks(): Promise<void> {
  for (let round = 0; round < 6; round++) {
    // oxlint-disable-next-line no-await-in-loop -- 一轮只走一层微任务，必须等上一轮结束
    await Promise.resolve();
  }
}

// 已经结束的 Promise 的回调先于后登记的微任务执行，没结束时得到 'pending'
function promiseState(promise: Promise<unknown>): Promise<'resolved' | 'rejected' | 'pending'> {
  return Promise.race([
    promise.then(
      () => 'resolved' as const,
      () => 'rejected' as const
    ),
    Promise.resolve().then(() => 'pending' as const)
  ]);
}

// 同步地执行一个事件；reject 让之后的增量命令被拒绝，直到下一次走完微任务
function fireStep(ctx: ReturnType<typeof setup>, step: SequenceStep, index: number): void {
  switch (step) {
    case 'load':
      ctx.map.fire('style.load');
      break;
    case 'error':
      ctx.map.fire('error', { error: new Error('加载失败') });
      break;
    case 'commit':
      ctx.session.style.setGroup('business', lineGroup(`commit-${index}`));
      break;
    case 'reject':
      // 增量命令被 MapLibre 拒绝，视图整体重建
      ctx.map.rejectOn = 'addLayer';
      ctx.session.style.setGroup('business', lineGroup(`reject-${index}`));
      break;
    case 'pause':
      ctx.view.pause();
      break;
    case 'resume':
      ctx.view.resume();
      break;
    case 'breakEngine':
      // 之后的整体重建（setStyle）都抛错，即引擎失败
      ctx.map.failOn = 'setStyle';
      break;
    case 'dispose':
      ctx.view[Symbol.dispose]();
      break;
  }
}

async function flushStep(ctx: ReturnType<typeof setup>): Promise<void> {
  await flushMicrotasks();
  ctx.map.rejectOn = undefined;
}

// 状态连同失败的种类，例如 failed(style)
function describeState(state: ViewState, failure: MapViewFailure | null): string {
  return failure ? `${state}(${failure.kind})` : state;
}

interface SequenceRun {
  readonly active: boolean;
  /** 每一步之后都走完微任务，把视图带到起点 */
  readonly prefix: readonly SequenceStep[];
  /** interleaved 为 true 时只在 flush 和最后走完微任务，否则每一步之后都走完 */
  readonly steps: readonly InterleavedStep[];
  readonly interleaved: boolean;
}

// 走完一个序列：违反的不变量（空数组表示全部成立），以及走到过的转换
async function runSequence({
  active,
  prefix,
  steps,
  interleaved
}: SequenceRun): Promise<{ problems: string[]; transitions: string[] }> {
  using ctx = setup({ active });
  const { view } = ctx;
  const problems: string[] = [];
  const transitions: string[] = [];
  let last: { state: ViewState; failure: MapViewFailure | null } = { state: view.state, failure: view.failure };
  let disposed = false;
  let engineFailed = false;
  let callsAtDispose = 0;
  view.on('statechange', state => {
    const from = describeState(last.state, last.failure);
    transitions.push(`${from} → ${describeState(state, view.failure)}`);
    if (disposed) {
      problems.push(`释放后仍发出 statechange：${state}`);
    } else if (last.failure?.kind === 'engine' || !ALLOWED_TRANSITIONS[last.state]?.includes(state)) {
      problems.push(`不允许的转换 ${from} → ${state}`);
    }
    last = { state, failure: view.failure };
  });

  // 每一步之后同步检查；不能 await：await 一个 async 函数本身就会让出微任务，排着的会话通知会在这里执行，同一轮就交错不起来了
  const checkState = (at: string) => {
    if ((view.state === 'failed') !== (view.failure !== null)) {
      problems.push(`${at}：状态 ${view.state} 与失败原因不一致`);
    }
    if (engineFailed && view.state !== 'failed' && view.state !== 'disposed') {
      problems.push(`${at}：引擎失败后变成了 ${view.state}`);
    }
    engineFailed ||= view.failure?.kind === 'engine';
    if (disposed && view.state !== 'disposed') {
      problems.push(`${at}：释放后状态是 ${view.state}`);
    }
    if (disposed && ctx.map.calls.length !== callsAtDispose) {
      problems.push(`${at}：释放后仍在操作地图`);
    }
  };
  // whenReady 要走微任务才能判断，只在走完微任务之后检查
  const checkWhenReady = async (at: string) => {
    if (view.state === 'failed' && (await promiseState(view.whenReady())) !== 'rejected') {
      problems.push(`${at}：failed 时 whenReady 没有以失败结束`);
    }
  };

  const all = [...prefix.map(step => ({ step, flush: true })), ...steps.map(step => ({ step, flush: !interleaved }))];
  for (const [index, { step, flush }] of all.entries()) {
    if (step === 'flush') {
      // oxlint-disable-next-line no-await-in-loop -- 序列按顺序走：走完这一轮的微任务，才检查状态、走下一步
      await flushStep(ctx);
    } else if (!(disposed && (step === 'pause' || step === 'resume'))) {
      // 释放后调用 pause、resume 会抛错，这是约定（另有用例），这里跳过
      fireStep(ctx, step, index);
      if (flush) {
        // oxlint-disable-next-line no-await-in-loop -- 序列按顺序走：这一步的通知和重新加载走完，才检查状态、走下一步
        await flushStep(ctx);
      }
    }
    if (step === 'dispose' && !disposed) {
      disposed = true;
      callsAtDispose = ctx.map.calls.length;
    }
    const at = `第 ${index + 1} 步（${step}）之后`;
    checkState(at);
    if (flush || step === 'flush') {
      // oxlint-disable-next-line no-await-in-loop -- 检查的是这一步之后的 whenReady，要在走下一步之前
      await checkWhenReady(at);
    }
  }
  await flushStep(ctx);
  checkState('最后走完微任务之后');
  await checkWhenReady('最后走完微任务之后');

  for (const error of ctx.errors) {
    if (error instanceof Error && error.message.includes('不能从')) {
      problems.push(`报告了非法转换：${error.message}`);
    }
  }
  return { problems, transitions };
}

// 逐个执行，收集前 10 个违反和走到过的转换
async function runAll(runs: readonly SequenceRun[]): Promise<{ violations: string[]; reached: Set<string> }> {
  const violations: string[] = [];
  const reached = new Set<string>();
  for (const run of runs) {
    // oxlint-disable-next-line no-await-in-loop -- 逐个执行：并行时各序列的微任务交错，flushMicrotasks 的轮数就不对应一个序列
    const { problems, transitions } = await runSequence(run);
    for (const transition of transitions) {
      reached.add(transition);
    }
    if (problems.length > 0 && violations.length < 10) {
      const steps = [...run.prefix, '|', ...run.steps].join(' → ');
      violations.push(`${run.active ? '显示' : '暂停'}创建，${steps}：${problems.join('；')}`);
    }
  }
  return { violations, reached };
}

// 交错序列的起点：每一步之后都走完微任务，把视图带到不同的状态
const STARTING_POINTS: readonly (readonly SequenceStep[])[] = [
  [], // 加载中
  ['load'], // 就绪（暂停创建时为 paused）
  ['load', 'pause'], // 暂停
  ['load', 'reject'], // 运行中整体重建
  ['error'], // 首次加载失败
  ['load', 'reject', 'error'], // 重建失败
  ['load', 'breakEngine', 'reject'], // 引擎失败
  ['error', 'commit'] // 失败后用新的提交重新加载
];

// 只经过微任务、不会挂起，耗时由序列数决定；全量并行运行时会超过默认的 5 秒（见 map-core.md 的测试）
describe('MapLibreView 的状态转换（穷举短序列）', { timeout: 20_000 }, () => {
  it('长度为 4 的所有事件序列里，每一步之后的状态、失败原因、whenReady 都符合约定，转换都在表里', async () => {
    const runs = [true, false].flatMap(active =>
      sequencesOf(SEQUENCE_STEPS, 4).map(steps => ({ active, prefix: [], steps, interleaved: false }))
    );

    const { violations, reached } = await runAll(runs);

    expect(runs).toHaveLength(2 * SEQUENCE_STEPS.length ** 4);
    expect(violations).toStrictEqual([]);
    // 事件足够强：表里除失败原因的更新之外，每一条转换都走到过，引擎失败在加载中、就绪时都发生过。
    // 暂停时的引擎失败要 6 步（就绪、重建中暂停、引擎坏掉、提交、加载失败后改用新提交重建），不在这里
    expect([...reached].toSorted()).toStrictEqual(
      [
        'initializing → ready',
        'initializing → paused',
        'initializing → failed(style)',
        'initializing → failed(engine)',
        'ready → paused',
        'ready → failed(style)',
        'ready → failed(engine)',
        'paused → ready',
        'paused → failed(style)',
        'failed(style) → initializing',
        'failed(style) → ready',
        'failed(style) → paused'
      ].toSorted()
    );
  });

  it('同一轮里交错的事件：从各个起点出发，长度为 3 的所有序列（走完微任务也是一个事件）都符合约定', async () => {
    const runs = [true, false].flatMap(active =>
      STARTING_POINTS.flatMap(prefix =>
        sequencesOf(INTERLEAVED_STEPS, 3).map(steps => ({ active, prefix, steps, interleaved: true }))
      )
    );

    const { violations, reached } = await runAll(runs);

    expect(runs).toHaveLength(2 * STARTING_POINTS.length * INTERLEAVED_STEPS.length ** 3);
    expect(violations).toStrictEqual([]);
    // 交错之后能走到"样式失败后加载又完成、激活时重建"这条路径：从 failed 先回到 initializing 再失败
    expect(reached).toContain('failed(style) → initializing');
    expect(reached).toContain('initializing → failed(engine)');
  });
});
