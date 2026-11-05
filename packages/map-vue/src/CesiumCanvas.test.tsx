import {
  type CameraState,
  type MapView,
  NO_SOURCE_ERRORS,
  type SourceErrors,
  type Unsubscribe,
  type ViewState
} from '@yzt/map-core';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick, onMounted, provide, ref } from 'vue';
import { CesiumCanvas, type SceneViewOptions } from './CesiumCanvas';
import { type MapHandle, provideMap } from './provide-map';
import { MAP_RUNTIME_PRELOAD, type MapRuntimePreloader } from './runtime';
import { injectMapState } from './use-map';

const CAMERA: CameraState = { center: [119.5, 33], zoom: 6.8, bearing: 0, pitch: 0 };

/** 以暂停状态创建的假三维视图：恢复时进入 ready */
class FakeSceneView implements MapView {
  readonly kind = '3d';
  state: ViewState = 'paused';
  failure = null;
  sourceErrors: SourceErrors = NO_SOURCE_ERRORS;
  resumed = 0;
  paused = 0;
  disposed = false;
  readonly #listeners = new Set<(state: ViewState) => void>();

  whenReady(): Promise<void> {
    return Promise.resolve();
  }

  pause(): void {
    this.paused++;
    this.#set('paused');
  }

  resume(): void {
    this.resumed++;
    this.#set('ready');
  }

  flyTo(): void {}
  fitBounds(): void {}
  pick() {
    return { kind: 'miss' } as const;
  }
  project() {
    return null;
  }
  queryRendered() {
    return [];
  }

  on(event: string, callback: (state: never) => void): Unsubscribe {
    if (event !== 'statechange') {
      return () => undefined;
    }
    const listener = callback as (state: ViewState) => void;
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  [Symbol.dispose](): void {
    this.disposed = true;
  }

  #set(state: ViewState): void {
    this.state = state;
    this.#listeners.forEach(listener => listener(state));
  }
}

// 由用例决定什么时候加载完成的视图工厂
function controlledFactory() {
  const requests: { options: SceneViewOptions; resolve: (view: MapView) => void; reject: (error: unknown) => void }[] =
    [];
  const createView = (options: SceneViewOptions) =>
    new Promise<MapView>((resolve, reject) => requests.push({ options, resolve, reject }));
  return { createView, requests };
}

function setup(createView: (options: SceneViewOptions) => Promise<MapView>) {
  const errors: unknown[] = [];
  const shown = ref(true);
  let handle: MapHandle<'basemap'> | undefined;
  const Page = defineComponent(() => {
    handle = provideMap({ groups: ['basemap'], camera: CAMERA, onError: error => errors.push(error) });
    return () => (shown.value ? <CesiumCanvas createView={createView} /> : null);
  });
  const wrapper = mount(Page);
  if (!handle) {
    throw new Error('没有创建地图句柄');
  }
  return { wrapper, map: handle, errors, shown };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('CesiumCanvas', () => {
  it('显示二维时不加载；第一次切到三维时创建，挂上后由上下文恢复，之后上下文反映它', async () => {
    const factory = controlledFactory();
    const { wrapper, map } = setup(factory.createView);
    await flush();
    expect(factory.requests).toHaveLength(0);
    expect(wrapper.get('[data-scene-canvas]').attributes('style')).toContain('visibility: hidden');

    map.setDimension('3d');
    await nextTick();
    expect(factory.requests).toHaveLength(1);
    expect(map.viewState.value).toBe('idle');
    const view = new FakeSceneView();
    factory.requests[0]?.resolve(view);
    await flush();

    expect(view.resumed).toBe(1);
    expect(map.viewState.value).toBe('ready');
    expect(map.view.value?.kind).toBe('3d');
    expect(wrapper.get('[data-scene-canvas]').attributes('style')).toBeUndefined();
  });

  it('加载期间切回二维：视图挂上但不恢复；切回三维时恢复，不再加载第二次', async () => {
    const factory = controlledFactory();
    const { map } = setup(factory.createView);
    await flush();
    map.setDimension('3d');
    await nextTick();
    map.setDimension('2d');
    const view = new FakeSceneView();
    factory.requests[0]?.resolve(view);
    await flush();
    expect(view.resumed).toBe(0);

    map.setDimension('3d');
    await nextTick();

    expect(view.resumed).toBe(1);
    expect(factory.requests).toHaveLength(1);
  });

  it('加载失败：挂上引擎失败的视图并报告；retry 重新加载，成功后换上新的视图', async () => {
    const factory = controlledFactory();
    const { map, errors } = setup(factory.createView);
    await flush();
    map.setDimension('3d');
    await nextTick();
    const error = new Error('分块加载失败');
    factory.requests[0]?.reject(error);
    await flush();

    expect(map.viewState.value).toBe('failed');
    expect(map.failure.value).toStrictEqual({ kind: 'engine', cause: 'unknown', error });
    expect(errors).toStrictEqual([error]);

    map.retry();
    await nextTick();
    expect(factory.requests).toHaveLength(2);
    factory.requests[1]?.resolve(new FakeSceneView());
    await flush();
    expect(map.viewState.value).toBe('ready');
  });

  it('加载期间卸载：加载到的视图直接释放，不挂上；卸载时释放已经挂上的视图', async () => {
    const factory = controlledFactory();
    const { map, shown } = setup(factory.createView);
    await flush();
    map.setDimension('3d');
    await nextTick();
    shown.value = false;
    await nextTick();
    const late = new FakeSceneView();
    factory.requests[0]?.resolve(late);
    await flush();
    expect(late.disposed).toBe(true);
    expect(map.viewState.value).toBe('idle');

    shown.value = true;
    await flush();
    await nextTick();
    const view = new FakeSceneView();
    factory.requests[1]?.resolve(view);
    await flush();
    shown.value = false;
    await nextTick();
    expect(view.disposed).toBe(true);
  });

  it('没有地图运行时、也没有给 createView 时，加载失败并说明原因', async () => {
    const errors: unknown[] = [];
    let handle: MapHandle<'basemap'> | undefined;
    mount(
      defineComponent(() => {
        handle = provideMap({ groups: ['basemap'], camera: CAMERA, onError: error => errors.push(error) });
        return () => <CesiumCanvas />;
      })
    );
    if (!handle) {
      throw new Error('没有创建地图句柄');
    }
    handle.setDimension('3d');
    await nextTick();
    await flush();

    expect(handle.viewState.value).toBe('failed');
    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toContain('没有地图运行时');
  });

  it('支持清单之外的图层的回调原样交给视图', async () => {
    const createView = vi.fn<(options: SceneViewOptions) => Promise<MapView>>(() =>
      Promise.resolve(new FakeSceneView())
    );
    const onUnsupported = vi.fn<(layer: { layerId: string; reason: string }) => void>();
    let handle: MapHandle<'basemap'> | undefined;
    mount(
      defineComponent(() => {
        handle = provideMap({ groups: ['basemap'], camera: CAMERA });
        return () => <CesiumCanvas createView={createView} onUnsupported={onUnsupported} />;
      })
    );
    handle?.setDimension('3d');
    await nextTick();

    expect(createView.mock.calls[0]?.[0].onUnsupported).toBe(onUnsupported);
  });
});

/** 假二维视图：恢复时进入 ready，由用例决定什么时候画面稳定 */
class FakeFlatView implements MapView {
  readonly kind = '2d';
  state: ViewState = 'paused';
  failure = null;
  sourceErrors: SourceErrors = NO_SOURCE_ERRORS;
  readonly #listeners = new Map<string, Set<(value: never) => void>>();

  whenReady(): Promise<void> {
    return Promise.resolve();
  }

  pause(): void {
    this.state = 'paused';
    this.#emit('statechange', 'paused');
  }

  resume(): void {
    this.state = 'ready';
    this.#emit('statechange', 'ready');
  }

  settle(): void {
    this.#emit('settle', undefined);
  }

  flyTo(): void {}
  fitBounds(): void {}
  pick() {
    return { kind: 'miss' } as const;
  }
  project() {
    return null;
  }
  queryRendered() {
    return [];
  }

  on(event: string, callback: (value: never) => void): Unsubscribe {
    const listeners = this.#listeners.get(event) ?? new Set();
    listeners.add(callback);
    this.#listeners.set(event, listeners);
    return () => listeners.delete(callback);
  }

  [Symbol.dispose](): void {}

  #emit(event: string, value: unknown): void {
    this.#listeners.get(event)?.forEach(listener => (listener as (value: unknown) => void)(value));
  }
}

// 页面放一个挂着假二维视图的画布和三维画布，provide 预加载的函数
function setupPreload() {
  const preload = vi.fn<MapRuntimePreloader>();
  const flat = new FakeFlatView();
  const factory = controlledFactory();
  const shown = ref(true);
  let handle: MapHandle<'basemap'> | undefined;
  const FlatCanvas = defineComponent(() => {
    const state = injectMapState('FlatCanvas');
    const element = ref<HTMLElement>();
    onMounted(() => {
      if (element.value) {
        state.attachView(flat, element.value);
        flat.resume();
      }
    });
    return () => <div ref={element} />;
  });
  mount(
    defineComponent(() => {
      handle = provideMap({ groups: ['basemap'], camera: CAMERA });
      provide(MAP_RUNTIME_PRELOAD, preload);
      return () => (
        <div>
          <FlatCanvas />
          {shown.value && <CesiumCanvas createView={factory.createView} />}
        </div>
      );
    })
  );
  if (!handle) {
    throw new Error('没有创建地图句柄');
  }
  return { preload, flat, factory, shown, map: handle };
}

describe('CesiumCanvas 的预加载（ADR 0091）', () => {

  it('二维第一次画面稳定以后请 app 预加载三维的运行时，只请求一次', async () => {
    const { preload, flat } = setupPreload();
    await flush();
    expect(preload).not.toHaveBeenCalled();

    flat.settle();
    await flush();
    flat.settle();
    await flush();

    expect(preload.mock.calls).toStrictEqual([['3d']]);
  });

  it('二维稳定之前就切到三维：不预加载，切换时照常加载', async () => {
    const { preload, flat, factory, map } = setupPreload();
    await flush();

    map.setDimension('3d');
    await nextTick();
    flat.settle();
    await flush();

    expect(preload).not.toHaveBeenCalled();
    expect(factory.requests).toHaveLength(1);
  });

  it('三维画布卸载以后不再预加载', async () => {
    const { preload, flat, shown } = setupPreload();
    await flush();

    shown.value = false;
    await nextTick();
    flat.settle();
    await flush();

    expect(preload).not.toHaveBeenCalled();
  });
});
