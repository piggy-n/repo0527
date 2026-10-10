import type { LayerSpecification, SourceSpecification } from '@maplibre/maplibre-gl-style-spec';
import {
  type CameraEventData,
  type GestureHandlerLike,
  geodesicDistance,
  type MapLibreMapOptions,
  type MapLike,
  type MapMouseEventLike,
  type MapMouseEventType,
  type MapMoveEventLike,
  type MapSubscription,
  type ViewBounds
} from '@yzt/map-core';
import { MapCanvas } from '@yzt/map-vue';
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';
import cityFile from '@/shared/map/boundary/data/jiangsu-city.json?raw';
import countyFile from '@/shared/map/boundary/data/jiangsu-county.json?raw';
import { JIANGSU_BOUNDS } from '@/shared/map/jiangsu';
import { formatCoordinate } from '@/shared/map/location/coordinate-format';
import { formatDistance } from '@/shared/map/measure/measure-labels';
import { CurrentMapPage } from './CurrentMapPage';

interface FakeEvent {
  readonly error?: Error;
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
  setStyle(): void {}

  on(type: 'style.load', listener: () => void): MapSubscription;
  on(type: 'error', listener: (event: { readonly error: Error }) => void): MapSubscription;
  on(type: 'move', listener: (event: MapMoveEventLike) => void): MapSubscription;
  on(type: MapMouseEventType, listener: (event: MapMouseEventLike) => void): MapSubscription;
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
  flyTo(camera: { center?: [number, number]; zoom?: number }, eventData: CameraEventData): void {
    this.flyToCalls.push(camera);
    this.moveTo(camera.center ?? [this.camera.lng, this.camera.lat], camera.zoom ?? this.camera.zoom, eventData);
  }

  fitBounds(bounds: [number, number, number, number], _options: unknown, eventData: CameraEventData): void {
    this.fitBoundsCalls.push(bounds);
    const [west, south, east, north] = bounds;
    this.moveTo([(west + east) / 2, (south + north) / 2], 6.5, eventData);
  }

  // 拾取、投影用简单的换算：画布左上角是相机中心，每 100 像素 1 度，相机移动后位置跟着变
  unproject([x, y]: [number, number]) {
    return { lng: this.camera.lng + x / 100, lat: this.camera.lat - y / 100 };
  }
  project([lng, lat]: [number, number]) {
    return { x: (lng - this.camera.lng) * 100, y: (this.camera.lat - lat) * 100 };
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

  remove(): void {}

  /** 模拟用户拖动：带原始的 DOM 事件 */
  drag(lng: number, lat: number): void {
    this.moveTo([lng, lat], this.camera.zoom, { originalEvent: new MouseEvent('mousemove') });
  }

  /** 模拟鼠标：detail 是连击的次数 */
  mouse(type: MapMouseEventType, x: number, y: number, detail = 1): void {
    this.fire(type, { point: { x, y }, originalEvent: new MouseEvent(type, { detail, button: 0 }) });
  }

  moveTo([lng, lat]: [number, number], zoom: number, event: FakeEvent): void {
    this.camera = { lng, lat, zoom };
    this.fire('move', event);
  }
}

/**
 * 页面里的画布用真实的 MapLibre，jsdom 里创建不出来；用 stubs 换成注入了假地图的同一个组件。
 * 第一次创建可以设为失败，模拟引擎失败后重试；canvasKey 变化时画布重建
 */
function mountPage({ failFirstCreation = false } = {}) {
  const canvasKey = ref(0);
  const maps: FakeMap[] = [];
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
  const RealCanvas = { ...MapCanvas, name: 'RealMapCanvas' } as typeof MapCanvas;
  const CanvasWithFakeMap = defineComponent({
    inheritAttrs: false,
    setup: (_, { attrs }) => () => <RealCanvas {...attrs} key={canvasKey.value} createMap={createMap} />
  });
  const wrapper = mount(CurrentMapPage, { global: { stubs: { MapCanvas: CanvasWithFakeMap } } });
  return { wrapper, maps, canvasKey };
}

const jiangsu = [...JIANGSU_BOUNDS] as ViewBounds;

// 等定位相关的微任务和渲染都走完
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

function button(wrapper: ReturnType<typeof mountPage>['wrapper'], text: string) {
  const found = wrapper.findAll('button').find(candidate => candidate.text() === text);
  if (!found) {
    throw new Error(`没有"${text}"按钮`);
  }
  return found;
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
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// 边界文件按地址给出：县界或市界
function stubBoundaryFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn<(url: string) => Promise<Response>>(url =>
      Promise.resolve(new Response(url.includes('county') ? countyFile : cityFile))
    )
  );
}

// 页面就绪：创建地图、加载完样式、做完初始定位
async function readyPage() {
  const page = mountPage();
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

// jsdom 没有 PointerEvent，用同名的 MouseEvent 代替
async function pointer(wrapper: PageWrapper, type: string, clientX = 0, clientY = 0, mouseButton = 0) {
  pin(wrapper).element.dispatchEvent(new MouseEvent(type, { bubbles: true, button: mouseButton, clientX, clientY }));
  await nextTick();
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
      'boundaries-province'
    ]);
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

    map.mouse('click', 0, 0);
    await nextTick();
    expect(overlayItems(wrapper)).toStrictEqual([{ text: '单击添加节点，双击结束测距', x: 30, y: 40 }]);
    // 测量的图层叠在最上面：最上面的节点先加入，其余依次插在它下面
    expect(map.addedLayers).toStrictEqual([
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

    const { lng, lat } = map.getCenter();
    const total = `总长 ${formatDistance(geodesicDistance([lng, lat], [lng + 1, lat]))}`;
    expect(overlayItems(wrapper)).toStrictEqual([
      { text: total, x: 100, y: 0 },
      { text: '单击开始测距', x: 30, y: 40 }
    ]);
    expect(map.geojson.has('measure')).toBe(true);

    map.drag(lng + 0.5, lat);
    await nextTick();
    expect(overlayItems(wrapper)[0]).toStrictEqual({ text: total, x: 50, y: 0 });

    await wrapper.get('[aria-label="删除这条测量"]').trigger('click');
    expect(overlayItems(wrapper)).toStrictEqual([{ text: '单击开始测距', x: 30, y: 40 }]);
    expect(map.geojson.has('measure')).toBe(false);

    drawLine(map);
    await nextTick();
    expect(overlayItems(wrapper)).toHaveLength(2);
    await button(wrapper, '清除').trigger('click');
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

    expect(map.addedLayers).toStrictEqual([
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

  it('坐标定位与区划定位的面板同一时间只开一个', async () => {
    const { wrapper } = await readyPage();

    await button(wrapper, '坐标定位').trigger('click');
    expect(wrapper.find('[data-coordinate-locate-panel]').exists()).toBe(true);
    await button(wrapper, '区划定位').trigger('click');

    expect(wrapper.find('[data-coordinate-locate-panel]').exists()).toBe(false);
    expect(wrapper.find('[data-region-locate-panel]').exists()).toBe(true);
    expect(button(wrapper, '坐标定位').attributes('aria-pressed')).toBe('false');
    expect(button(wrapper, '区划定位').attributes('aria-pressed')).toBe('true');
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
    expect(wrapper.get('[data-location-overlay]').text()).toContain('点击地图拾取点位，Esc 取消');
    map.mouse('click', 100, 50);
    await nextTick();

    expect(button(wrapper, '拾取').attributes('aria-pressed')).toBe('false');
    expect(pin(wrapper).attributes('style')).toContain('left: 100px; top: 50px;');
    expect(wrapper.find('[data-location-info]').exists()).toBe(true);
    expect(wrapper.get('[data-location-overlay]').text()).not.toContain('点击地图拾取点位');
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

    await button(wrapper, '清除').trigger('click');
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
});
