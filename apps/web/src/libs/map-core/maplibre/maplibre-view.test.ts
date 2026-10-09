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
  // 调用时抛错
  failOn: string | undefined;
  // 像 MapLibre 的校验失败一样：同步触发 error 事件，不抛错，也不生效
  rejectOn: string | undefined;
  removed = false;

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
      if (this.rejectOn === name) {
        this.fire('error', { error: new Error(`${name} rejected`) });
        return;
      }
      this.calls.push([name, ...args]);
    };
  }
}

type Groups = 'basemap' | 'business';

function setup(
  options: Partial<Pick<MapLibreViewOptions<Groups>, 'active' | 'mapOptions' | 'createMap'>> = {},
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

function names(calls: unknown[][]): unknown[] {
  return calls.map(([name]) => name);
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

    it('reloads the next style version after a failed load and becomes ready again', async () => {
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

    it('does not reload the same style version again after a failed load', async () => {
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

    it('fails again without retrying when the reloaded version is rejected too', async () => {
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

    it('does not reload for a pending notification of the version that just failed', async () => {
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
    it('reloads the latest version at once when the loading version fails after a newer one was committed', async () => {
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

    it('reloads the latest version at once when a rebuild fails after a newer one was committed', async () => {
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

    it('does not reload after disposal even if a newer version was waiting', async () => {
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

    it('catches up the versions committed while loading when the load completes after an error', async () => {
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

    it('keeps the same promise when a failed load is retried with a newer version', async () => {
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
      let pitchWhenReady: number | undefined;
      ctx.view.on('statechange', () => (pitchWhenReady = ctx.session.camera.current.pitch));

      ctx.view.resume();

      expect(ctx.map.calls).toContainEqual(['jumpTo', { center: [120, 31], zoom: 8, bearing: 0, pitch: 75 }, { cause: 'sync' }]);
      // 二维把俯角收到上限后写回会话，但不算意图；进入 ready 时会话已经是地图的实际值
      expect(ctx.session.camera.current.pitch).toBe(60);
      expect(pitchWhenReady).toBe(60);
      expect(ctx.session.camera.intentRevision).toBe(revision);
    });

    it('applies the session camera changed while initializing and writes back what the map settled on', () => {
      using ctx = setup();
      // 初始化期间三维改了相机，俯角超出二维的上限
      ctx.session.camera.set({ ...NANJING, center: [120, 31], pitch: 75 }, { view: '3d', cause: 'user' });
      const revision = ctx.session.camera.intentRevision;
      let pitchWhenReady: number | undefined;
      ctx.view.on('statechange', () => (pitchWhenReady = ctx.session.camera.current.pitch));

      ctx.map.fire('style.load');

      expect(ctx.map.calls).toContainEqual(['jumpTo', { center: [120, 31], zoom: 8, bearing: 0, pitch: 75 }, { cause: 'sync' }]);
      expect(ctx.session.camera.current).toEqual({ center: [120, 31], zoom: 8, bearing: 0, pitch: 60 });
      expect(pitchWhenReady).toBe(60);
      expect(ctx.session.camera.intentRevision).toBe(revision);
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

    it('locates with flyTo and fitBounds as program moves', () => {
      using ctx = setup();
      ctx.map.fire('style.load');
      // 进入 ready 时同步相机的 jumpTo 不在比较范围内
      const before = ctx.map.calls.length;

      ctx.view.flyTo({ center: [120, 31], zoom: 10 }, { duration: 500 });
      ctx.view.fitBounds([118, 31, 120, 33], { padding: 20 });

      // 不能出现值为 undefined 的键：MapLibre 合并默认选项时会被它覆盖（maxZoom 变成 undefined，算出 NaN）
      expect(ctx.map.calls.slice(before)).toStrictEqual([
        ['flyTo', { center: [120, 31], zoom: 10, duration: 500 }, { cause: 'program' }],
        ['fitBounds', [118, 31, 120, 33], { padding: 20 }, { cause: 'program' }]
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
