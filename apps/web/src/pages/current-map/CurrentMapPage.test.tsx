import type {
  CameraEventData,
  GestureHandlerLike,
  MapLibreMapOptions,
  MapLike,
  MapMouseEventLike,
  MapMouseEventType,
  MapMoveEventLike,
  MapSubscription,
  ViewBounds
} from '@yzt/map-core';
import { MapCanvas } from '@yzt/map-vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';
import { JIANGSU_BOUNDS } from '@/shared/map/jiangsu';
import { CurrentMapPage } from './CurrentMapPage';

interface FakeEvent {
  readonly error?: Error;
  readonly originalEvent?: unknown;
  readonly cause?: unknown;
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

  addSource(): void {}
  removeSource(): void {}
  getSource(): unknown {
    return undefined;
  }
  addLayer(): void {}
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

  flyTo(camera: { center?: [number, number]; zoom?: number }, eventData: CameraEventData): void {
    this.moveTo(camera.center ?? [this.camera.lng, this.camera.lat], camera.zoom ?? this.camera.zoom, eventData);
  }

  fitBounds(bounds: [number, number, number, number], _options: unknown, eventData: CameraEventData): void {
    this.fitBoundsCalls.push(bounds);
    const [west, south, east, north] = bounds;
    this.moveTo([(west + east) / 2, (south + north) / 2], 6.5, eventData);
  }

  // 拾取、投影用固定换算：画布左上角 (0, 0) 是 (118, 33)，每 100 像素 1 度
  unproject([x, y]: [number, number]) {
    return { lng: 118 + x / 100, lat: 33 - y / 100 };
  }
  project([lng, lat]: [number, number]) {
    return { x: (lng - 118) * 100, y: (33 - lat) * 100 };
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
});
