import type {
  CameraEventData,
  CameraState,
  MapLibreMapOptions,
  MapLike,
  MapMoveEventLike,
  MapSession,
  MapSubscription,
  StyleGroup
} from '@yzt/map-core';
import { MapLibreView } from '@yzt/map-core';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, inject, nextTick, ref, type ShallowRef } from 'vue';
import { INTERNAL_MAP_CONTEXT, type MapContext } from './context';
import { MapCanvas } from './MapCanvas';
import { type MapHandle, provideMap } from './provide-map';
import { useMap, useMapOverlay } from './use-map';

const CAMERA: CameraState = { center: [119.4, 32.9], zoom: 7, bearing: 0, pitch: 0 };
const JIANGSU: readonly [number, number, number, number] = [116.3, 30.7, 121.9, 35.2];

const BASEMAP: StyleGroup = {
  sources: {},
  layers: [{ id: 'basemap-background', type: 'background', paint: { 'background-color': '#eef2f7' } }]
};

interface FakeEvent {
  readonly error?: Error;
  readonly originalEvent?: unknown;
  readonly cause?: unknown;
}

// 只模拟视图用到的行为：相机方法立即到位并同步触发 move；像 MapLibre 一样给容器加 class
class FakeMap implements MapLike {
  readonly flyToCalls: unknown[] = [];
  readonly fitBoundsCalls: unknown[] = [];
  readonly #listeners = new Map<string, Set<(event: FakeEvent) => void>>();
  camera: { lng: number; lat: number; zoom: number; bearing: number; pitch: number };
  removed = false;
  onRemove: (() => void) | undefined;

  constructor(readonly options: MapLibreMapOptions) {
    const [lng, lat] = options.center as [number, number];
    this.camera = { lng, lat, zoom: options.zoom ?? 0, bearing: options.bearing ?? 0, pitch: options.pitch ?? 0 };
    (options.container as HTMLElement).classList.add('maplibregl-map');
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
    return this.camera.bearing;
  }
  getPitch(): number {
    return this.camera.pitch;
  }

  jumpTo(camera: { center: [number, number]; zoom: number }, eventData: CameraEventData): void {
    this.moveTo(camera.center, camera.zoom, eventData);
  }

  flyTo(camera: { center?: [number, number]; zoom?: number }, eventData: CameraEventData): void {
    this.flyToCalls.push(camera);
    this.moveTo(camera.center ?? [this.camera.lng, this.camera.lat], camera.zoom ?? this.camera.zoom, eventData);
  }

  fitBounds(bounds: [number, number, number, number], options: unknown, eventData: CameraEventData): void {
    this.fitBoundsCalls.push(options);
    const [west, south, east, north] = bounds;
    this.moveTo([(west + east) / 2, (south + north) / 2], this.camera.zoom, eventData);
  }

  remove(): void {
    this.onRemove?.();
    this.removed = true;
  }

  /** 模拟用户拖动：带原始的 DOM 事件 */
  drag(lng: number, lat: number): void {
    this.moveTo([lng, lat], this.camera.zoom, { originalEvent: new MouseEvent('mousemove') });
  }

  moveTo([lng, lat]: [number, number], zoom: number, event: FakeEvent): void {
    this.camera = { ...this.camera, lng, lat, zoom };
    this.fire('move', event);
  }
}

// 创建假地图并记下来，测试里按顺序取用
function createFakeMap(maps: FakeMap[]): (options: MapLibreMapOptions) => FakeMap {
  return options => {
    const map = new FakeMap(options);
    maps.push(map);
    return map;
  };
}

// 立即可知的结果：还没结束的 Promise 得到 'pending'，测试因断言失败而不是超时
async function settled(promise: Promise<unknown>): Promise<unknown> {
  return Promise.race([
    promise.then(
      value => ({ resolved: value }),
      (error: unknown) => ({ rejected: error })
    ),
    new Promise(resolve => setTimeout(() => resolve('pending'), 0))
  ]);
}

/** 页面：provideMap 并绑定底图，渲染画布和一个读 useMap 的子组件 */
function setup(options: { showCanvas?: boolean; onChildSetup?: (context: MapContext) => void } = {}) {
  const showCanvas = ref(options.showCanvas ?? true);
  const paused = ref(false);
  const maps: FakeMap[] = [];
  const errors: unknown[] = [];
  const observed: { context?: MapContext; session?: MapSession<string> } = {};

  const Child = defineComponent(() => {
    observed.context = useMap();
    observed.session = inject(INTERNAL_MAP_CONTEXT)?.session;
    options.onChildSetup?.(observed.context);
    return () => null;
  });

  const createMap = createFakeMap(maps);

  const Page = defineComponent(() => {
    const map = provideMap({ groups: ['basemap'], camera: CAMERA, onError: error => errors.push(error) });
    map.bindStyle({ basemap: () => BASEMAP });
    return () => (
      <div>
        {showCanvas.value && <MapCanvas class={['page-map', paused.value && 'is-paused']} createMap={createMap} />}
        <Child />
      </div>
    );
  });

  const wrapper = mount(Page);
  const { context, session } = observed;
  if (!context || !session) {
    throw new Error('子组件没有拿到上下文');
  }
  return { wrapper, showCanvas, paused, maps, errors, context, session };
}

describe('MapCanvas', () => {
  it('挂载后用会话的完整快照创建视图；外层接收页面的 class，MapLibre 加在内层容器上的 class 不会被冲掉', async () => {
    const { wrapper, maps, paused } = setup();

    expect(maps).toHaveLength(1);
    const style = maps[0]?.options.style as { layers: { id: string }[] };
    expect(style.layers.map(({ id }) => id)).toEqual(['basemap-background']);

    const root = wrapper.find('.page-map');
    const container = maps[0]?.options.container as HTMLElement;
    expect(root.element.firstElementChild).toBe(container);
    expect(root.classes().some(name => name.includes('_root_'))).toBe(true);

    paused.value = true;
    await nextTick();

    expect(root.classes()).toContain('is-paused');
    expect(container.classList.contains('maplibregl-map')).toBe(true);
  });

  it('视图状态：画布挂载前是 idle，创建后 initializing，加载完成后 ready；画布卸载后回到 idle', async () => {
    const atChildSetup: unknown[] = [];
    const { context, maps, showCanvas } = setup({
      onChildSetup: map => atChildSetup.push(map.viewState.value, map.view.value)
    });

    expect(atChildSetup).toEqual(['idle', null]);
    expect(context.viewState.value).toBe('initializing');
    expect(context.view.value).not.toBeNull();

    maps[0]?.fire('style.load');
    expect(context.viewState.value).toBe('ready');

    showCanvas.value = false;
    await nextTick();

    expect(context.viewState.value).toBe('idle');
    expect(context.view.value).toBeNull();
    expect(maps[0]?.removed).toBe(true);
  });

  it('视图的受限入口：冻结，只有 kind、flyTo、fitBounds，定位转发给视图', () => {
    const { context, maps, session } = setup();
    maps[0]?.fire('style.load');
    const viewport = context.view.value;
    if (!viewport) {
      throw new Error('没有视图');
    }

    expect(Object.isFrozen(viewport)).toBe(true);
    expect(Object.keys(viewport).toSorted()).toEqual(['fitBounds', 'flyTo', 'kind']);
    expect(Symbol.dispose in viewport).toBe(false);

    viewport.flyTo({ center: [120.6, 31.3] });

    expect(maps[0]?.flyToCalls).toHaveLength(1);
    expect(session.camera.current.center).toEqual([120.6, 31.3]);
  });

  it('只读：给 view、viewState、相机引用赋值不生效', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      let camera: Readonly<ShallowRef<CameraState>> | undefined;
      const { context } = setup({ onChildSetup: map => (camera = map.useCamera()) });
      const viewport = context.view.value;

      // @ts-expect-error 只读
      context.view.value = null;
      // @ts-expect-error 只读
      context.viewState.value = 'ready';
      if (camera) {
        // @ts-expect-error 只读
        camera.value = { ...CAMERA, zoom: 12 };
      }

      expect(context.view.value).toBe(viewport);
      expect(context.viewState.value).toBe('initializing');
      expect(camera?.value.zoom).toBe(CAMERA.zoom);
      expect(warn).toHaveBeenCalledTimes(3);
    } finally {
      warn.mockRestore();
    }
  });

  it('whenReady：画布还没挂载时就开始等，加载完成后结束', async () => {
    let early: Promise<void> | undefined;
    const { maps } = setup({
      onChildSetup: map => {
        early = map.whenReady();
      }
    });
    if (!early) {
      throw new Error('没有开始等待');
    }

    expect(await settled(early)).toBe('pending');

    maps[0]?.fire('style.load');

    expect(await settled(early)).toEqual({ resolved: undefined });
  });

  it('whenReady：signal 中止时以它的原因结束；视图失败时以失败的原因结束', async () => {
    const { context, maps } = setup();
    const controller = new AbortController();
    const timeout = new DOMException('等待超时', 'TimeoutError');
    const aborted = context.whenReady(controller.signal);
    const failed = context.whenReady();

    controller.abort(timeout);
    maps[0]?.fire('error', { error: new Error('整份样式没有通过校验') });

    expect(await settled(aborted)).toEqual({ rejected: timeout });
    expect(context.viewState.value).toBe('failed');
    expect(await settled(failed)).toEqual({ rejected: new Error('整份样式没有通过校验') });
  });

  it('whenReady：等待中视图被释放、或者上下文被释放时以 AbortError 结束', async () => {
    const withCanvas = setup();
    const waitingForLoad = withCanvas.context.whenReady();
    const withoutCanvas = setup({ showCanvas: false });
    const caller = new AbortController();
    const removeListener = vi.spyOn(caller.signal, 'removeEventListener');
    const waitingForView = withoutCanvas.context.whenReady(caller.signal);

    withCanvas.wrapper.unmount();
    withoutCanvas.wrapper.unmount();

    const results = [await settled(waitingForLoad), await settled(waitingForView)];
    expect(results.map(result => (result as { rejected?: DOMException }).rejected?.name)).toEqual([
      'AbortError',
      'AbortError'
    ]);
    // 因上下文释放而结束时，调用方 signal 上的监听也要移除
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('useCamera：拖动地图时更新，调用方卸载后不再更新；不在作用域里调用时抛错', async () => {
    const showProbe = ref(true);
    let camera: Readonly<ShallowRef<CameraState>> | undefined;
    const Probe = defineComponent(() => {
      camera = useMap().useCamera();
      return () => null;
    });
    let mapHandle: MapContext | undefined;
    const maps: FakeMap[] = [];
    mount(
      defineComponent(() => {
        mapHandle = provideMap({ groups: ['basemap'], camera: CAMERA });
        return () => (
          <div>
            <MapCanvas createMap={createFakeMap(maps)} />
            {showProbe.value && <Probe />}
          </div>
        );
      })
    );
    maps[0]?.fire('style.load');

    maps[0]?.drag(120.6, 31.3);
    expect(camera?.value.center).toEqual([120.6, 31.3]);

    showProbe.value = false;
    await nextTick();
    maps[0]?.drag(118.8, 32.05);

    expect(camera?.value.center).toEqual([120.6, 31.3]);
    expect(() => mapHandle?.useCamera()).toThrow('useCamera 只能在组件的 setup 或 effectScope 中调用');
  });

  it('卸载时先释放视图（地图 remove 时会话还在），后释放会话', () => {
    const { wrapper, maps, session } = setup();
    let sessionAliveAtRemove: boolean | undefined;
    const map = maps[0];
    if (map) {
      map.onRemove = () => {
        try {
          session.style.on('change', () => undefined)();
          sessionAliveAtRemove = true;
        } catch {
          sessionAliveAtRemove = false;
        }
      };
    }

    wrapper.unmount();

    expect(sessionAliveAtRemove).toBe(true);
    expect(() => session.style.on('change', () => undefined)).toThrow('StyleModel 已释放');
  });

  it('视图运行中的错误交给 provideMap 的 onError', () => {
    const { maps, errors } = setup();
    maps[0]?.fire('style.load');
    const tileError = new Error('瓦片 404');

    maps[0]?.fire('error', { error: tileError });

    expect(errors).toEqual([tileError]);
  });

  it('必须放在 provideMap 的组件里；一个上下文只能有一个画布，多出来的视图会被释放', () => {
    // setup 抛错后 Vue 会提示组件没有渲染函数，这里不关心
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      expect(() => mount(MapCanvas)).toThrow('MapCanvas 必须放在调用了 provideMap 的组件里面');
    } finally {
      warn.mockRestore();
    }

    const maps: FakeMap[] = [];
    const createMap = createFakeMap(maps);
    const TwoCanvases = defineComponent(() => {
      provideMap({ groups: ['basemap'], camera: CAMERA });
      return () => (
        <div>
          <MapCanvas createMap={createMap} />
          <MapCanvas createMap={createMap} />
        </div>
      );
    });

    expect(() => mount(TwoCanvases)).toThrow('一个地图上下文只能有一个画布');
    expect(maps.map(map => map.removed)).toEqual([false, true]);
  });

  it('悬浮元素登记后，视图入口的 fitBounds 避开它；元素卸载后不再避开', async () => {
    const showPanel = ref(true);
    const Panel = defineComponent(() => {
      const element = ref<HTMLElement>();
      useMapOverlay(element, 'left');
      return () => <aside ref={element} />;
    });
    const maps: FakeMap[] = [];
    let handle: MapHandle<'basemap'> | undefined;
    // 量尺寸时只算在文档里的元素
    const host = document.body.appendChild(document.createElement('div'));
    try {
      mount(
        defineComponent(() => {
          handle = provideMap({ groups: ['basemap'], camera: CAMERA });
          return () => (
            <div>
              <MapCanvas createMap={createFakeMap(maps)} />
              {showPanel.value && <Panel />}
            </div>
          );
        }),
        { attachTo: host }
      );
      const map = maps[0];
      const panel = host.querySelector('aside');
      if (!map || !panel || !handle) {
        throw new Error('没有挂载');
      }
      // jsdom 不做布局，矩形由测试给出
      vi.spyOn(map.options.container as HTMLElement, 'getBoundingClientRect').mockReturnValue(
        DOMRect.fromRect({ x: 0, y: 0, width: 1440, height: 620 })
      );
      vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue(
        DOMRect.fromRect({ x: 16, y: 16, width: 320, height: 588 })
      );
      map.fire('style.load');

      handle.view.value?.fitBounds(JIANGSU);
      expect(map.fitBoundsCalls.at(-1)).toEqual({ padding: { top: 16, right: 16, bottom: 16, left: 352 } });
      expect(handle.overlayPadding().left).toBe(352);

      showPanel.value = false;
      await nextTick();
      handle.view.value?.fitBounds(JIANGSU);

      expect(map.fitBoundsCalls.at(-1)).toEqual({ padding: { top: 16, right: 16, bottom: 16, left: 16 } });
    } finally {
      host.remove();
    }
  });

  it('登记的作用域销毁时注销：元素还在文档里也不再避开', async () => {
    const host = document.body.appendChild(document.createElement('div'));
    // 由外部管理的元素：登记它的组件卸载后，元素仍然在文档里
    const external = host.appendChild(document.createElement('aside'));
    vi.spyOn(external, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ x: 1104, y: 16, width: 320, height: 588 })
    );
    const registered = ref(true);
    const Registrar = defineComponent(() => {
      useMapOverlay(ref(external), 'right');
      return () => null;
    });
    const maps: FakeMap[] = [];
    let handle: MapHandle<'basemap'> | undefined;
    try {
      mount(
        defineComponent(() => {
          handle = provideMap({ groups: ['basemap'], camera: CAMERA });
          return () => (
            <div>
              <MapCanvas createMap={createFakeMap(maps)} />
              {registered.value && <Registrar />}
            </div>
          );
        }),
        { attachTo: host }
      );
      vi.spyOn(maps[0]?.options.container as HTMLElement, 'getBoundingClientRect').mockReturnValue(
        DOMRect.fromRect({ x: 0, y: 0, width: 1440, height: 620 })
      );
      expect(handle?.overlayPadding().right).toBe(352);

      registered.value = false;
      await nextTick();

      expect(external.isConnected).toBe(true);
      expect(handle?.overlayPadding().right).toBe(16);
    } finally {
      host.remove();
    }
  });

  it('失败原因：样式失败时是 style，出现新版本重新加载后清空；样式失败时 retry 不重建', async () => {
    const { context, maps, session } = setup();
    const invalid = new Error('layers[0].paint.line-width: number expected');

    maps[0]?.fire('error', { error: invalid });
    expect(context.viewState.value).toBe('failed');
    expect(context.failure.value).toEqual({ kind: 'style', error: invalid });

    context.retry();
    await nextTick();
    expect(maps).toHaveLength(1);

    session.style.setGroup('basemap', { sources: {}, layers: [] });
    await nextTick();
    expect(context.viewState.value).toBe('initializing');
    expect(context.failure.value).toBeNull();
  });

  it('引擎失败后 retry：在同一个容器里重新创建视图；没有失败时 retry 什么也不做', async () => {
    let attempts = 0;
    const maps: FakeMap[] = [];
    const createMap = (options: MapLibreMapOptions) => {
      attempts++;
      if (attempts === 1) {
        throw new Error('创建地图失败');
      }
      const map = new FakeMap(options);
      maps.push(map);
      return map;
    };
    let handle: MapHandle<'basemap'> | undefined;
    const wrapper = mount(
      defineComponent(() => {
        handle = provideMap({ groups: ['basemap'], camera: CAMERA, onError: () => undefined });
        return () => <MapCanvas createMap={createMap} />;
      })
    );
    if (!handle) {
      throw new Error('没有挂载');
    }
    const container = wrapper.find('[class*="_container_"]').element;
    expect(handle.failure.value).toEqual({ kind: 'engine', cause: 'unknown', error: new Error('创建地图失败') });

    // 重建时要先释放旧视图，否则挂上新视图会抛错
    handle.retry();
    await expect(nextTick()).resolves.toBeUndefined();

    expect(attempts).toBe(2);
    expect(maps[0]?.options.container).toBe(container);
    expect(handle.viewState.value).toBe('initializing');
    expect(handle.failure.value).toBeNull();

    maps[0]?.fire('style.load');
    handle.retry();
    await nextTick();
    expect(attempts).toBe(2);
    expect(handle.viewState.value).toBe('ready');
  });

  it('useMapOverlay 必须放在 provideMap 的组件里', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const Orphan = defineComponent(() => {
        useMapOverlay(ref<HTMLElement>(), 'left');
        return () => null;
      });
      expect(() => mount(Orphan)).toThrow('useMapOverlay 必须放在调用了 provideMap 的组件里面');
    } finally {
      warn.mockRestore();
    }
  });

  it('释放视图出错、报告器也抛错时，画布照常卸载，会话照常释放', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const dispose = vi.spyOn(MapLibreView.prototype, Symbol.dispose).mockImplementation(() => {
      throw new Error('释放视图失败');
    });
    try {
      let session: MapSession<string> | undefined;
      const Probe = defineComponent(() => {
        session = inject(INTERNAL_MAP_CONTEXT)?.session;
        return () => null;
      });
      const maps: FakeMap[] = [];
      const wrapper = mount(
        defineComponent(() => {
          provideMap({
            groups: ['basemap'],
            camera: CAMERA,
            onError: () => {
              throw new Error('报告器出错');
            }
          });
          return () => (
            <div>
              <MapCanvas createMap={createFakeMap(maps)} />
              <Probe />
            </div>
          );
        })
      );

      expect(() => wrapper.unmount()).not.toThrow();
      expect(() => session?.style.on('change', () => undefined)).toThrow('StyleModel 已释放');
    } finally {
      dispose.mockRestore();
      consoleError.mockRestore();
    }
  });
});
