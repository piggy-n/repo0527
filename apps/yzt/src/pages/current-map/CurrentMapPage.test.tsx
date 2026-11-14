import type {
  LayerSpecification,
  ProjectionSpecification,
  SourceSpecification
} from '@maplibre/maplibre-gl-style-spec';
import type { Polygon } from 'geojson';
import {
  type CameraEventData,
  type GestureHandlerLike,
  geodesicDistance,
  type MapLibreMapOptions,
  type MapLike,
  type MapMouseEventLike,
  type MapMouseEventType,
  type MapMoveEventLike,
  type MapSession,
  type MapSessionOptions,
  type MapSubscription,
  type SourceDataEventLike,
  type RenderedFeatureLike,
  type SceneRenderer,
  tilesetCamera,
  type TilesetSphere,
  type ViewBounds
} from '@mx/map-core';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { MAP_SCENE_ENGINE, MAPLIBRE_ENGINE, MapCanvas, type SceneEngine } from '@mx/map-vue';
import { formatDistance } from '@mx/map-tools';
import { DOMWrapper, mount } from '@vue/test-utils';
import { ElSlider } from 'element-plus';
import { HttpResponse, http as mock } from 'msw';
import { setupServer } from 'msw/node';
import { createPinia } from 'pinia';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { type ComponentPublicInstance, defineComponent, KeepAlive, nextTick, ref } from 'vue';
import { builtInMinZooms } from '@/features/resource-map/min-zooms';
import { resourceTreeResponse } from '@/features/resource-map/test-data';
import cityFile from '@/shared/map/boundary/data/jiangsu-city.json?raw';
import countyFile from '@/shared/map/boundary/data/jiangsu-county.json?raw';
import { JIANGSU_BOUNDS } from '@/shared/map/jiangsu';
import { formatCoordinate, formatLngLat } from '@/shared/map/location/coordinate-format';
import { createMemoryStore } from '@/shared/storage/key-value-store';
import { required } from '@/shared/testing/required';
import { CurrentMapPage } from './CurrentMapPage';

// 页面在 provideMap 里创建会话：记下来，三维的用例从会话读三维内容和当前工具（地图本身是假的，见下面的 FakeMap）
const sessions = vi.hoisted((): MapSession<string>[] => []);
vi.mock('@mx/map-core', async importOriginal => {
  const actual = await importOriginal<typeof import('@mx/map-core')>();
  class RecordedMapSession<G extends string> extends actual.MapSession<G> {
    constructor(options: MapSessionOptions<G>) {
      super(options);
      sessions.push(this);
    }
  }
  return { ...actual, MapSession: RecordedMapSession };
});

interface FakeEvent {
  readonly error?: Error;
  readonly sourceId?: string;
  readonly dataType?: 'source' | 'style';
  readonly tile?: { readonly tileID: { readonly key: string }; readonly state?: string };
  readonly originalEvent?: unknown;
  readonly cause?: unknown;
  readonly point?: { readonly x: number; readonly y: number };
}

// 只模拟视图用到的行为：相机方法立即到位并同步触发 move，记下 fitBounds
// 手势开关只需要满足类型，这里的测试不关心它们
function fakeGesture(): GestureHandlerLike {
  let enabled = true;
  return {
    isEnabled: () => enabled,
    enable: () => void (enabled = true),
    disable: () => void (enabled = false)
  };
}

class FakeMap implements MapLike {
  readonly fitBoundsCalls: [number, number, number, number][] = [];
  readonly #listeners = new Map<string, Set<(event: FakeEvent) => void>>();
  camera: { lng: number; lat: number; zoom: number };

  constructor(readonly options: MapLibreMapOptions) {
    const [lng, lat] = options.center as [number, number];
    this.camera = { lng, lat, zoom: options.zoom ?? 0 };
  }

  // GeoJSON 数据源的当前数据：测量的数据随鼠标更新，要能找到数据源
  readonly geojson = new Map<string, unknown>();
  addSource(id: string, source: SourceSpecification): void {
    if (source.type === 'geojson') {
      this.geojson.set(id, source.data);
    }
  }
  removeSource(id: string): void {
    this.geojson.delete(id);
  }
  getSource(id: string): unknown {
    if (!this.geojson.has(id)) {
      return undefined;
    }
    return { type: 'geojson', setData: (data: unknown) => Promise.resolve(void this.geojson.set(id, data)) };
  }
  // 创建之后加入的图层和插在谁前面（undefined 是最上面）
  readonly addedLayers: [string, string | undefined][] = [];
  addLayer(layer: LayerSpecification, beforeId?: string): void {
    this.addedLayers.push([layer.id, beforeId]);
  }
  removeLayer(): void {}
  setPaintProperty(): void {}
  setLayoutProperty(): void {}
  setFilter(): void {}
  setLayerZoomRange(): void {}
  addImage(): void {}
  updateImage(): void {}
  removeImage(): void {}
  setStyle(): void {}

  on(type: 'style.load', listener: () => void): MapSubscription;
  on(type: 'error', listener: (event: { readonly error: Error }) => void): MapSubscription;
  on(type: 'dataloading' | 'sourcedata' | 'dataabort', listener: (event: SourceDataEventLike) => void): MapSubscription;
  on(type: 'move', listener: (event: MapMoveEventLike) => void): MapSubscription;
  on(type: 'movestart', listener: (event: MapMoveEventLike) => void): MapSubscription;
  on(type: 'moveend', listener: (event: MapMoveEventLike) => void): MapSubscription;
  on(type: 'resize', listener: () => void): MapSubscription;
  on(type: 'idle', listener: () => void): MapSubscription;
  on(type: MapMouseEventType, listener: (event: MapMouseEventLike) => void): MapSubscription;
  on(type: 'render' | 'webglcontextlost' | 'webglcontextrestored', listener: () => void): MapSubscription;
  on(type: string, listener: (event: never) => void): MapSubscription {
    const callback = listener as (event: FakeEvent) => void;
    const listeners = this.#listeners.get(type) ?? new Set();
    this.#listeners.set(type, listeners.add(callback));
    return { unsubscribe: () => listeners.delete(callback) };
  }

  fire(type: string, event: FakeEvent = {}): void {
    for (const listener of this.#listeners.get(type) ?? []) {
      listener(event);
    }
  }

  resize(): void {}

  getCenter() {
    return { lng: this.camera.lng, lat: this.camera.lat };
  }
  getZoom(): number {
    return this.camera.zoom;
  }
  getBearing(): number {
    return 0;
  }
  getPitch(): number {
    return 0;
  }

  jumpTo(camera: { center: [number, number]; zoom: number }, eventData: CameraEventData): void {
    this.moveTo(camera.center, camera.zoom, eventData);
  }

  readonly flyToCalls: unknown[] = [];
  easeTo(): void {}

  cameraForBounds(): undefined {
    return undefined;
  }

  flyTo(camera: { center?: [number, number]; zoom?: number }, eventData: CameraEventData): void {
    this.flyToCalls.push(camera);
    this.moveTo(camera.center ?? [this.camera.lng, this.camera.lat], camera.zoom ?? this.camera.zoom, eventData);
  }

  // 和拾取、投影一样每 100 像素 1 度
  panBy([x, y]: [number, number], _options: unknown, eventData: CameraEventData): void {
    this.moveTo([this.camera.lng + x / 100, this.camera.lat - y / 100], this.camera.zoom, eventData);
  }

  fitBounds(bounds: [number, number, number, number], _options: unknown, eventData: CameraEventData): void {
    this.fitBoundsCalls.push(bounds);
    const [west, south, east, north] = bounds;
    this.moveTo([(west + east) / 2, (south + north) / 2], 6.5, eventData);
  }

  // 拾取、投影用简单的换算：画布左上角是相机中心，每 100 像素 1 度，相机移动后位置跟着变
  // 画布尺寸变化时投影会变、相机不变：测试改这个偏移再发出 resize 来模拟
  screenOffset = { x: 0, y: 0 };
  unproject([x, y]: [number, number]) {
    return { lng: this.camera.lng + (x - this.screenOffset.x) / 100, lat: this.camera.lat - (y - this.screenOffset.y) / 100 };
  }
  // 点选用的渲染要素：按查询的图层过滤
  renderedFeatures: RenderedFeatureLike[] = [];
  queryRenderedFeatures(_geometry: unknown, options: { readonly layers: readonly string[] }): RenderedFeatureLike[] {
    return this.renderedFeatures.filter(feature => options.layers.includes(feature.layer.id));
  }
  project([lng, lat]: [number, number]) {
    return {
      x: (lng - this.camera.lng) * 100 + this.screenOffset.x,
      y: (this.camera.lat - lat) * 100 + this.screenOffset.y
    };
  }
  readonly canvas = document.createElement('canvas');
  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }
  readonly canvasContainer = document.createElement('div');
  getCanvasContainer(): HTMLElement {
    return this.canvasContainer;
  }
  readonly dragPan = fakeGesture();
  readonly doubleClickZoom = fakeGesture();
  readonly boxZoom = fakeGesture();
  readonly scrollZoom = { ...fakeGesture(), wheelRate: 0, trackpadRate: 0, setWheelZoomRate: (rate: number) => void (this.scrollZoom.wheelRate = rate), setZoomRate: (rate: number) => void (this.scrollZoom.trackpadRate = rate) };
  // 漫游接管地图时才用到（ADR 0147 第 4 节），这里的测试不漫游
  readonly dragRotate = fakeGesture();
  readonly keyboard = fakeGesture();
  readonly touchZoomRotate = fakeGesture();
  readonly touchPitch = fakeGesture();
  getMaxZoom(): number {
    return 22;
  }
  setMaxZoom(): void {}
  getVerticalFieldOfView(): number {
    return 36.87;
  }
  setVerticalFieldOfView(): void {}
  getCenterClampedToGround(): boolean {
    return true;
  }
  setCenterClampedToGround(): void {}

  getLayer(): unknown {
    return undefined;
  }
  moveLayer(): void {}
  getLayersOrder(): string[] {
    return [];
  }
  triggerRepaint(): void {}
  remove(): void {}
  // 投影、俯角上限和相机的变换只在三维引擎是 maplibre 时用到
  getProjection(): ProjectionSpecification | undefined {
    return undefined;
  }
  setProjection(): void {}
  getMaxPitch(): number {
    return 60;
  }
  setMaxPitch(): void {}
  readonly _camera = {
    transform: {
      getCameraAltitude: () => 1000,
      getCameraLngLat: () => ({ lng: this.camera.lng, lat: this.camera.lat }),
      isPointOnMapSurface: () => true,
      isLocationOccluded: () => false
    }
  };

  /** 模拟用户拖动：带原始的 DOM 事件 */
  drag(lng: number, lat: number): void {
    this.moveTo([lng, lat], this.camera.zoom, { originalEvent: new MouseEvent('mousemove') });
  }

  /** 模拟程序定位动画中间的一帧：只有 move，带 fitBounds 等方法的 eventData */
  frame(lng: number, lat: number): void {
    this.camera = { ...this.camera, lng, lat };
    this.fire('move', { cause: 'program' });
  }

  /** 模拟鼠标：detail 是连击的次数 */
  mouse(type: MapMouseEventType, x: number, y: number, detail = 1): void {
    this.fire(type, { point: { x, y }, originalEvent: new MouseEvent(type, { detail, button: 0 }) });
  }

  // 立即到位的移动：和 jumpTo 一样先发 movestart 再发 move
  moveTo([lng, lat]: [number, number], zoom: number, event: FakeEvent): void {
    this.camera = { lng, lat, zoom };
    this.fire('movestart', event);
    this.fire('move', event);
  }
}

// 瓦片集就绪时渲染器给出的包围球：三维视图按它算出建议的相机
const MODEL_SPHERE: TilesetSphere = { center: [120.666, 31.3175], height: 0, radius: 120 };

// 三维视图下载的 tileset.json：只要能通过 prepareTileset 的校验
const TILESET_JSON = {
  asset: { version: '1.1' },
  geometricError: 10,
  root: { boundingVolume: { sphere: [0, 0, 0, 10] }, geometricError: 0, content: { uri: 'a.glb' } }
};

/**
 * 三维渲染器的替身（真实的是 @mx/map-three）：瓦片集等用例调用 ready 才就绪；拾取、投影都落空。
 * 三维视图第一次切到三维时创建它
 */
function fakeRenderer() {
  const pending = new Map<string, (sphere: TilesetSphere) => void>();
  const renderer: SceneRenderer = {
    attach: () => undefined,
    detach: () => undefined,
    loseContext: () => undefined,
    prerender: () => undefined,
    render: () => undefined,
    endFrame: () => undefined,
    addTileset: (id, _tileset, _options, signal) =>
      new Promise((resolve, reject) => {
        pending.set(id, resolve);
        signal.addEventListener('abort', () => reject(new DOMException('瓦片集已撤下', 'AbortError')), { once: true });
      }),
    updateTileset: () => undefined,
    removeTileset: id => void pending.delete(id),
    addSplat: () => new Promise(() => undefined),
    updateSplat: () => undefined,
    removeSplat: () => undefined,
    pick: () => null,
    project: () => null,
    setLift: () => undefined,
    lowestHeight: () => null,
    setInteriorFog: () => undefined,
    setMarker: () => undefined,
    on: () => () => undefined,
    [Symbol.dispose]: () => undefined
  };
  /** 让还在加载的瓦片集就绪；还没交给渲染器时抛错 */
  const ready = (id: string) => required(pending.get(id), `瓦片集 ${id} 没有在加载`)(MODEL_SPHERE);
  return { renderer, ready };
}

interface PageModules {
  readonly page: typeof CurrentMapPage;
  readonly canvas: typeof MapCanvas;
}

const STATIC_MODULES: PageModules = { page: CurrentMapPage, canvas: MapCanvas };

// 区划边界的加载器是整个应用共用的，同一个文件只解析一次：重新导入页面，边界从没有缓存开始，像第一次打开页面
async function freshModules(): Promise<PageModules> {
  vi.resetModules();
  const [{ CurrentMapPage: page }, { MapCanvas: canvas }] = await Promise.all([
    import('./CurrentMapPage'),
    import('@mx/map-vue')
  ]);
  return { page, canvas };
}

/**
 * 页面里的画布用真实的 MapLibre，jsdom 里创建不出来；用 stubs 换成注入了假地图的同一个组件。
 * 三维是同一个视图，三维模块换成渲染器的替身，能力同 app 注入的（三维里不显示资源图层、不识别）。
 * 第一次创建可以设为失败，模拟引擎失败后重试；canvasKey 变化时画布重建
 */
function mountPage({ failFirstCreation = false, modules = STATIC_MODULES, keepAlive = false } = {}) {
  const canvasKey = ref(0);
  // keepAlive 时页面放在 KeepAlive 里，pageShown 为 false 时停用（缓存），和布局里一样（ADR 0063）
  const pageShown = ref(true);
  const maps: FakeMap[] = [];
  const renderers: ReturnType<typeof fakeRenderer>[] = [];
  const engine: SceneEngine = {
    capabilities: { ...MAPLIBRE_ENGINE.capabilities, styleLayers: false, identify: false },
    loadRenderer: () =>
      Promise.resolve(() => {
        const created = fakeRenderer();
        renderers.push(created);
        return created.renderer;
      })
  };
  const firstSession = sessions.length;
  // 记录组件实际更新次数，验证高频输入不会带动整页或整份列表重渲染
  const updates = new Map<string, number>();
  let attempts = 0;
  const createMap = (options: MapLibreMapOptions): MapLike => {
    attempts++;
    if (failFirstCreation && attempts === 1) {
      throw new Error('创建地图失败');
    }
    const map = new FakeMap(options);
    maps.push(map);
    return map;
  };
  // 换个名字，免得替身里的画布又被替换成替身；页面传给画布的属性（如 mapOptions）原样转交
  const RealCanvas = { ...modules.canvas, name: 'RealMapCanvas' } as typeof MapCanvas;
  const CanvasWithFakeMap = defineComponent({
    inheritAttrs: false,
    setup: (_, { attrs }) => () => <RealCanvas {...attrs} key={canvasKey.value} createMap={createMap} />
  });
  // 每个页面用新的查询缓存，资源目录不在用例之间残留
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // 页面按会话创建偏好的范围；测试里没有登录，范围为 null，不读不写
  const Page = modules.page;
  const root = keepAlive
    ? defineComponent(() => () => <KeepAlive>{pageShown.value ? <Page /> : null}</KeepAlive>)
    : Page;
  const wrapper = mount(root, {
    global: {
      plugins: [createPinia(), [VueQueryPlugin, { queryClient }]],
      stubs: { MapCanvas: CanvasWithFakeMap },
      // 像 app 一样在地图页外面提供三维引擎
      provide: { [MAP_SCENE_ENGINE as symbol]: engine },
      mixins: [
        {
          updated(this: ComponentPublicInstance) {
            const name = this.$options.name;
            if (name) {
              updates.set(name, (updates.get(name) ?? 0) + 1);
            }
          }
        }
      ]
    }
  });
  const session = () => sessions[firstSession];
  return { wrapper, maps, renderers, session, canvasKey, pageShown, updates };
}

// 资源树默认返回测试数据（结构同实测）；用例可以换成失败的响应。进页面就读模型清单（ADR 0157），默认是空的
const TREE_URL = '/backend/resource-map/base/tree';
const server = setupServer(
  mock.get(TREE_URL, () => HttpResponse.json(resourceTreeResponse())),
  mock.get('*/3dt/manifest.json', () => HttpResponse.json({ models: [] })),
  mock.get('*/3dt/*/tileset.json', () => HttpResponse.json(TILESET_JSON)),
  mock.get('*/resource-min-zooms.json', () => HttpResponse.json(builtInMinZooms()))
);

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterAll(() => {
  server.close();
});

const jiangsu = [...JIANGSU_BOUNDS] as ViewBounds;
const NANJING: ViewBounds = [118.357927, 31.230207, 119.236382, 32.616407];
const XUANWU: ViewBounds = [118.778682, 32.017001, 118.90731, 32.107079];

// 等定位相关的微任务和渲染都走完
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

// 按文字或无障碍名称找按钮（基础组只有图标）；面板外壳的 Tab 和工具栏的按钮可能同名，不算 Tab
function button(wrapper: ReturnType<typeof mountPage>['wrapper'], text: string) {
  const found = wrapper
    .findAll('button')
    .find(
      candidate =>
        (candidate.text() === text || candidate.attributes('aria-label') === text) &&
        candidate.attributes('role') !== 'tab'
    );
  if (!found) {
    throw new Error(`没有"${text}"按钮`);
  }
  return found;
}

// 在页面空白处按下，到 toX 松开：不动就是单击，移动了就是拖动
function pressAndRelease(toX: number): void {
  document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 100 }));
  document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, clientX: toX, clientY: 100 }));
}

// Popover 挂在 body 下，按功能名称找到其内容
function optionsPopover(name: string) {
  const element = document.querySelector(`[data-map-options="${name}"]`);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`没有"${name}"浮层`);
  }
  return new DOMWrapper(element);
}

// 过渡桩可能保留已隐藏节点，兼容实际隐藏或过渡结束后卸载
function optionsPopoverVisible(name: string): boolean {
  const element = document.querySelector(`[data-map-options="${name}"]`);
  return element instanceof HTMLElement && new DOMWrapper(element).isVisible();
}

// 面板外壳里正在显示的那个功能（ADR 0053 第 4 节）；切走的内容还在，只是隐藏
function shownPanels(wrapper: ReturnType<typeof mountPage>['wrapper']): (string | undefined)[] {
  return wrapper
    .findAll<HTMLElement>('[role="tabpanel"]')
    .filter(panel => panel.element.style.display !== 'none')
    .map(panel => panel.attributes('data-panel'));
}

// 测量浮层里的标签和提示：文字与位置（像素取整）
function overlayItems(wrapper: ReturnType<typeof mountPage>['wrapper']) {
  return [...wrapper.get('[data-measure-overlay]').element.children].map(element => {
    const { style, textContent } = element as HTMLElement;
    const [x, y] = [style.left, style.top].map(value => Math.round(Number.parseFloat(value)));
    return { text: textContent, x, y };
  });
}

// 从画布左上角向右画一条 100 像素的线，双击结束：双击时浏览器先发第二次单击（连击次数 2），再发 dblclick
function drawLine(map: FakeMap): void {
  map.mouse('click', 0, 0);
  map.mouse('click', 100, 0);
  map.mouse('click', 100, 0, 2);
  map.mouse('dblclick', 100, 0, 2);
}

afterEach(() => {
  server.resetHandlers();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  observed.clear();
  document.body.innerHTML = '';
});

// jsdom 没有布局，也没有 ResizeObserver：替身按被观察的元素记下回调，用例给页面根元素设定尺寸后手动触发
const observed = new Map<Element, (width: number, height: number) => void>();

class ResizeObserverStub {
  readonly #callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.#callback = callback;
  }

  observe(target: Element) {
    observed.set(target, (width, height) => {
      const size = [{ inlineSize: width, blockSize: height }];
      const entry = { target, contentRect: { width, height }, contentBoxSize: size, borderBoxSize: size };
      this.#callback([entry as unknown as ResizeObserverEntry], this);
    });
  }

  unobserve() {}

  disconnect() {}
}

// 页面根元素（地图区域）的尺寸
async function resizePage(wrapper: PageWrapper, width: number, height: number) {
  observed.get(wrapper.get('[data-map-page]').element)?.(width, height);
  await nextTick();
}

// 边界文件按地址给出：县界或市界
function stubBoundaryFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn<(url: string) => Promise<Response>>(url =>
      // 三维视图下载 tileset.json 也用 fetch
      Promise.resolve(
        url.endsWith('/tileset.json')
          ? Response.json(TILESET_JSON)
          : new Response(url.includes('county') ? countyFile : cityFile)
      )
    )
  );
}

// 边界文件的请求先挂起，由用例决定什么时候返回
function deferBoundaryFetch() {
  const pending: { readonly url: string; readonly resolve: (response: Response) => void }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn<(url: string) => Promise<Response>>(url => new Promise(resolve => pending.push({ url, resolve })))
  );
  return {
    release(file: 'city' | 'county') {
      for (const request of pending.filter(({ url }) => url.includes(file))) {
        request.resolve(new Response(file === 'county' ? countyFile : cityFile));
      }
    }
  };
}

// 页面就绪：创建地图、加载完样式、做完初始定位
async function readyPage(modules?: PageModules) {
  const page = mountPage({ modules });
  const map = page.maps[0];
  if (!map) {
    throw new Error('没有创建地图');
  }
  map.fire('style.load');
  await settle();
  return { ...page, map };
}

// 页面放在 KeepAlive 里就绪：创建地图、加载完样式、做完初始定位（ADR 0063）
async function readyCachedPage(modules?: PageModules) {
  const page = mountPage({ keepAlive: true, modules });
  const map = page.maps[0];
  if (!map) {
    throw new Error('没有创建地图');
  }
  map.fire('style.load');
  await settle();
  return { ...page, map };
}


type PageWrapper = ReturnType<typeof mountPage>['wrapper'];

function valueOf(wrapper: PageWrapper, label: string): string {
  return (wrapper.get(`input[aria-label="${label}"]`).element as HTMLInputElement).value;
}

function pin(wrapper: PageWrapper) {
  return wrapper.get('[aria-label="坐标定位点"]');
}

// 图钉在画布上的位置（像素取整）
function pinAt(wrapper: PageWrapper): [number, number] {
  const { left, top } = (pin(wrapper).element as HTMLElement).style;
  return [Math.round(Number.parseFloat(left)), Math.round(Number.parseFloat(top))];
}

// 资源图层面板目录树里某个资源的一行
function resourceRow(wrapper: PageWrapper, code: string): ReturnType<PageWrapper['get']> {
  return wrapper.get(`[data-catalog-node="resource:${code}"]`);
}

// 当前图层里某个资源的一行：状态、年份、移除都在这里
function layerRow(wrapper: PageWrapper, code: string): ReturnType<PageWrapper['get']> {
  return wrapper.get(`[data-current-row="resource:${code}"]`);
}

// 页面的分组；图层 ID 以分组名为前缀，basemap 和 basemap-labels、region 和 region-clip 的前缀重叠，按最长的算
const GROUPS = [
  'basemap',
  'resources',
  'selection',
  'region-clip',
  'basemap-labels',
  'boundaries',
  'region',
  'measure'
];

function groupOf(id: string): string | undefined {
  return GROUPS.filter(group => id.startsWith(`${group}-`)).toSorted((a, b) => b.length - a.length)[0];
}

// 地类图斑的数据源的一张瓦片的事件（ADR 0158）
const parcelTile = (key: string): FakeEvent => ({
  dataType: 'source',
  sourceId: 'resources-bgdc_dltb',
  tile: { tileID: { key }, state: 'loading' }
});

// 某个分组新加入的图层：资源目录加载后地类图斑也会加入，与要检查的分组无关
function addedLayersOf(map: FakeMap, group: string): [string, string | undefined][] {
  return map.addedLayers.filter(([id]) => groupOf(id) === group);
}

// jsdom 没有 PointerEvent，用同名的 MouseEvent 代替
async function pointer(wrapper: PageWrapper, type: string, clientX = 0, clientY = 0, mouseButton = 0) {
  pin(wrapper).element.dispatchEvent(new MouseEvent(type, { bubbles: true, button: mouseButton, clientX, clientY }));
  await nextTick();
}

// 三维模型的清单：结构同入库的清单（ADR 0081）
function mockManifest() {
  let requests = 0;
  server.use(
    mock.get('*/3dt/manifest.json', () => {
      requests++;
      return HttpResponse.json({
        models: [
          {
            id: 'sz-station',
            name: '苏州站地下空间',
            cityCode: '320500',
            kind: 'indoor',
            underground: true,
            tileset: 'SZ_3DT/tileset.json',
            spawn: { lng: 120.666, lat: 31.3175, height: -5.1, heading: 76 },
            routes: [
              {
                id: 'enter',
                name: '进站乘车',
                path: [
                  [120.666, 31.3175, -5.1],
                  [120.6662, 31.3175, -5.1]
                ]
              }
            ]
          }
        ]
      });
    })
  );
  return () => requests;
}

// 步行先建导航网格：这里让它的瓦片集请求失败，返回请求的次数。
// 三维视图加载勾选的模型时请求同一个地址，用 fetch（Accept 是 */*），照常返回；导航网格经 http 客户端（axios 带 application/json）
function failNavigation() {
  let requests = 0;
  server.use(
    mock.get('*/3dt/SZ_3DT/tileset.json', ({ request }) => {
      if (!request.headers.get('accept')?.includes('application/json')) {
        return HttpResponse.json(TILESET_JSON);
      }
      requests++;
      return new HttpResponse(null, { status: 404 });
    })
  );
  return () => requests;
}

// 在资源目录里展开全部、选中模型，用工具栏加入当前地图（ADR 0157）
async function addModel(wrapper: ReturnType<typeof mountPage>['wrapper'], id: string) {
  await vi.waitFor(() => expect(wrapper.find('[data-catalog-node="model-root"]').exists()).toBe(true));
  await wrapper.get('[data-tool="expand-all"]').trigger('click');
  await wrapper.get(`[data-catalog-node="model:${id}"]`).trigger('click');
  await wrapper.get('[data-tool="add"]').trigger('click');
  await settle();
}

// 当前图层里模型行的"漫游"（车站有出生点，从步行开始），再在漫游面板上换成路线
async function startRoute(wrapper: ReturnType<typeof mountPage>['wrapper']) {
  await button(wrapper, '漫游').trigger('click');
  await settle();
  await wrapper.get('[data-roam-panel] [aria-label="漫游方式"]').findAll('input').at(1)?.setValue(true);
  await settle();
}

// 在窗口上按一个键，等页面处理完（漫游的空格、Esc 监听在窗口上）
async function pressKey(value: string) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: value }));
  await settle();
}

async function switchTo(wrapper: ReturnType<typeof mountPage>['wrapper'], label: '二维' | '三维') {
  await button(wrapper, label).trigger('click');
  await settle();
}

// 三维：页面的会话，和让瓦片集就绪的函数（等三维视图下载 tileset.json、交给渲染器，就绪的状态传到页面）
function sceneOf(page: ReturnType<typeof mountPage>) {
  const session = required(page.session(), '没有创建地图会话');
  const renderer = required(page.renderers[0], '没有创建三维渲染器');
  return {
    session,
    ready: async (id: string) => {
      await vi.waitFor(() => renderer.ready(id));
      await settle();
    }
  };
}

const basemapCardOf = (wrapper: PageWrapper) => wrapper.get('[data-map-cards] button:last-child');

// 换成无底图；页面隐藏时偏好不等防抖，立即写入
async function chooseNoBasemap(wrapper: PageWrapper) {
  await basemapCardOf(wrapper).trigger('click');
  await vi.waitFor(() => expect(optionsPopover('basemap').exists()).toBe(true));
  await optionsPopover('basemap').get('button[aria-label="无底图"]').trigger('click');
  window.dispatchEvent(new Event('pagehide'));
}

describe('CurrentMapPage', () => {
  it('绑定底图、注记和边界，从下到上是底图、注记、省界', () => {
    const { maps } = mountPage();
    const style = maps[0]?.options.style;
    if (!style || typeof style === 'string') {
      throw new Error('没有用会话的样式创建地图');
    }

    expect(style.layers.map(layer => layer.id)).toStrictEqual([
      'basemap-background',
      'basemap-vector',
      'basemap-labels-vector',
      'boundaries-province-band',
      'boundaries-province-casing',
      'boundaries-province'
    ]);
  });

  it('底图 Popover 只包含底图，缩略图同步选择；关闭功能组不清空底图选择', async () => {
    const { wrapper } = await readyPage();
    const basemapCard = () => wrapper.get('[data-map-cards] button:last-child');
    const cover = () => basemapCard().get('[aria-hidden="true"]').attributes('style') ?? '';
    expect(cover()).toContain('/vec_w/');
    expect([basemapCard().text(), basemapCard().attributes('aria-label')]).toStrictEqual(['矢量', '底图：矢量底图']);

    await basemapCard().trigger('click');
    await vi.waitFor(() => expect(optionsPopover('basemap').exists()).toBe(true));
    expect(basemapCard().attributes('aria-pressed')).toBe('true');
    expect(optionsPopover('basemap').find('[aria-label="行政区边界"]').exists()).toBe(false);
    expect(optionsPopover('basemap').find('h2, h3').exists()).toBe(false);
    expect(optionsPopover('basemap').find('[aria-label="关闭底图"]').exists()).toBe(false);

    // 选了底图就关闭
    await optionsPopover('basemap').get('button[aria-label="影像底图"]').trigger('click');
    expect(cover()).toContain('/img_w/');
    expect([basemapCard().text(), basemapCard().attributes('aria-label')]).toStrictEqual(['影像', '底图：影像底图']);
    expect(basemapCard().attributes('aria-pressed')).toBe('false');
    await button(wrapper, '图例').trigger('click');
    expect(button(wrapper, '图例').attributes('aria-pressed')).toBe('true');

    await button(wrapper, '关闭图例').trigger('click');
    expect(button(wrapper, '图例').attributes('aria-pressed')).toBe('false');
    expect(basemapCard().text()).toBe('影像');
  });

  it('行政区边界并入功能标签；底图的标注和透明度、行政区的透明度分别控制，关闭重开保留数值且默认收起', async () => {
    const { wrapper } = await readyPage();
    // 地图的工具栏是竖排的；资源图层面板里的两个工具栏是横排的
    const toolbar = wrapper.get('[role="toolbar"][aria-orientation="vertical"]');
    const labels = toolbar.findAll('button').map(item => item.attributes('aria-label'));
    expect(labels.slice(-3)).toStrictEqual(['行政区边界', '图例', '清除测量与定位标记']);
    await button(wrapper, '底图：矢量底图').trigger('click');
    await vi.waitFor(() => expect(optionsPopover('basemap').exists()).toBe(true));
    expect(wrapper.findAllComponents(ElSlider)).toHaveLength(0);

    await optionsPopover('basemap').get('[aria-label="调整标注和透明度"]').trigger('click');
    expect(optionsPopover('basemap').get('[aria-label="调整标注和透明度"]').attributes('aria-pressed')).toBe('true');
    wrapper.getComponent(ElSlider).vm.$emit('update:modelValue', 40);
    await nextTick();
    expect(optionsPopover('basemap').text()).toContain('40%');
    await optionsPopover('basemap').get('[aria-label="调整标注和透明度"]').trigger('click');
    expect(wrapper.findAllComponents(ElSlider)).toHaveLength(0);
    expect(optionsPopover('basemap').get('[aria-label="调整标注和透明度"]').attributes('aria-pressed')).toBe('false');
    await button(wrapper, '底图：矢量底图').trigger('click');
    await vi.waitFor(() => expect(optionsPopoverVisible('basemap')).toBe(false));

    await button(wrapper, '行政区边界').trigger('click');
    expect(shownPanels(wrapper)).toStrictEqual(['boundaries']);
    const boundaryPanel = () => wrapper.get('[data-panel="boundaries"]');
    expect(boundaryPanel().find('[aria-label="底图"]').exists()).toBe(false);
    expect(button(wrapper, '行政区边界').attributes('aria-pressed')).toBe('true');
    expect(wrapper.findAllComponents(ElSlider)).toHaveLength(0);
    await boundaryPanel().get('[aria-label="调整行政区边界透明度"]').trigger('click');
    expect(boundaryPanel().get('[aria-label="调整行政区边界透明度"]').attributes('aria-pressed')).toBe('true');
    wrapper.getComponent(ElSlider).vm.$emit('update:modelValue', 70);
    await nextTick();
    await boundaryPanel().get('[aria-label="调整行政区边界透明度"]').trigger('click');
    expect(wrapper.findAllComponents(ElSlider)).toHaveLength(0);
    expect(boundaryPanel().get('[aria-label="调整行政区边界透明度"]').attributes('aria-pressed')).toBe('false');
    await boundaryPanel().get('[aria-label="调整行政区边界透明度"]').trigger('click');
    expect(wrapper.getComponent(ElSlider).props('modelValue')).toBe(70);
    await button(wrapper, '图例').trigger('click');
    expect(button(wrapper, '行政区边界').attributes('aria-pressed')).toBe('false');
    expect(wrapper.get('[aria-label="已打开的地图工具"] [aria-selected="false"]').text()).toBe('行政区边界');
    await button(wrapper, '行政区边界').trigger('click');
    expect(shownPanels(wrapper)).toStrictEqual(['boundaries']);
    // 正在显示时再次点入口关闭，其他标签保留
    await button(wrapper, '行政区边界').trigger('click');
    expect(button(wrapper, '行政区边界').attributes('aria-pressed')).toBe('false');
    expect(wrapper.find('[data-panel="boundaries"]').exists()).toBe(false);
    expect(shownPanels(wrapper)).toStrictEqual(['legend']);

    await button(wrapper, '底图：矢量底图').trigger('click');
    await vi.waitFor(() => expect(optionsPopover('basemap').exists()).toBe(true));
    expect(wrapper.findAllComponents(ElSlider)).toHaveLength(0);
    expect(optionsPopover('basemap').get('[aria-label="调整标注和透明度"]').attributes('aria-pressed')).toBe('false');
    await optionsPopover('basemap').get('[aria-label="调整标注和透明度"]').trigger('click');
    expect(wrapper.getComponent(ElSlider).props('modelValue')).toBe(40);

    // 无底图没有可调的：选了就关闭，再打开时没有入口
    await optionsPopover('basemap').get('[aria-label="无底图"]').trigger('click');
    await button(wrapper, '底图：无底图').trigger('click');
    await vi.waitFor(() => expect(optionsPopoverVisible('basemap')).toBe(true));
    expect(wrapper.findAllComponents(ElSlider)).toHaveLength(0);
    expect(optionsPopover('basemap').find('[aria-label="调整标注和透明度"]').exists()).toBe(false);
    await optionsPopover('basemap').get('[aria-label="矢量底图"]').trigger('click');
    await button(wrapper, '底图：矢量底图').trigger('click');
    await vi.waitFor(() => expect(optionsPopoverVisible('basemap')).toBe(true));
    expect(optionsPopover('basemap').get('[aria-label="调整标注和透明度"]').attributes('aria-pressed')).toBe('false');
    await optionsPopover('basemap').get('[aria-label="调整标注和透明度"]').trigger('click');
    expect(wrapper.getComponent(ElSlider).props('modelValue')).toBe(40);
  });

  it('底图浮层：再点入口、单击外部、按 Esc 都关闭；拖动地图不关闭', async () => {
    const name = 'basemap';
    const { wrapper } = await readyPage();
    const trigger = button(wrapper, '底图：矢量底图');
    const reopen = async () => {
      await trigger.trigger('click');
      await vi.waitFor(() => expect(optionsPopoverVisible(name)).toBe(true));
    };
    const expectClosed = async () => {
      expect(trigger.attributes('aria-pressed')).toBe('false');
      await vi.waitFor(() => expect(optionsPopoverVisible(name)).toBe(false));
    };

    await reopen();
    await trigger.trigger('click');
    await expectClosed();

    await reopen();
    pressAndRelease(200);
    await nextTick();
    expect(trigger.attributes('aria-pressed')).toBe('true');

    pressAndRelease(100);
    await nextTick();
    await expectClosed();

    await reopen();
    await optionsPopover(name).trigger('keydown', { key: 'Escape', code: 'Escape' });
    await expectClosed();
  });

  it('第一次就绪时按江苏范围定位一次；画布重建后再次就绪时不再定位，保留用户调整过的视角', async () => {
    const { maps, canvasKey } = mountPage();
    const first = maps[0];
    if (!first) {
      throw new Error('没有创建地图');
    }

    expect(first.options).toMatchObject({ minZoom: 5, maxZoom: 18 });
    first.fire('style.load');
    await settle();
    expect(first.fitBoundsCalls).toEqual([jiangsu]);

    // 用户拖动后画布重建：新视图按会话里的相机创建，就绪后不再定位
    first.drag(120.6, 31.3);
    canvasKey.value++;
    await nextTick();
    const second = maps[1];
    if (!second) {
      throw new Error('画布没有重建');
    }
    second.fire('style.load');
    await settle();

    expect(second.options.center).toEqual([120.6, 31.3]);
    expect(second.fitBoundsCalls).toEqual([]);
  });

  it('基础组：层级随相机变化；放大、缩小每次 1 级；画布带上调低的滚轮速率（ADR 0053 第 3 节）', async () => {
    const { wrapper, maps } = mountPage();
    const map = maps[0];
    if (!map) {
      throw new Error('没有创建地图');
    }
    map.fire('style.load');
    await settle();
    expect([map.scrollZoom.wheelRate, map.scrollZoom.trackpadRate]).toStrictEqual([1 / 600, 1 / 150]);

    map.moveTo([119, 32], 13.6, {});
    await nextTick();
    expect(wrapper.get('[role="status"]').text()).toBe('13');

    await button(wrapper, '放大').trigger('click');
    expect(map.flyToCalls.at(-1)).toStrictEqual({ zoom: 14.6, duration: 300 });
    await nextTick();
    expect(wrapper.get('[role="status"]').text()).toBe('14');
    await button(wrapper, '缩小').trigger('click');
    expect(map.flyToCalls.at(-1)).toStrictEqual({ zoom: 13.6, duration: 300 });

    // 指北针只交出旋转和俯仰，中心、级别和避让的偏移都不传（ADR 0058）
    await wrapper.get('button[aria-label^="指北针"]').trigger('click');
    expect(map.flyToCalls.at(-1)).toStrictEqual({ bearing: 0, pitch: 0, duration: 300 });
  });

  it('状态栏：比例尺和鼠标所在的经纬度，写法跟着坐标定位面板；鼠标离开画布时是中心；没有版权控件（ADR 0053 第 5 节）', async () => {
    const { wrapper, map } = await readyPage();
    const status = () => wrapper.get('[data-map-status-bar]').element.firstElementChild?.textContent;
    expect(map.options.attributionControl).toBe(false);

    // 假地图每 100 像素 1 度：画布中间相距 100 像素的两点在北纬 32° 相距约 94.6 千米，比例尺取 50 千米
    map.moveTo([119, 32], 9, {});
    await nextTick();
    expect(status()).toBe(`50 km中心${formatLngLat([119, 32], 'dms')}`);

    // 鼠标的位置在下一帧写入
    map.mouse('mousemove', 100, 50);
    await new Promise(resolve => requestAnimationFrame(resolve));
    await nextTick();
    expect(status()).toBe(`50 km${formatLngLat([120, 31.5], 'dms')}`);

    await button(wrapper, '坐标定位').trigger('click');
    await wrapper.get('input[value="decimal"]').setValue();
    expect(status()).toBe(`50 km${formatLngLat([120, 31.5], 'decimal')}`);

    map.mouse('mouseout', 100, 50);
    await new Promise(resolve => requestAnimationFrame(resolve));
    await nextTick();
    expect(status()).toBe(`50 km中心${formatLngLat([119, 32], 'decimal')}`);
  });

  it('点"默认视角"按江苏的范围再定位一次', async () => {
    const { wrapper, maps } = mountPage();
    const map = maps[0];
    if (!map) {
      throw new Error('没有创建地图');
    }
    map.fire('style.load');
    await settle();
    map.drag(120.6, 31.3);

    await button(wrapper, '默认视角').trigger('click');

    expect(map.fitBoundsCalls).toEqual([jiangsu, jiangsu]);
  });

  it('第一次创建地图失败、重试成功后，补做一次初始定位', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const { wrapper, maps } = mountPage({ failFirstCreation: true });
      await nextTick();
      expect(maps).toHaveLength(0);

      await button(wrapper, '重试').trigger('click');
      await nextTick();
      const map = maps[0];
      if (!map) {
        throw new Error('重试后没有创建地图');
      }
      map.fire('style.load');
      await settle();

      expect(map.fitBoundsCalls).toEqual([jiangsu]);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('测距：提示跟随鼠标；画完后在末点显示总长，标签随相机移动；删除一条、"清除"清掉全部；换成测面', async () => {
    const { wrapper, maps } = mountPage();
    const map = maps[0];
    if (!map) {
      throw new Error('没有创建地图');
    }
    map.fire('style.load');
    await settle();

    await button(wrapper, '测距').trigger('click');
    map.mouse('mousemove', 30, 40);
    await nextTick();
    expect(overlayItems(wrapper)).toStrictEqual([{ text: '单击开始测距', x: 30, y: 40 }]);

    const { lng, lat } = map.getCenter();
    map.mouse('click', 0, 0);
    await nextTick();
    expect(overlayItems(wrapper)).toStrictEqual([{ text: '单击添加节点，双击结束，Esc 取消', x: 30, y: 40 }]);
    // 移动鼠标：提示的第一行是含鼠标所在点的长度
    map.mouse('mousemove', 50, 0);
    await nextTick();
    const preview = `总长 ${formatDistance(geodesicDistance([lng, lat], [lng + 0.5, lat]))}`;
    expect(overlayItems(wrapper)).toStrictEqual([{ text: `${preview}单击添加节点，双击结束，Esc 取消`, x: 50, y: 0 }]);
    map.mouse('mousemove', 30, 40);
    // 测量的图层叠在最上面：最上面的节点先加入，其余依次插在它下面
    expect(addedLayersOf(map, 'measure')).toStrictEqual([
      ['measure-vertex', undefined],
      ['measure-line-drawing', 'measure-vertex'],
      ['measure-line-completed', 'measure-line-drawing'],
      ['measure-fill-drawing', 'measure-line-completed'],
      ['measure-fill-completed', 'measure-fill-drawing']
    ]);
    map.mouse('click', 100, 0);
    map.mouse('click', 100, 0, 2);
    map.mouse('dblclick', 100, 0, 2);
    await nextTick();

    const total = `总长 ${formatDistance(geodesicDistance([lng, lat], [lng + 1, lat]))}`;
    expect(overlayItems(wrapper)).toStrictEqual([
      { text: total, x: 100, y: 0 },
      { text: '单击开始测距', x: 30, y: 40 }
    ]);
    expect(map.geojson.has('measure')).toBe(true);

    map.drag(lng + 0.5, lat);
    await nextTick();
    expect(overlayItems(wrapper)[0]).toStrictEqual({ text: total, x: 50, y: 0 });

    // 图标由页面给出（@mx/map-tools 不依赖应用的图标）
    expect(wrapper.find('[aria-label="删除这条测量"] svg').exists()).toBe(true);
    await wrapper.get('[aria-label="删除这条测量"]').trigger('click');
    expect(overlayItems(wrapper)).toStrictEqual([{ text: '单击开始测距', x: 30, y: 40 }]);
    expect(map.geojson.has('measure')).toBe(false);

    drawLine(map);
    await nextTick();
    expect(overlayItems(wrapper)).toHaveLength(2);
    await button(wrapper, '清除测量与定位标记').trigger('click');
    expect(overlayItems(wrapper)).toStrictEqual([{ text: '单击开始测距', x: 30, y: 40 }]);
    expect(map.geojson.has('measure')).toBe(false);

    // 再点"测距"退出测量，提示随之消失；换成测面后提示跟着换
    await button(wrapper, '测距').trigger('click');
    expect(overlayItems(wrapper)).toStrictEqual([]);
    await button(wrapper, '测面').trigger('click');
    map.mouse('mousemove', 10, 20);
    await nextTick();
    expect(overlayItems(wrapper)).toStrictEqual([{ text: '单击开始测面', x: 10, y: 20 }]);
  });

  it('测量的结果标签：总长在末点旁边，总面积在形心正中（jsdom 里画布宽度是 0，节点旁的都在右边）', async () => {
    const { wrapper, maps } = mountPage();
    const map = maps[0];
    if (!map) {
      throw new Error('没有创建地图');
    }
    map.fire('style.load');
    await settle();

    await button(wrapper, '测距').trigger('click');
    drawLine(map);
    await button(wrapper, '测面').trigger('click');
    map.mouse('click', 0, 0);
    map.mouse('click', 100, 0);
    map.mouse('click', 100, 100);
    map.mouse('click', 100, 100, 2);
    map.mouse('dblclick', 100, 100, 2);
    await nextTick();

    const labels = wrapper.findAll('[data-measure-overlay] [data-side]');
    expect(labels.map(label => [label.text().split(' ')[0], label.attributes('data-side')])).toStrictEqual([
      ['总长', 'right'],
      ['总面积', 'centered']
    ]);
  });

  it('选中区划后地图上方显示可点击的各级，点"江苏省"或"回到全省"清除选择；没选时不显示', async () => {
    stubBoundaryFetch();
    const { wrapper } = await readyPage();
    expect(wrapper.find('[data-region-scope]').exists()).toBe(false);

    const chooseNanjing = async () => {
      await button(wrapper, '区划定位').trigger('click');
      await button(wrapper, '南京').trigger('click');
      await button(wrapper, '区划定位').trigger('click');
    };
    await chooseNanjing();
    // 和区划定位面板一样的各级："江苏省"可以点，南京市是当前位置
    expect(wrapper.get('[data-region-scope]').text()).toBe('江苏省›南京市回到全省');
    await wrapper.get('[data-region-scope] nav button').trigger('click');
    expect(wrapper.find('[data-region-scope]').exists()).toBe(false);

    await chooseNanjing();
    await button(wrapper, '回到全省').trigger('click');
    expect(wrapper.find('[data-region-scope]').exists()).toBe(false);
  });

  it('业务组始终只显示图标、底图在基础组下方；手机宽度资源面板展开时不显示区划条', async () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    stubBoundaryFetch();
    const { wrapper } = await readyPage();
    expect(wrapper.get('[data-map-page]').attributes('data-map-page')).toBe('wide');
    expect(wrapper.get('button[aria-label="测距"]').text()).toBe('');

    await resizePage(wrapper, 375, 737);
    expect(wrapper.get('[data-map-page]').attributes('data-map-page')).toBe('phone');
    // 卡片和基础组在同一列里
    const stack = wrapper.get('[data-map-cards]').element.parentElement;
    expect(stack?.contains(wrapper.get('button[aria-label="默认视角"]').element)).toBe(true);
    expect(wrapper.get('button[aria-label="测距"]').text()).toBe('');

    // 选中南京：资源面板展开着，中间一列没有宽度，区划条不显示；收起资源面板后显示
    await button(wrapper, '区划定位').trigger('click');
    await button(wrapper, '南京').trigger('click');
    expect(wrapper.find('[data-region-scope]').exists()).toBe(false);
    await wrapper.get('button[aria-label="收起资源图层"]').trigger('click');
    expect(wrapper.get('[data-region-scope]').text()).toBe('江苏省›南京市回到全省');

    // 变宽后底图入口仍在基础组下面，不占状态栏一行
    await resizePage(wrapper, 1440, 900);
    const bottomRow = wrapper.get('[data-map-status-bar]').element.parentElement;
    expect(bottomRow?.contains(wrapper.get('[data-map-cards]').element)).toBe(false);
    expect(wrapper.get('[data-map-cards]').element.parentElement?.contains(
      wrapper.get('button[aria-label="默认视角"]').element
    )).toBe(true);
  });

  it('画布重建时测量的标签先隐藏，新视图就绪后重新显示', async () => {
    const { wrapper, maps, canvasKey } = mountPage();
    const first = maps[0];
    if (!first) {
      throw new Error('没有创建地图');
    }
    first.fire('style.load');
    await settle();
    await button(wrapper, '测距').trigger('click');
    drawLine(first);
    await nextTick();
    const labels = overlayItems(wrapper);
    expect(labels.map(({ text }) => text.startsWith('总长'))).toStrictEqual([true]);

    canvasKey.value++;
    await nextTick();
    expect(overlayItems(wrapper)).toStrictEqual([]);

    const second = maps[1];
    if (!second) {
      throw new Error('画布没有重建');
    }
    second.fire('style.load');
    await settle();
    expect(overlayItems(wrapper)).toStrictEqual(labels);
  });

  it('区划定位：工具栏开关面板；选中南京后高亮叠在边界之上并定位，再点回到全省和默认视角；关面板不清选择', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() => Promise.resolve(new Response(cityFile)))
    );
    const { wrapper, maps } = mountPage();
    const map = maps[0];
    if (!map) {
      throw new Error('没有创建地图');
    }
    map.fire('style.load');
    await settle();

    await button(wrapper, '区划定位').trigger('click');
    expect(button(wrapper, '区划定位').attributes('aria-pressed')).toBe('true');
    await button(wrapper, '南京').trigger('click');
    await settle();

    expect(addedLayersOf(map, 'region')).toStrictEqual([
      ['region-line', undefined],
      ['region-glow', 'region-line']
    ]);
    expect(map.fitBoundsCalls).toEqual([jiangsu, [118.357927, 31.230207, 119.236382, 32.616407]]);

    // 用面板上的关闭按钮和工具栏各关一次，选择都保留
    await wrapper.get('[aria-label="关闭区划定位"]').trigger('click');
    expect(wrapper.find('[data-region-locate-panel]').exists()).toBe(false);
    expect(button(wrapper, '区划定位').attributes('aria-pressed')).toBe('false');
    expect(map.geojson.has('region')).toBe(true);
    await button(wrapper, '区划定位').trigger('click');
    await button(wrapper, '区划定位').trigger('click');
    expect(wrapper.find('[data-region-locate-panel]').exists()).toBe(false);
    expect(map.geojson.has('region')).toBe(true);

    await button(wrapper, '区划定位').trigger('click');
    await button(wrapper, '南京').trigger('click');
    expect(map.geojson.has('region')).toBe(false);
    expect(map.fitBoundsCalls).toEqual([jiangsu, [118.357927, 31.230207, 119.236382, 32.616407], jiangsu]);
  });

  it('区划定位和坐标定位是功能面板的两个 Tab：切走的隐藏、取消拾取、输入保留；再点正在显示的入口关闭它', async () => {
    const { wrapper } = await readyPage();

    await button(wrapper, '坐标定位').trigger('click');
    await wrapper.get('input[aria-label="经度"]').setValue('118.5');
    await button(wrapper, '拾取').trigger('click');
    expect(button(wrapper, '拾取').attributes('aria-pressed')).toBe('true');
    await button(wrapper, '区划定位').trigger('click');

    expect(shownPanels(wrapper)).toStrictEqual(['region-locate']);
    expect(wrapper.find('[data-coordinate-locate-panel]').exists()).toBe(true);
    expect(button(wrapper, '拾取').attributes('aria-pressed')).toBe('false');
    expect((wrapper.get('input[aria-label="经度"]').element as HTMLInputElement).value).toBe('118.5');
    expect(button(wrapper, '坐标定位').attributes('aria-pressed')).toBe('false');
    expect(button(wrapper, '区划定位').attributes('aria-pressed')).toBe('true');

    // 点 Tab 切回；再点正在显示的入口关闭它，切到最近显示过的另一个
    const coordinateTab = wrapper.get('[aria-label="已打开的地图工具"] [aria-selected="false"]');
    expect(coordinateTab.text()).toBe('坐标定位');
    await coordinateTab.trigger('click');
    expect(shownPanels(wrapper)).toStrictEqual(['coordinate-locate']);
    await button(wrapper, '坐标定位').trigger('click');
    expect(wrapper.find('[data-coordinate-locate-panel]').exists()).toBe(false);
    expect(shownPanels(wrapper)).toStrictEqual(['region-locate']);
  });

  it('窄屏时右边让给了资源面板：再点坐标定位、图例是重新显示，输入保留；让出去时入口不显示为按下（2026-10-16 评审发现）', async () => {
    // jsdom 没有 matchMedia，模拟一个始终是窄屏的版本
    vi.stubGlobal('matchMedia', (media: string) => ({
      media,
      matches: true,
      addEventListener: () => undefined,
      removeEventListener: () => undefined
    }));
    const { wrapper } = await readyPage();
    const functionGroup = wrapper.get<HTMLElement>('[data-panel-group]');
    const shown = (group: typeof functionGroup) => group.element.style.display !== 'none';

    await button(wrapper, '坐标定位').trigger('click');
    await wrapper.get('input[aria-label="经度"]').setValue('118.5');
    await button(wrapper, '图例').trigger('click');
    expect(shown(functionGroup)).toBe(true);

    // 展开资源面板：右边整个让出去，打开的功能保留
    await button(wrapper, '展开资源图层').trigger('click');
    expect(shown(functionGroup)).toBe(false);
    expect(button(wrapper, '坐标定位').attributes('aria-pressed')).toBe('false');
    expect(button(wrapper, '图例').attributes('aria-pressed')).toBe('false');

    await button(wrapper, '坐标定位').trigger('click');
    expect(shown(functionGroup)).toBe(true);
    expect(shownPanels(wrapper)).toContain('coordinate-locate');
    expect((wrapper.get('input[aria-label="经度"]').element as HTMLInputElement).value).toBe('118.5');
    expect(button(wrapper, '坐标定位').attributes('aria-pressed')).toBe('true');
    expect(wrapper.find('button[aria-label="展开资源图层"]').exists()).toBe(true);

    // 图例同样：让出去以后再点是重新显示
    await button(wrapper, '展开资源图层').trigger('click');
    await button(wrapper, '图例').trigger('click');
    expect(shown(functionGroup)).toBe(true);
    expect(shownPanels(wrapper)).toContain('legend');

    // 显示着时再点才关闭
    await button(wrapper, '坐标定位').trigger('click');
    await button(wrapper, '坐标定位').trigger('click');
    expect(wrapper.find('[data-coordinate-locate-panel]').exists()).toBe(false);
  });

  it('输入坐标定位：规范写法，放下图钉并飞过去；单击图钉看位置信息，两种格式和所在区划', async () => {
    stubBoundaryFetch();
    const { wrapper, map } = await readyPage();
    await button(wrapper, '坐标定位').trigger('click');

    await wrapper.get('input[aria-label="经度"]').setValue('118.79786');
    await wrapper.get('input[aria-label="纬度"]').setValue('32.04864');
    expect(wrapper.text()).toContain('= 118°47′52.30″');
    await wrapper.get('input[aria-label="纬度"]').trigger('keydown', { key: 'Enter' });

    expect(valueOf(wrapper, '经度')).toBe('118°47′52.30″');
    expect(valueOf(wrapper, '纬度')).toBe('32°02′55.10″');
    expect(map.flyToCalls.at(-1)).toMatchObject({ center: [118.79786, 32.04864], zoom: 14 });
    // 飞过去之后点在相机中心，也就是画布左上角
    expect(pin(wrapper).attributes('style')).toContain('left: 0px; top: 0px;');

    await pointer(wrapper, 'pointerdown');
    await pointer(wrapper, 'pointerup');
    await settle();
    await settle();
    const info = wrapper.get('[data-location-info]').text();
    expect(info).toContain('118.797860, 32.048640');
    expect(info).toContain('118°47′52.30″E, 32°02′55.10″N');
    expect(info).toContain('南京市 / 玄武区');
  });

  it('拾取：按钮显示为按下，鼠标旁有提示；单击一次放下图钉、打开位置信息、填入输入框并退出拾取', async () => {
    stubBoundaryFetch();
    const { wrapper, map } = await readyPage();
    await button(wrapper, '坐标定位').trigger('click');
    const { lng, lat } = map.getCenter();

    await button(wrapper, '拾取').trigger('click');
    expect(button(wrapper, '拾取').attributes('aria-pressed')).toBe('true');
    map.mouse('mousemove', 30, 40);
    await nextTick();
    expect(wrapper.get('[data-location-overlay] [data-pointer-hint]').text()).toBe('单击地图拾取点位Esc 取消');
    map.mouse('click', 100, 50);
    await nextTick();

    expect(button(wrapper, '拾取').attributes('aria-pressed')).toBe('false');
    expect(pin(wrapper).attributes('style')).toContain('left: 100px; top: 50px;');
    expect(wrapper.find('[data-location-info]').exists()).toBe(true);
    expect(wrapper.find('[data-location-overlay] [data-pointer-hint]').exists()).toBe(false);
    expect(valueOf(wrapper, '经度')).toBe(formatCoordinate(lng + 1, 'dms'));
    expect(valueOf(wrapper, '纬度')).toBe(formatCoordinate(lat - 0.5, 'dms'));
  });

  it('长按 0.5 秒拖动图钉，输入框跟着变；拖动中按 Esc 回到原位；关闭面板时取消拾取', async () => {
    stubBoundaryFetch();
    const { wrapper, map } = await readyPage();
    await button(wrapper, '坐标定位').trigger('click');
    await button(wrapper, '拾取').trigger('click');
    map.mouse('click', 100, 50);
    await nextTick();
    const picked = valueOf(wrapper, '经度');
    vi.useFakeTimers();

    await pointer(wrapper, 'pointerdown', 100, 50);
    vi.advanceTimersByTime(500);
    await pointer(wrapper, 'pointermove', 200, 50);
    await pointer(wrapper, 'pointerup', 200, 50);
    expect(pin(wrapper).attributes('style')).toContain('left: 200px; top: 50px;');
    const dragged = valueOf(wrapper, '经度');
    expect(dragged).not.toBe(picked);

    await pointer(wrapper, 'pointerdown', 200, 50);
    vi.advanceTimersByTime(500);
    await pointer(wrapper, 'pointermove', 300, 80);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await nextTick();
    expect(pin(wrapper).attributes('style')).toContain('left: 200px; top: 50px;');
    expect(valueOf(wrapper, '经度')).toBe(dragged);

    // 拾取中关闭面板：拾取被取消，之后的单击不再放点
    await button(wrapper, '拾取').trigger('click');
    await wrapper.get('[aria-label="关闭坐标定位"]').trigger('click');
    map.mouse('click', 10, 10);
    await nextTick();
    expect(pin(wrapper).attributes('style')).toContain('left: 200px; top: 50px;');
  });

  describe('页面被缓存（ADR 0063）', () => {
    it('拖动图钉时切走：回来后图钉回到拖动前的位置', async () => {
      stubBoundaryFetch();
      const { wrapper, map, pageShown } = await readyCachedPage();
      await button(wrapper, '坐标定位').trigger('click');
      await button(wrapper, '拾取').trigger('click');
      map.mouse('click', 100, 50);
      await nextTick();
      vi.useFakeTimers();
      await pointer(wrapper, 'pointerdown', 100, 50);
      vi.advanceTimersByTime(500);
      await pointer(wrapper, 'pointermove', 300, 80);

      // 停用期间视图暂停、图钉不显示，看不出是停用时还是回来时取消的，只检查回来以后
      pageShown.value = false;
      await nextTick();
      pageShown.value = true;
      await nextTick();

      expect(pin(wrapper).attributes('style')).toContain('left: 100px; top: 50px;');
      // 拖动已经结束：之后的移动不再拖着图钉
      await pointer(wrapper, 'pointermove', 250, 90);
      expect(pin(wrapper).attributes('style')).toContain('left: 100px; top: 50px;');
    });

    it('区划边界还在加载时切走：停用期间不定位，回来后再定位到区划；页面和地图都不重建', async () => {
      const boundaries = deferBoundaryFetch();
      // 边界文件在模块里只下载一次：用新的模块，别的用例下载过的不算
      const { wrapper, map, maps, pageShown } = await readyCachedPage(await freshModules());
      await button(wrapper, '区划定位').trigger('click');
      await button(wrapper, '南京').trigger('click');

      pageShown.value = false;
      await nextTick();
      boundaries.release('city');
      await settle();
      expect(map.fitBoundsCalls).toEqual([jiangsu]);
      pageShown.value = true;
      await nextTick();

      expect(map.fitBoundsCalls).toEqual([jiangsu, NANJING]);
      expect(maps).toHaveLength(1);
      expect(wrapper.find('[data-region-locate-panel]').exists()).toBe(true);
    });
  });

  it('测量时图钉不响应鼠标；"清除"连同位置点一起清掉', async () => {
    stubBoundaryFetch();
    const { wrapper, map } = await readyPage();
    await button(wrapper, '坐标定位').trigger('click');
    await button(wrapper, '拾取').trigger('click');
    map.mouse('click', 100, 50);
    await nextTick();

    await button(wrapper, '测距').trigger('click');
    expect(pin(wrapper).classes().some(name => name.includes('inert'))).toBe(true);
    await button(wrapper, '测距').trigger('click');
    expect(pin(wrapper).classes().some(name => name.includes('inert'))).toBe(false);

    await button(wrapper, '清除测量与定位标记').trigger('click');
    expect(wrapper.find('[aria-label="坐标定位点"]').exists()).toBe(false);
  });

  it('图钉随相机移动；单击开关位置信息，右键不算；画布重建时先隐藏，就绪后重新显示', async () => {
    stubBoundaryFetch();
    const { wrapper, map, maps, canvasKey } = await readyPage();
    await button(wrapper, '坐标定位').trigger('click');
    await button(wrapper, '拾取').trigger('click');
    map.mouse('click', 100, 50);
    await nextTick();
    expect(wrapper.find('[data-location-info]').exists()).toBe(true);

    await pointer(wrapper, 'pointerdown');
    await pointer(wrapper, 'pointerup');
    expect(wrapper.find('[data-location-info]').exists()).toBe(false);
    await pointer(wrapper, 'pointerdown', 0, 0, 2);
    await pointer(wrapper, 'pointerup', 0, 0, 2);
    expect(wrapper.find('[data-location-info]').exists()).toBe(false);

    const { lng, lat } = map.getCenter();
    map.drag(lng + 0.5, lat);
    await nextTick();
    expect(pin(wrapper).attributes('style')).toContain('left: 50px; top: 50px;');

    canvasKey.value++;
    await nextTick();
    expect(wrapper.find('[aria-label="坐标定位点"]').exists()).toBe(false);
    maps[1]?.fire('style.load');
    await settle();
    expect(wrapper.find('[aria-label="坐标定位点"]').exists()).toBe(true);
  });

  it('拖动时把视口坐标换成画布上的位置', async () => {
    stubBoundaryFetch();
    const { wrapper, map } = await readyPage();
    await button(wrapper, '坐标定位').trigger('click');
    await button(wrapper, '拾取').trigger('click');
    map.mouse('click', 100, 50);
    await nextTick();
    // 画布不在视口左上角：左边 10、上边 20
    vi.spyOn(wrapper.get('[data-location-overlay]').element, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ x: 10, y: 20, width: 800, height: 600 })
    );
    vi.useFakeTimers();

    await pointer(wrapper, 'pointerdown', 110, 70);
    vi.advanceTimersByTime(500);
    await pointer(wrapper, 'pointermove', 210, 120);
    await pointer(wrapper, 'pointerup', 210, 120);

    expect(pin(wrapper).attributes('style')).toContain('left: 200px; top: 100px;');
  });

  it('资源目录加载后：默认勾选的地类图斑插在注记下面；在列表里勾上别的资源就加到地图上，新加的在最上面（ADR 0157）', async () => {
    const { wrapper, map } = await readyPage();
    await vi.waitFor(() => expect(map.addedLayers.map(([id]) => id)).toContain('resources-bgdc_dltb'));

    expect(map.addedLayers).toContainEqual(['resources-bgdc_dltb', 'basemap-labels-vector']);
    // 没有资源的分类不显示
    expect(wrapper.text()).toContain('土地资源');
    expect(wrapper.text()).not.toContain('海洋资源');
    expect(wrapper.text()).not.toContain('公共库');
    await resourceRow(wrapper, 'csxhjctb_hydl').get('[data-node-action="add"]').trigger('click');
    await settle();
    expect(map.addedLayers).toContainEqual(['resources-csxhjctb_hydl', 'basemap-labels-vector']);
  });

  it('请求状态（ADR 0158）：瓦片加载超过 0.4 秒时状态栏右边出现条目、行内转圈；点开明细、点一行在当前图层里选中；都到了以后已加载完成', async () => {
    const { wrapper, map } = await readyPage();
    await vi.waitFor(() => expect(map.addedLayers.map(([id]) => id)).toContain('resources-bgdc_dltb'));
    map.fire('dataloading', parcelTile('1'));
    map.fire('dataloading', parcelTile('2'));
    map.fire('sourcedata', parcelTile('1'));
    await settle();
    expect(wrapper.find('[data-request-chip]').exists()).toBe(false);

    await vi.waitFor(() => expect(wrapper.find('[data-request-chip]').exists()).toBe(true), { timeout: 3000 });
    expect(wrapper.get('[data-request-chip]').text()).toBe('正在加载 1 项 · 50%');
    expect(layerRow(wrapper, 'bgdc_dltb').find('[aria-label="加载中"]').exists()).toBe(true);

    await wrapper.get('[data-request-chip]').trigger('click');
    await wrapper.get('[data-request-row="resource:bgdc_dltb"]').trigger('click');
    await nextTick();
    expect(layerRow(wrapper, 'bgdc_dltb').attributes('aria-selected')).toBe('true');

    map.fire('sourcedata', parcelTile('2'));
    await vi.waitFor(() => expect(wrapper.get('[data-request-chip]').text()).toBe('已加载完成'));
    expect(layerRow(wrapper, 'bgdc_dltb').find('[aria-label="加载中"]').exists()).toBe(false);
  });

  it('平移和同一级内缩放不更新当前图层的列表，跨过最小级别才更新提示', async () => {
    const { wrapper, map, updates } = await readyPage();
    await vi.waitFor(() => resourceRow(wrapper, 'csxhjctb_lrdl'));
    await resourceRow(wrapper, 'csxhjctb_lrdl').get('[data-node-action="add"]').trigger('click');
    map.moveTo([119, 32], 8, {});
    await settle();
    updates.clear();

    for (let index = 0; index < 10; index++) {
      map.moveTo([119 + index / 100, 32], 8 + index / 10, {});
      // oxlint-disable-next-line no-await-in-loop -- 每次相机变化后让 Vue 完成更新，不能合并成一帧
      await nextTick();
    }
    expect(updates.get('CurrentLayerGroup') ?? 0).toBe(0);
    map.moveTo([119, 32], 9 - 1e-7, {});
    await nextTick();
    expect(layerRow(wrapper, 'csxhjctb_lrdl').find('[data-status="minzoom"]').exists()).toBe(true);
    expect(updates.get('CurrentLayerGroup') ?? 0).toBe(0);

    map.moveTo([119, 32], 9, {});
    await nextTick();
    expect(layerRow(wrapper, 'csxhjctb_lrdl').find('[data-status="minzoom"]').exists()).toBe(false);
    expect(updates.get('CurrentLayerGroup')).toBe(1);
  });

  it('勾选了但级别不够的资源在状态图标里提示放大到几级；瓦片加载失败标在对应资源的图标上（ADR 0059）', async () => {
    const { wrapper, map } = await readyPage();
    await vi.waitFor(() => resourceRow(wrapper, 'csxhjctb_lrdl'));
    expect(wrapper.find('[data-current-row="resource:csxhjctb_lrdl"]').exists()).toBe(false);

    await resourceRow(wrapper, 'csxhjctb_lrdl').get('[data-node-action="add"]').trigger('click');
    expect(layerRow(wrapper, 'csxhjctb_lrdl').get('[role="img"]').attributes('aria-label')).toBe('放大至第 9 级显示');
    // 数据源的错误照样上报（默认打印到控制台）
    using consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const tileError = new Error('Unable to parse the tile');
    map.fire('error', { error: tileError, sourceId: 'resources-bgdc_dltb' });
    await nextTick();
    // 图标是更严重的瓦片加载失败，名称下面不再多一行
    const dltb = layerRow(wrapper, 'bgdc_dltb').get('[role="img"]');
    expect(dltb.attributes('data-status')).toBe('tile-error');
    expect(dltb.attributes('aria-label')).toBe('有瓦片加载失败');
    expect(layerRow(wrapper, 'bgdc_dltb').text()).not.toContain('瓦片');
    expect(consoleError).toHaveBeenCalledWith('[map-vue]', tileError);

    // 级别不够的资源又有瓦片加载失败：图标换成更严重的，提示里两条都在
    map.fire('error', { error: tileError, sourceId: 'resources-csxhjctb_lrdl' });
    await nextTick();
    const lrdl = layerRow(wrapper, 'csxhjctb_lrdl').get('[role="img"]');
    expect(lrdl.attributes('data-status')).toBe('tile-error');
    expect(lrdl.attributes('aria-label')).toBe('有瓦片加载失败；放大至第 9 级显示');

    map.moveTo([118.8, 32.05], 9, { originalEvent: new MouseEvent('wheel') });
    await nextTick();
    expect(layerRow(wrapper, 'csxhjctb_lrdl').get('[role="img"]').attributes('aria-label')).toBe('有瓦片加载失败');
  });

  it('点选：14 级起点中地类图斑直接出详情，高亮插在注记下面；离开点选工具时清除', async () => {
    const guid = 'a'.repeat(32);
    const square: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [119, 32],
          [119.01, 32],
          [119.01, 32.01],
          [119, 32]
        ]
      ]
    };
    server.use(
      mock.get('/backend/api/query/attr/page', () =>
        HttpResponse.json({ total: 1, list: [{ guid, DLMC: '水田', BSM: '320' }] })
      ),
      mock.get('/backend/api/query/scope/geojson', () => HttpResponse.json([{ guid, geom: JSON.stringify(square) }]))
    );
    const { wrapper, map } = await readyPage();
    await vi.waitFor(() => expect(addedLayersOf(map, 'resources')).not.toStrictEqual([]));
    const layer = { id: 'resources-bgdc_dltb' };
    map.renderedFeatures = [{ source: layer.id, layer, properties: { guid, dlmc: '水田' }, geometry: square }];
    map.moveTo([119, 32], 15, {});

    await button(wrapper, '点/框选').trigger('click');
    map.mouse('click', 200, 150);
    await nextTick();

    expect(wrapper.find('[data-feature-detail-panel]').exists()).toBe(true);
    expect(wrapper.get('[data-feature-detail-panel] h3').text()).toBe('水田');
    expect(wrapper.get('[data-feature-detail-panel]').text()).toContain('地类图斑 · 2022');
    await vi.waitFor(() => expect(wrapper.get('[data-feature-detail-panel]').text()).toContain('地类名称'));
    await vi.waitFor(() => expect(addedLayersOf(map, 'selection')).toHaveLength(3));
    const [[, beforeId] = []] = addedLayersOf(map, 'selection');
    expect(beforeId?.startsWith('basemap-labels')).toBe(true);
    expect(map.fitBoundsCalls).toHaveLength(1);

    await button(wrapper, '移动').trigger('click');
    expect(wrapper.find('[data-feature-detail-panel]').exists()).toBe(false);
  });

  it('点框选的提示和草稿更新不带动页面、工具栏或资源面板重渲染', async () => {
    const { wrapper, map, updates } = await readyPage();
    await vi.waitFor(() => resourceRow(wrapper, 'bgdc_cjdcq'));
    await button(wrapper, '点/框选').trigger('click');
    await settle();
    updates.clear();
    for (let index = 0; index < 10; index++) {
      map.mouse('mousemove', 30 + index, 40);
      // oxlint-disable-next-line no-await-in-loop -- 指针每帧写入一次，逐帧检查独立更新
      await new Promise(resolve => requestAnimationFrame(resolve));
      // oxlint-disable-next-line no-await-in-loop -- 等这一帧的 Vue 更新结束再发下一次输入
      await nextTick();
    }
    expect(wrapper.find('[data-box-select-overlay] [data-pointer-hint]').exists()).toBe(true);
    expect(updates.get('BoxSelectOverlay')).toBeGreaterThan(0);
    for (const name of ['CurrentMapPage', 'MapToolbar', 'CurrentMapLayerPanel']) {
      expect(updates.get(name) ?? 0).toBe(0);
    }

    map.mouse('mousedown', 100, 100);
    await nextTick();
    updates.clear();
    map.mouse('mousemove', 200, 160);
    await nextTick();
    const box = wrapper.get('[data-box-select-overlay] [data-box]').element as HTMLElement;
    expect([box.style.width, box.style.height]).toStrictEqual(['100px', '60px']);
    expect(updates.get('BoxSelectOverlay')).toBeGreaterThan(0);
    for (const name of ['CurrentMapPage', 'MapToolbar', 'CurrentMapLayerPanel']) {
      expect(updates.get(name) ?? 0).toBe(0);
    }
  });

  it('点/框选：鼠标旁有提示，第一次单击识别后不再显示，下次进入时再显示（ADR 0056 第 4 节）', async () => {
    const { wrapper, map } = await readyPage();
    const hint = () => wrapper.find('[data-box-select-overlay] [data-pointer-hint]');

    await button(wrapper, '点/框选').trigger('click');
    // 鼠标的位置在下一帧写入
    map.mouse('mousemove', 30, 40);
    await new Promise(resolve => requestAnimationFrame(resolve));
    await nextTick();
    expect(hint().text()).toBe('单击查看要素，拖动框选按住 Ctrl 拖动地图，Esc 取消或清除结果');

    map.mouse('click', 30, 40);
    await nextTick();
    expect(hint().exists()).toBe(false);

    await button(wrapper, '移动').trigger('click');
    await button(wrapper, '点/框选').trigger('click');
    expect(hint().exists()).toBe(true);
  });

  it('资源详情独立展示：识别不切走功能标签，收起保留结果，统一关闭功能不影响详情', async () => {
    const guid = 'a'.repeat(32);
    const square: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [119, 32],
          [119.01, 32],
          [119.01, 32.01],
          [119, 32]
        ]
      ]
    };
    server.use(
      mock.get('/backend/api/query/attr/page', () =>
        HttpResponse.json({ total: 1, list: [{ guid, DLMC: '水田', BSM: '320' }] })
      ),
      mock.get('/backend/api/query/scope/geojson', () => HttpResponse.json([{ guid, geom: JSON.stringify(square) }]))
    );
    const { wrapper, map } = await readyPage();
    await vi.waitFor(() => expect(addedLayersOf(map, 'resources')).not.toStrictEqual([]));
    const layer = { id: 'resources-bgdc_dltb' };
    map.renderedFeatures = [{ source: layer.id, layer, properties: { guid, dlmc: '水田' }, geometry: square }];
    map.moveTo([119, 32], 15, {});
    await button(wrapper, '点/框选').trigger('click');
    map.mouse('click', 200, 150);
    await nextTick();
    expect(shownPanels(wrapper)).toStrictEqual([]);
    expect(wrapper.find('[data-feature-detail-window]').exists()).toBe(true);
    await vi.waitFor(() => expect(addedLayersOf(map, 'selection')).toHaveLength(3));

    await button(wrapper, '区划定位').trigger('click');
    expect(shownPanels(wrapper)).toStrictEqual(['region-locate']);
    expect(wrapper.get('[data-feature-detail-panel] h3').text()).toBe('水田');
    expect(map.geojson.has('selection')).toBe(true);

    map.mouse('click', 200, 150);
    await nextTick();
    expect(shownPanels(wrapper)).toStrictEqual(['region-locate']);

    await button(wrapper, '收起资源详情').trigger('click');
    expect(wrapper.get('[data-feature-detail-panel] h3').text()).toBe('水田');
    expect(map.geojson.has('selection')).toBe(true);
    await button(wrapper, '展开资源详情').trigger('click');
    await button(wrapper, '关闭区划定位').trigger('click');
    expect(wrapper.find('[data-feature-detail-window]').exists()).toBe(true);
    expect(map.geojson.has('selection')).toBe(true);

    await wrapper.get('[aria-label="关闭资源详情"]').trigger('click');
    expect(wrapper.find('[data-feature-detail-panel]').exists()).toBe(false);
    expect(shownPanels(wrapper)).toStrictEqual([]);
    expect(map.geojson.has('selection')).toBe(false);
  });

  it('区划裁剪：选中南京后，点在遮罩上不识别、关闭结果，点在南京里照常（ADR 0051）', async () => {
    stubBoundaryFetch();
    const { wrapper, map } = await readyPage();
    await vi.waitFor(() => expect(addedLayersOf(map, 'resources')).not.toStrictEqual([]));
    await button(wrapper, '区划定位').trigger('click');
    await button(wrapper, '南京').trigger('click');
    await vi.waitFor(() => expect(map.geojson.has('region-clip')).toBe(true));
    const layer = { id: 'resources-bgdc_dltb' };
    // 南京城里的两个地类图斑
    const geometry: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [118.77, 32.03],
          [118.79, 32.03],
          [118.79, 32.05],
          [118.77, 32.03]
        ]
      ]
    };
    map.renderedFeatures = ['a', 'b'].map(letter => ({
      source: layer.id,
      layer,
      properties: { guid: letter.repeat(32), dlmc: '水田' },
      geometry
    }));
    map.moveTo([118.785, 32.035], 15, {});
    await button(wrapper, '点/框选').trigger('click');

    map.mouse('click', 0, 0);
    await nextTick();
    expect(wrapper.find('[data-feature-detail-panel]').exists()).toBe(true);

    // 画布左上角是相机中心，往右 100 像素是 119.785，在南京外面
    map.mouse('click', 100, 0);
    await nextTick();
    expect(wrapper.find('[data-feature-detail-panel]').exists()).toBe(false);
  });

  it('框选：拖动时显示矩形，松手列出框里的地类图斑并在瓦片上批量高亮；这次手势派生的单击不识别', async () => {
    const { wrapper, map } = await readyPage();
    await vi.waitFor(() => expect(addedLayersOf(map, 'resources')).not.toStrictEqual([]));
    const layer = { id: 'resources-bgdc_dltb' };
    const geometry: Polygon = { type: 'Polygon', coordinates: [[[119, 32], [119.01, 32], [119.01, 32.01], [119, 32]]] };
    map.renderedFeatures = ['a', 'b'].map(letter => ({
      source: layer.id,
      layer,
      properties: { guid: letter.repeat(32), dlmc: '水田' },
      geometry
    }));
    map.moveTo([119, 32], 15, {});
    await button(wrapper, '点/框选').trigger('click');

    map.mouse('mousedown', 100, 100);
    map.mouse('mousemove', 200, 160);
    await nextTick();
    expect(wrapper.find('[data-box-select-overlay] [data-box]').exists()).toBe(true);
    const box = wrapper.get('[data-box-select-overlay] [data-box]').element as HTMLElement;
    expect([box.style.left, box.style.top, box.style.width, box.style.height]).toStrictEqual([
      '100px',
      '100px',
      '100px',
      '60px'
    ]);

    map.mouse('mouseup', 200, 160);
    map.mouse('click', 200, 160);
    await nextTick();

    expect(wrapper.find('[data-box-select-overlay] [data-box]').exists()).toBe(false);
    expect(wrapper.find('[data-feature-detail-panel]').exists()).toBe(true);
    expect(wrapper.get('[data-feature-detail-panel]').text()).toContain('框选 · 地类图斑');
    expect(wrapper.get('[data-feature-detail-panel]').text()).toContain('地图上已画出的 2 个');
    // 每次 addLayer 带着插在谁前面，调用的先后不是叠放的顺序，这里只看加了哪些
    await vi.waitFor(() =>
      expect(addedLayersOf(map, 'selection').map(([id]) => id).toSorted()).toStrictEqual([
        'selection-batch-circle',
        'selection-batch-fill',
        'selection-batch-line'
      ])
    );

    // 从列表进入一个要素的详情，可以返回列表
    server.use(
      mock.get('/backend/api/query/attr/page', () => HttpResponse.json({ total: 1, list: [{ guid: 'a'.repeat(32) }] })),
      mock.get('/backend/api/query/scope/geojson', () =>
        HttpResponse.json([{ guid: 'a'.repeat(32), geom: JSON.stringify(geometry) }])
      )
    );
    await wrapper.get('[data-feature-detail-panel] li button').trigger('click');
    expect(wrapper.get('[data-feature-detail-panel]').text()).toContain('返回列表');
  });

  describe('三维模型（ADR 0081）', () => {
    // 三维视图按渲染器给出的包围球算出建议的相机；jsdom 里画布的高度是 0
    const MODEL_CAMERA = tilesetCamera(MODEL_SPHERE, 0);

    it('二三维共用资源图层面板（ADR 0157）：进页面就读模型清单，模型在目录最后；切换时面板不换，搜索词、收起都还在', async () => {
      const requests = mockManifest();
      const { wrapper } = await readyPage();
      await vi.waitFor(() => expect(wrapper.find('[data-catalog-node="model-root"]').exists()).toBe(true));
      expect(requests()).toBe(1);
      await wrapper.get('input[placeholder="搜索资源"]').setValue('苏州');

      await switchTo(wrapper, '三维');
      expect(wrapper.find('[data-layer-panel]').exists()).toBe(true);
      expect(wrapper.get<HTMLInputElement>('input[placeholder="搜索资源"]').element.value).toBe('苏州');
      await button(wrapper, '收起资源图层').trigger('click');
      await switchTo(wrapper, '二维');
      expect(wrapper.find('button[aria-label="展开资源图层"]').exists()).toBe(true);
      expect(requests()).toBe(1);
    });

    it('二维里加入的模型只进列表："三维模型"组标"仅三维"、不交给三维视图；切到三维才加载', async () => {
      mockManifest();
      const page = await readyPage();
      const { wrapper } = page;
      await addModel(wrapper, 'sz-station');
      const group = wrapper.get('[data-current-group="models"]');
      expect(group.text()).toContain('仅三维');
      expect(wrapper.get('[data-tool="locate"]').attributes('aria-disabled')).toBe('true');

      await switchTo(wrapper, '三维');
      expect(wrapper.get('[data-current-group="models"]').text()).not.toContain('仅三维');
      expect(sceneOf(page).session.scene.current.tilesets.map(({ id }) => id)).toStrictEqual(['sz-station']);
    });

    it('加入的模型交给三维视图；定位地下的模型只飞过去，没有单独的钻地（ADR 0097 第 5 节）', async () => {
      mockManifest();
      const page = await readyPage();
      const { wrapper } = page;
      await switchTo(wrapper, '三维');
      await addModel(wrapper, 'sz-station');
      const scene = sceneOf(page);
      expect(scene.session.scene.current.tilesets.map(({ id, lighting }) => [id, lighting])).toStrictEqual([
        ['sz-station', 'headlight']
      ]);

      await scene.ready('sz-station');
      await wrapper.get('[data-tool="locate"]').trigger('click');
      await settle();
      expect(page.map.flyToCalls.at(-1)).toMatchObject({
        center: MODEL_CAMERA.center,
        zoom: MODEL_CAMERA.zoom,
        pitch: MODEL_CAMERA.pitch
      });
      expect(scene.session.scene.current.underground).toBeNull();
      expect(wrapper.get('[data-current-row="model:sz-station"]').text()).not.toContain('钻地');
      expect(wrapper.find('button[aria-label="二维"]').exists()).toBe(true);
    });

    it('漫游地下的模型（ADR 0084、0095、0097）：在地下空间，隐藏工具栏、功能面板、底图、区划条、视图控件和状态栏，切回移动；退出漫游回到地面、原样显示', async () => {
      mockManifest();
      failNavigation();
      stubBoundaryFetch();
      const page = await readyPage();
      const { wrapper } = page;
      const labels = () => wrapper.findAll('button').map(item => item.attributes('aria-label') ?? item.text());
      // 进入前：选了南京，开着区划定位和图例（图例在前），底图浮层打开，正在测距
      await button(wrapper, '区划定位').trigger('click');
      await button(wrapper, '南京').trigger('click');
      await button(wrapper, '图例').trigger('click');
      await wrapper.get('[data-map-cards] button:last-child').trigger('click');
      await vi.waitFor(() => expect(optionsPopoverVisible('basemap')).toBe(true));
      await switchTo(wrapper, '三维');
      await addModel(wrapper, 'sz-station');
      const scene = sceneOf(page);
      await scene.ready('sz-station');
      await button(wrapper, '测距').trigger('click');
      expect(scene.session.tool.active).toBe('measure-distance');
      expect(shownPanels(wrapper)).toStrictEqual(['legend']);
      expect(wrapper.get('[data-region-scope]').text()).toBe('江苏省›南京市回到全省');

      await button(wrapper, '漫游').trigger('click');
      await settle();
      expect(scene.session.scene.current.underground).toStrictEqual({ tilesetId: 'sz-station', surfaceOpacity: 0.25 });
      expect(scene.session.tool.active).toBe('browse');
      expect(labels()).not.toContain('测距');
      for (const label of ['默认视角', '放大', '缩小', '二维', '三维']) {
        expect(labels()).not.toContain(label);
      }
      expect(wrapper.find('[data-map-status-bar]').exists()).toBe(false);
      expect(wrapper.find('[data-map-cards]').exists()).toBe(false);
      expect(wrapper.find('[data-region-scope]').exists()).toBe(false);
      expect(wrapper.get('[data-panel-group]').isVisible()).toBe(false);
      expect(optionsPopoverVisible('basemap')).toBe(false);

      await button(wrapper, '退出漫游').trigger('click');
      await settle();
      expect(scene.session.scene.current.underground).toBeNull();
      expect(button(wrapper, '移动').attributes('aria-pressed')).toBe('true');
      expect(labels()).toEqual(expect.arrayContaining(['默认视角', '放大', '缩小', '二维', '三维']));
      expect(wrapper.find('[data-map-status-bar]').exists()).toBe(true);
      expect(wrapper.get('[data-region-scope]').text()).toBe('江苏省›南京市回到全省');
      expect(wrapper.get('[data-panel-group]').isVisible()).toBe(true);
      expect(shownPanels(wrapper)).toStrictEqual(['legend']);
      await vi.waitFor(() => expect(optionsPopoverVisible('basemap')).toBe(true));
    });

    it('路线漫游（ADR 0083、0097）：在漫游面板上换成路线，空格开始、暂停；Esc、换成别的工具都退出；漫游期间没有二维的入口', async () => {
      mockManifest();
      failNavigation();
      const page = await readyPage();
      const { wrapper } = page;
      await switchTo(wrapper, '三维');
      await addModel(wrapper, 'sz-station');
      const scene = sceneOf(page);
      await scene.ready('sz-station');
      const start = () => startRoute(wrapper);

      // 正在测距时开始：开始漫游切回移动，漫游不因此退出（ADR 0084、0097）
      await button(wrapper, '测距').trigger('click');
      await start();
      expect(scene.session.tool.active).toBe('browse');
      expect(scene.session.scene.current.roam).toMatchObject({ kind: 'route', playing: false, speed: 4, run: 0 });
      expect(wrapper.find('[data-roam-panel]').exists()).toBe(true);
      await pressKey(' ');
      expect(scene.session.scene.current.roam).toMatchObject({ playing: true });
      await pressKey(' ');
      expect(scene.session.scene.current.roam).toMatchObject({ playing: false });
      await pressKey('Escape');
      expect(scene.session.scene.current.roam).toBeUndefined();
      expect(wrapper.find('[data-roam-panel]').exists()).toBe(false);

      // 漫游地下的模型时工具栏隐藏；当前工具换成移动以外的照样退出
      await start();
      expect(wrapper.find('button[aria-label="测距"]').exists()).toBe(false);
      scene.session.tool.activate('measure-distance');
      await settle();
      expect(scene.session.scene.current.roam).toBeUndefined();

      scene.session.tool.activate('browse');
      await start();
      expect(wrapper.find('button[aria-label="二维"]').exists()).toBe(false);
      // 退出漫游同时回到地面，马上能切回二维（ADR 0097 第 5 节）
      await pressKey('Escape');
      expect(scene.session.scene.current.underground).toBeNull();
      expect(wrapper.find('button[aria-label="二维"]').exists()).toBe(true);
    });

    it('页面被缓存期间（ADR 0063）：在别的页面按空格、Esc 不作用到漫游；回来以后照常', async () => {
      mockManifest();
      failNavigation();
      const page = await readyCachedPage();
      const { wrapper, pageShown } = page;
      await switchTo(wrapper, '三维');
      await addModel(wrapper, 'sz-station');
      const scene = sceneOf(page);
      await scene.ready('sz-station');
      await startRoute(wrapper);

      pageShown.value = false;
      await nextTick();
      await pressKey(' ');
      await pressKey('Escape');
      expect(scene.session.scene.current.roam).toMatchObject({ kind: 'route', playing: false });

      pageShown.value = true;
      await nextTick();
      await pressKey(' ');
      expect(scene.session.scene.current.roam).toMatchObject({ playing: true });
      await pressKey('Escape');
      expect(scene.session.scene.current.roam).toBeUndefined();
    });

    it('步行（ADR 0086、0097）：当前图层里点"漫游"从步行开始，分析站内空间失败时可以重试；Esc 退出，空格不拦截', async () => {
      mockManifest();
      const requests = failNavigation();
      const page = await readyPage();
      const { wrapper } = page;
      await switchTo(wrapper, '三维');
      await addModel(wrapper, 'sz-station');
      const scene = sceneOf(page);
      await scene.ready('sz-station');

      await button(wrapper, '漫游').trigger('click');
      await settle();
      expect(wrapper.get('[data-roam-panel]').text()).toContain('苏州站地下空间 · 室内');
      // 漫游期间工具栏隐藏
      expect(wrapper.find('button[aria-label="测距"]').exists()).toBe(false);
      await vi.waitFor(() => expect(wrapper.get('[data-roam-panel]').text()).toContain('站内空间分析失败，请重试'));
      expect(scene.session.scene.current.roam).toBeUndefined();
      await button(wrapper, '重试').trigger('click');
      await vi.waitFor(() => expect(requests()).toBe(2));

      const space = new KeyboardEvent('keydown', { key: ' ', cancelable: true });
      window.dispatchEvent(space);
      expect(space.defaultPrevented).toBe(false);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await settle();
      expect(wrapper.find('[data-roam-panel]').exists()).toBe(false);
    });

    it('漫游（ADR 0097）：左侧换成漫游面板，工具栏、功能面板、底图、视图控件和状态栏都隐藏，地面上的模型也一样；退出后原样显示，资源图层面板的搜索还在', async () => {
      server.use(
        mock.get('*/3dt/manifest.json', () =>
          HttpResponse.json({
            models: [
              {
                id: 'square',
                name: '广场',
                cityCode: '320500',
                kind: 'oblique',
                underground: false,
                tileset: 'Q/tileset.json',
                routes: [{ id: 'loop', name: '环线', path: [[120.6, 31.3, 2], [120.601, 31.3, 2]] }]
              }
            ]
          })
        )
      );
      const page = await readyPage();
      const { wrapper } = page;
      const labels = () => wrapper.findAll('button').map(item => item.attributes('aria-label') ?? item.text());
      const search = () => wrapper.get<HTMLInputElement>('input[placeholder="搜索资源"]');
      await button(wrapper, '图例').trigger('click');
      await switchTo(wrapper, '三维');
      await vi.waitFor(() => expect(wrapper.find('[data-catalog-node="model-root"]').exists()).toBe(true));
      // 搜索时目录全部展开
      await search().setValue('广');
      await wrapper.get('[data-catalog-node="model:square"]').trigger('click');
      await wrapper.get('[data-tool="add"]').trigger('click');
      await settle();
      const scene = sceneOf(page);
      await scene.ready('square');

      await button(wrapper, '漫游').trigger('click');
      await settle();
      expect(scene.session.scene.current.roam).toMatchObject({ kind: 'route', speed: 4 });
      expect(scene.session.scene.current.underground).toBeNull();
      expect(wrapper.find('[data-layer-panel]').exists()).toBe(false);
      expect(wrapper.get('[data-roam-panel]').text()).toContain('广场 · 倾斜摄影');
      for (const label of ['测距', '图例', '放大', '二维', '三维', '默认视角']) {
        expect(labels()).not.toContain(label);
      }
      expect(wrapper.find('[data-map-status-bar]').exists()).toBe(false);
      expect(wrapper.find('[data-map-cards]').exists()).toBe(false);
      expect(wrapper.get('[data-panel-group]').isVisible()).toBe(false);

      await button(wrapper, '退出漫游').trigger('click');
      await settle();
      expect(wrapper.find('[data-roam-panel]').exists()).toBe(false);
      expect(labels()).toEqual(expect.arrayContaining(['测距', '放大', '二维', '三维']));
      expect(wrapper.find('[data-map-status-bar]').exists()).toBe(true);
      expect(wrapper.get('[data-panel-group]').isVisible()).toBe(true);
      expect(search().element.value).toBe('广');
    });
  });

  it('资源目录加载失败：列表显示失败和重试；重试期间显示加载中，成功后显示资源', async () => {
    server.use(mock.get(TREE_URL, () => HttpResponse.json({ code: 500, msg: '系统异常', success: false, data: null })));
    const { wrapper } = await readyPage();
    await vi.waitFor(() => expect(wrapper.text()).toContain('资源目录加载失败'));

    // 重试的请求先挂起，由用例决定什么时候返回
    let release: (() => void) | undefined;
    const released = new Promise<void>(resolve => (release = resolve));
    server.use(
      mock.get(TREE_URL, async () => {
        await released;
        return HttpResponse.json(resourceTreeResponse());
      })
    );
    await button(wrapper, '重试').trigger('click');
    await vi.waitFor(() => expect(wrapper.text()).toContain('正在加载资源目录'));
    expect(wrapper.text()).not.toContain('资源目录加载失败');

    release?.();
    await vi.waitFor(() => expect(wrapper.find('[data-catalog-node="resource:bgdc_dltb"]').exists()).toBe(true));
  });

  it('画布尺寸变化后（相机不变、投影变了），测量标签和图钉立即重新投影', async () => {
    stubBoundaryFetch();
    const { wrapper, map } = await readyPage();
    await button(wrapper, '测距').trigger('click');
    drawLine(map);
    await button(wrapper, '测距').trigger('click');
    await button(wrapper, '坐标定位').trigger('click');
    await button(wrapper, '拾取').trigger('click');
    map.mouse('click', 50, 30);
    await nextTick();
    const total = () => overlayItems(wrapper).find(({ text }) => text?.startsWith('总长'));
    expect(total()).toMatchObject({ x: 100, y: 0 });
    expect(pinAt(wrapper)).toStrictEqual([50, 30]);

    map.screenOffset = { x: 40, y: 25 };
    map.fire('resize');
    await nextTick();

    expect(total()).toMatchObject({ x: 140, y: 25 });
    expect(pinAt(wrapper)).toStrictEqual([90, 55]);
  });

  describe('偏好的开关（ADR 0140）', () => {
    const STORED = { version: 2, value: { selected: 'imagery', opacity: { vector: 1, imagery: 1, static: 1 } } };
    const PREFERENCE_KEYS = ['basemap', 'boundaries', 'resource-layers', 'resource-symbols', 'resource-panel'].map(
      name => `zhangsan/${name}`
    );

    // 已登录、存着影像底图；jsdom 没有 IndexedDB，偏好换成内存存储。appConfig 在模块加载时读取环境变量，要重新导入页面
    async function pageWithStoredImagery(env: Readonly<Record<string, string>> = {}) {
      Object.entries(env).forEach(([name, value]) => {
        vi.stubEnv(name, value);
      });
      localStorage.setItem(
        'yzt.session',
        JSON.stringify({ token: 'token', user: { loginName: 'zhangsan', role: 'user' } })
      );
      const store = createMemoryStore({ 'zhangsan/basemap': STORED });
      const get = vi.spyOn(store, 'get');
      vi.doMock('@/shared/storage/idb-store', () => ({ preferenceStore: store }));
      const { wrapper } = await readyPage(await freshModules());
      return { wrapper, store, get };
    }

    afterEach(() => {
      vi.doUnmock('@/shared/storage/idb-store');
      localStorage.removeItem('yzt.session');
    });

    it('底图的开关关闭：不读不写，存着影像也是矢量，换了也不存；其余偏好照常读取', async () => {
      const { wrapper, store, get } = await pageWithStoredImagery({ VITE_PREFERENCE_BASEMAP: 'false' });
      await settle();

      expect(basemapCardOf(wrapper).text()).toBe('矢量');
      expect(get).not.toHaveBeenCalledWith('zhangsan/basemap');
      expect(get).toHaveBeenCalledWith('zhangsan/boundaries');

      await chooseNoBasemap(wrapper);
      expect(store.entries.get('zhangsan/basemap')).toStrictEqual(STORED);
    });

    it('底图的开关打开：恢复存下的底图，换了也存下', async () => {
      const { wrapper, store } = await pageWithStoredImagery();
      await vi.waitFor(() => expect(basemapCardOf(wrapper).text()).toBe('影像'));

      await chooseNoBasemap(wrapper);
      expect(store.entries.get('zhangsan/basemap')).toMatchObject({ value: { selected: 'none' } });
    });

    it('离开页面后重置只管页面缓存：打开时开关开着的底图照样恢复', async () => {
      const { wrapper } = await pageWithStoredImagery({ VITE_PAGE_STATE_RESET: 'true' });

      await vi.waitFor(() => expect(basemapCardOf(wrapper).text()).toBe('影像'));
    });

    it('离开页面后重置只管页面缓存：关闭时开关关着的底图照样不读', async () => {
      const { wrapper, get } = await pageWithStoredImagery({
        VITE_PAGE_STATE_RESET: 'false',
        VITE_PREFERENCE_BASEMAP: 'false'
      });
      await settle();

      expect(basemapCardOf(wrapper).text()).toBe('矢量');
      expect(get).not.toHaveBeenCalledWith('zhangsan/basemap');
    });

    it('所有开关打开：五项偏好都读取', async () => {
      const { get } = await pageWithStoredImagery();

      PREFERENCE_KEYS.forEach(key => expect(get).toHaveBeenCalledWith(key));
    });

    it('总开关关闭：五项偏好都不读，资源列表照常显示', async () => {
      const { wrapper, store, get } = await pageWithStoredImagery({ VITE_PREFERENCES_ENABLED: 'false' });

      await vi.waitFor(() => expect(wrapper.find('[data-catalog-node="resource:bgdc_dltb"]').exists()).toBe(true));
      expect(basemapCardOf(wrapper).text()).toBe('矢量');
      expect(get).not.toHaveBeenCalled();

      await chooseNoBasemap(wrapper);
      expect(store.entries.get('zhangsan/basemap')).toStrictEqual(STORED);
    });

    // 资源图层的拥有者等恢复结束才合并目录：开关关闭时不结束恢复，资源列表就一直是空的
    it('资源图层的开关关闭：不读这一项，目录照常合并进资源列表', async () => {
      const { wrapper, get } = await pageWithStoredImagery({ VITE_PREFERENCE_RESOURCE_LAYERS: 'false' });

      await vi.waitFor(() => expect(wrapper.find('[data-catalog-node="resource:bgdc_dltb"]').exists()).toBe(true));
      expect(get).not.toHaveBeenCalledWith('zhangsan/resource-layers');
    });
  });

  describe('区划定位与其他相机操作的先后（每个用例重新导入页面，边界没有缓存）', () => {
    it('区划裁剪：边界到位后才盖上遮罩，插在注记下面、盖住资源和高亮；回到全省后去掉（ADR 0051）', async () => {
      const boundaries = deferBoundaryFetch();
      const { wrapper, map } = await readyPage(await freshModules());
      await button(wrapper, '区划定位').trigger('click');
      await button(wrapper, '南京').trigger('click');
      await settle();
      expect(map.geojson.has('region-clip')).toBe(false);

      boundaries.release('city');
      await settle();
      const [[id, beforeId] = []] = addedLayersOf(map, 'region-clip');
      expect(id).toBe('region-clip-mask');
      expect(beforeId?.startsWith('basemap-labels')).toBe(true);
      expect(map.geojson.get('region-clip')).toMatchObject({ geometry: { type: 'MultiPolygon' } });

      await button(wrapper, '南京').trigger('click');
      await settle();
      expect(map.geojson.has('region-clip')).toBe(false);
    });

    it('边界加载期间点"默认视角"：相机没有变化也算一次新的操作，边界到位后只高亮、不定位', async () => {
      const boundaries = deferBoundaryFetch();
      const { wrapper, map } = await readyPage(await freshModules());
      await button(wrapper, '区划定位').trigger('click');
      await button(wrapper, '南京').trigger('click');

      await button(wrapper, '默认视角').trigger('click');
      boundaries.release('city');
      await settle();

      expect(map.fitBoundsCalls).toEqual([jiangsu, jiangsu]);
      expect(map.geojson.has('region')).toBe(true);
    });

    it('上一次定位的动画还在进行时选中区县：动画的每一帧不算新的操作，边界到位后定位到区县', async () => {
      const boundaries = deferBoundaryFetch();
      const { wrapper, map } = await readyPage(await freshModules());
      await button(wrapper, '区划定位').trigger('click');
      await button(wrapper, '南京').trigger('click');
      boundaries.release('city');
      await settle();
      expect(map.fitBoundsCalls).toEqual([jiangsu, NANJING]);

      await button(wrapper, '玄武区').trigger('click');
      map.frame(118.9, 32.1);
      map.frame(118.8, 32.05);
      boundaries.release('county');
      await settle();

      expect(map.fitBoundsCalls).toEqual([jiangsu, NANJING, XUANWU]);
    });

    it('地图加载期间选中区划：就绪时的初始适配让给用户的选择，只定位到区划', async () => {
      const boundaries = deferBoundaryFetch();
      const { wrapper, maps } = mountPage({ modules: await freshModules() });
      const map = maps[0];
      if (!map) {
        throw new Error('没有创建地图');
      }
      await button(wrapper, '区划定位').trigger('click');
      await button(wrapper, '南京').trigger('click');
      boundaries.release('city');
      await settle();

      map.fire('style.load');
      await settle();

      expect(map.fitBoundsCalls).toEqual([NANJING]);
    });

    it('引擎失败期间选中区划，重试成功后定位到区划：等待中的定位不因视图失败放弃（ADR 0039）', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        stubBoundaryFetch();
        const { wrapper, maps } = mountPage({ failFirstCreation: true, modules: await freshModules() });
        await nextTick();
        await button(wrapper, '区划定位').trigger('click');
        await button(wrapper, '南京').trigger('click');
        await settle();

        await button(wrapper, '重试').trigger('click');
        await nextTick();
        const map = maps[0];
        if (!map) {
          throw new Error('重试后没有创建地图');
        }
        map.fire('style.load');
        await settle();

        expect(map.fitBoundsCalls).toEqual([NANJING]);
        // 重试时边界已经到位：高亮在创建地图的样式里
        const style = map.options.style;
        expect(typeof style === 'object' && Object.hasOwn(style.sources, 'region')).toBe(true);
      } finally {
        consoleError.mockRestore();
      }
    });

    it('边界加载期间拖动地图或输入坐标定位：都是新的操作，边界到位后只高亮、不定位', async () => {
      const dragged = deferBoundaryFetch();
      const first = await readyPage(await freshModules());
      await button(first.wrapper, '区划定位').trigger('click');
      await button(first.wrapper, '南京').trigger('click');
      first.map.drag(120.6, 31.3);
      dragged.release('city');
      await settle();
      expect(first.map.fitBoundsCalls).toEqual([jiangsu]);
      expect(first.map.geojson.has('region')).toBe(true);

      const located = deferBoundaryFetch();
      const second = await readyPage(await freshModules());
      await button(second.wrapper, '区划定位').trigger('click');
      await button(second.wrapper, '南京').trigger('click');
      await button(second.wrapper, '坐标定位').trigger('click');
      await second.wrapper.get('input[aria-label="经度"]').setValue('118.79786 32.04864');
      await second.wrapper.get('input[aria-label="经度"]').trigger('keydown', { key: 'Enter' });
      located.release('city');
      await settle();
      expect(second.map.fitBoundsCalls).toEqual([jiangsu]);
      expect(second.map.flyToCalls).toHaveLength(1);
      expect(second.map.flyToCalls[0]).toMatchObject({ center: [118.79786, 32.04864], zoom: 14 });
    });
  });
});
