import type { LayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { CameraChange, CameraState } from '../camera/camera-model';
import { MapSession } from '../session/map-session';
import { type StyleGroup, StyleModel } from '../style/style-model';
import type { ViewState } from '../view/map-view';
import type { CameraEventData, MapLibreMapOptions, MapLike, MapMoveEventLike, MapSubscription } from './map-like';
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
  readonly originalEvent?: unknown;
  readonly cause?: unknown;
}

interface FakeCamera {
  lng: number;
  lat: number;
  zoom: number;
  bearing: number;
  pitch: number;
}

const CAMERA_CALLS = new Set(['jumpTo', 'flyTo', 'fitBounds', 'remove']);

// 只模拟适配器用到的行为：记录调用；相机方法立即到位，并像 MapLibre 一样同步触发 move、合并 eventData
class FakeMap implements MapLike {
  readonly calls: unknown[][] = [];
  readonly maxPitch = 60;
  readonly #listeners = new Map<string, Set<(event: FakeEvent) => void>>();
  camera: FakeCamera;
  failOn: string | undefined;
  removed = false;

  constructor(readonly options: MapLibreMapOptions) {
    const [lng, lat] = options.center as [number, number];
    this.camera = { lng, lat, zoom: options.zoom ?? 0, bearing: options.bearing ?? 0, pitch: options.pitch ?? 0 };
  }

  addSource = this.#record('addSource');
  removeSource = this.#record('removeSource');
  addLayer = this.#record('addLayer');
  removeLayer = this.#record('removeLayer');
  setPaintProperty = this.#record('setPaintProperty');
  setLayoutProperty = this.#record('setLayoutProperty');
  setFilter = this.#record('setFilter');
  setLayerZoomRange = this.#record('setLayerZoomRange');
  setStyle = this.#record('setStyle');

  getSource(): unknown {
    return undefined;
  }

  on(type: 'style.load', listener: () => void): MapSubscription;
  on(type: 'error', listener: (event: { readonly error: Error }) => void): MapSubscription;
  on(type: 'move', listener: (event: MapMoveEventLike) => void): MapSubscription;
  on(type: string, listener: (event: never) => void): MapSubscription {
    // 三个重载的回调都能接收 FakeEvent 中各自需要的字段
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

  flyTo(camera: { center?: [number, number]; zoom?: number }, eventData: CameraEventData): void {
    this.calls.push(['flyTo', camera, eventData]);
    const [lng, lat] = camera.center ?? [this.camera.lng, this.camera.lat];
    this.moveTo({ ...this.camera, lng, lat, zoom: camera.zoom ?? this.camera.zoom }, eventData);
  }

  fitBounds(
    bounds: [number, number, number, number],
    options: { maxZoom?: number },
    eventData: CameraEventData
  ): void {
    this.calls.push(['fitBounds', bounds, options, eventData]);
    const [west, south, east, north] = bounds;
    this.moveTo(
      { ...this.camera, lng: (west + east) / 2, lat: (south + north) / 2, zoom: options.maxZoom ?? 10 },
      eventData
    );
  }

  remove(): void {
    this.removed = true;
    this.calls.push(['remove']);
  }

  /** 模拟用户拖动：带原始的 DOM 事件 */
  drag(lng: number, lat: number): void {
    this.moveTo({ ...this.camera, lng, lat }, { originalEvent: new MouseEvent('mousemove') });
  }

  moveTo(camera: FakeCamera, event: FakeEvent): void {
    this.camera = { ...camera, pitch: Math.min(camera.pitch, this.maxPitch) };
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
      this.calls.push([name, ...args]);
    };
  }
}

type Groups = 'basemap' | 'business';

function setup(options: Partial<Pick<MapLibreViewOptions<Groups>, 'active' | 'mapOptions' | 'createMap'>> = {}) {
  const stack = new DisposableStack();
  const session = stack.use(new MapSession({ groups: ['basemap', 'business'], camera: NANJING }));
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

function names(calls: unknown[][]): unknown[] {
  return calls.map(([name]) => name);
}

describe('MapLibreView', () => {
  it('works with the MapLibre map', () => {
    expectTypeOf<MapLibreMap>().toExtend<MapLike>();
  });

  describe('lifecycle', () => {
    it('creates the map from the current style snapshot and the session camera', () => {
      using ctx = setup({ mapOptions: { maxZoom: 18 } });

      expect(ctx.map.options).toMatchObject({ center: [118.8, 32.05], zoom: 8, bearing: 0, pitch: 0, maxZoom: 18 });
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

    it('reports MapLibre error events without rebuilding', () => {
      using ctx = setup();
      ctx.map.fire('style.load');
      const failure = new Error('tile 404');

      ctx.map.fire('error', { error: failure });

      expect(ctx.errors).toEqual([failure]);
      expect(ctx.map.styleCalls()).toEqual([]);
    });
  });

  describe('camera', () => {
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
      const revision = ctx.session.camera.intentRevision;

      ctx.view.resume();

      expect(ctx.map.calls).toContainEqual(['jumpTo', { center: [120, 31], zoom: 8, bearing: 0, pitch: 75 }, { cause: 'sync' }]);
      // 二维把俯角收到上限后写回会话，但不算意图
      expect(ctx.session.camera.current.pitch).toBe(60);
      expect(ctx.session.camera.intentRevision).toBe(revision);
    });

    it('locates with flyTo and fitBounds as program moves', () => {
      using ctx = setup();
      ctx.map.fire('style.load');

      ctx.view.flyTo({ center: [120, 31], zoom: 10 }, { duration: 500 });
      ctx.view.fitBounds([118, 31, 120, 33], { padding: 20, maxZoom: 16 });

      expect(ctx.map.calls).toEqual([
        ['flyTo', { center: [120, 31], zoom: 10, duration: 500 }, { cause: 'program' }],
        ['fitBounds', [118, 31, 120, 33], { padding: 20, maxZoom: 16 }, { cause: 'program' }]
      ]);
      expect(ctx.session.camera.intentRevision).toBe(2);
    });

    it('refuses to locate unless ready', () => {
      using ctx = setup();

      expect(() => ctx.view.flyTo({ zoom: 10 })).toThrow('当前状态为 initializing');
      ctx.map.fire('style.load');
      ctx.view.pause();
      expect(() => ctx.view.fitBounds([118, 31, 120, 33])).toThrow('当前状态为 paused');
    });
  });
});
