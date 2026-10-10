// @vitest-environment node
import {
  type CameraState,
  type FitBoundsOptions,
  type MapView,
  type MapViewFailure,
  MapSession,
  type PickResult,
  type ScreenPoint,
  type Unsubscribe,
  type ViewBounds,
  type ViewState
} from '@yzt/map-core';
import { describe, expect, it, vi } from 'vitest';
import { createApp, ref } from 'vue';
import { type CameraControl, INTERNAL_MAP_CONTEXT, MapContextState } from './context';
import { type Box, resolveOverlayOptions } from './overlay';
import { useMapOverlay } from './use-map';

// 卸下之后仍会发事件的视图：MapLibreView 释放时会清空监听，接口本身并不保证这一点
class FakeView implements MapView {
  readonly kind = '2d';
  readonly flyToCalls: Partial<CameraState>[] = [];
  readonly fitBoundsCalls: (FitBoundsOptions | undefined)[] = [];
  state: ViewState = 'initializing';
  failure: MapViewFailure | null = null;
  // 这一轮整体加载的结果，测试可以换成还没结束的 Promise
  ready: Promise<void> = Promise.resolve();
  readonly #listeners = new Map<string, Set<(state: ViewState) => void>>();

  whenReady(): Promise<void> {
    return this.ready;
  }
  pause(): void {}
  resume(): void {}
  flyTo(target: Partial<CameraState>): void {
    this.flyToCalls.push(target);
  }
  fitBounds(_bounds: ViewBounds, options?: FitBoundsOptions): void {
    this.fitBoundsCalls.push(options);
  }
  pick(): PickResult {
    return { kind: 'miss' };
  }
  project(): ScreenPoint | null {
    return null;
  }

  on(event: 'statechange', callback: (state: ViewState) => void): Unsubscribe;
  on(event: 'resize', callback: () => void): Unsubscribe;
  on(event: string, callback: (state: ViewState) => void): Unsubscribe {
    const listeners = this.#listeners.get(event) ?? new Set();
    this.#listeners.set(event, listeners.add(callback));
    return () => listeners.delete(callback);
  }

  emit(state: ViewState): void {
    this.state = state;
    for (const listener of this.#listeners.get('statechange') ?? []) {
      listener(state);
    }
  }

  /** 模拟画布尺寸变化 */
  resize(): void {
    for (const listener of this.#listeners.get('resize') ?? []) {
      listener(this.state);
    }
  }

  [Symbol.dispose](): void {}
}

// 由测试决定何时就绪的视图
function pendingView(): { view: FakeView; markReady: () => void } {
  const view = new FakeView();
  let resolveReady: (() => void) | undefined;
  view.ready = new Promise<void>(resolve => (resolveReady = resolve));
  return { view, markReady: () => resolveReady?.() };
}

// 立即可知的结果：还没结束的 Promise 得到 'pending'，测试因断言失败而不是超时
function settled(promise: Promise<unknown>): Promise<unknown> {
  return Promise.race([
    promise.then(
      () => 'resolved',
      (error: unknown) => (error instanceof DOMException ? error.name : error)
    ),
    new Promise(resolve => setTimeout(() => resolve('pending'), 0))
  ]);
}

// 只经过微任务的等待走完
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

// Node 环境里没有 DOM：只模拟量尺寸用到的两个属性
function fakeElement(rect: Box, isConnected = true): HTMLElement {
  return { isConnected, getBoundingClientRect: () => rect } as unknown as HTMLElement;
}

function box(left: number, top: number, width: number, height: number): Box {
  return { left, top, right: left + width, bottom: top + height };
}

const CANVAS = fakeElement(box(0, 0, 1440, 620));
const BOUNDS: ViewBounds = [116.3, 30.7, 121.9, 35.2];

function setup() {
  const camera = { center: [119.4, 32.9] as const, zoom: 7, bearing: 0, pitch: 0 };
  const session = new MapSession({ groups: ['basemap'], camera });
  const errors: unknown[] = [];
  const state = new MapContextState(session, error => errors.push(error), resolveOverlayOptions());
  return {
    state,
    session,
    errors,
    [Symbol.dispose]() {
      state[Symbol.dispose]();
      session[Symbol.dispose]();
    }
  };
}

describe('MapContextState', () => {
  it('卸下视图后，旧视图的事件不再改变视图状态', () => {
    using env = setup();
    const first = new FakeView();
    env.state.attachView(first, CANVAS);
    first.emit('ready');
    expect(env.state.context.viewState.value).toBe('ready');

    env.state.detachView(first);
    first.emit('failed');

    expect(env.state.context.viewState.value).toBe('idle');
    expect(env.state.context.view.value).toBeNull();
  });

  it('失败原因随状态变化更新，卸下视图后清空', () => {
    using env = setup();
    const view = new FakeView();
    env.state.attachView(view, CANVAS);
    const failure = { kind: 'style', error: new Error('invalid style') } as const;

    view.failure = failure;
    view.emit('failed');
    expect(env.state.context.failure.value).toBe(failure);

    env.state.detachView(view);
    expect(env.state.context.failure.value).toBeNull();
  });

  it('卸下的不是当前视图时不做任何事；卸下后可以挂上新的视图', () => {
    using env = setup();
    const first = new FakeView();
    const second = new FakeView();
    env.state.attachView(first, CANVAS);
    first.emit('ready');

    env.state.detachView(second);
    expect(env.state.context.view.value).not.toBeNull();

    env.state.detachView(first);
    second.state = 'paused';
    env.state.attachView(second, CANVAS);

    expect(env.state.context.viewState.value).toBe('paused');
  });
});

describe('MapContextState 的工具', () => {
  it('activeTool 跟随会话里的工具变化；上下文释放后不再跟随', () => {
    const camera = { center: [119.4, 32.9] as const, zoom: 7, bearing: 0, pitch: 0 };
    const session = new MapSession({ groups: ['basemap'], camera });
    session.tool.register('measure', { persistent: false });
    const state = new MapContextState(session, () => undefined, resolveOverlayOptions());

    session.tool.activate('measure');
    expect(state.context.activeTool.value).toBe('measure');

    state[Symbol.dispose]();
    session.tool.release('measure');

    expect(state.context.activeTool.value).toBe('measure');
    session[Symbol.dispose]();
  });
});

describe('MapContextState 的投影修订号', () => {
  it('相机变化、画布尺寸变化时加 1；卸下视图后不再跟随它的尺寸，上下文释放后不再跟随相机', () => {
    const camera = { center: [119.4, 32.9] as const, zoom: 7, bearing: 0, pitch: 0 };
    const session = new MapSession({ groups: ['basemap'], camera });
    const state = new MapContextState(session, () => undefined, resolveOverlayOptions());
    const view = new FakeView();
    state.attachView(view, CANVAS);
    const revision = state.context.projectionRevision;

    session.camera.set({ ...camera, zoom: 8 }, { view: '2d', cause: 'user' });
    expect(revision.value).toBe(1);
    view.resize();
    expect(revision.value).toBe(2);

    state.detachView(view);
    view.resize();
    expect(revision.value).toBe(2);
    state[Symbol.dispose]();
    session.camera.set({ ...camera, zoom: 9 }, { view: '2d', cause: 'user' });

    expect(revision.value).toBe(2);
    session[Symbol.dispose]();
  });
});

// 记下 abort 监听的登记与移除（spy 照常调用原方法），检查等待的相机操作有没有留下监听
function trackAbortListeners() {
  const add = vi.spyOn(AbortSignal.prototype, 'addEventListener');
  const remove = vi.spyOn(AbortSignal.prototype, 'removeEventListener');
  const pairs = (spy: typeof add) => spy.mock.calls.map(([, listener], index) => [spy.mock.contexts[index], listener]);
  return {
    get active() {
      const removed = pairs(remove);
      return pairs(add).filter(([signal, listener]) => !removed.some(([s, l]) => s === signal && l === listener)).length;
    },
    [Symbol.dispose]() {
      add.mockRestore();
      remove.mockRestore();
    }
  };
}

describe('MapContextState 的相机操作', () => {
  it('开始一次操作时上一次作废；currentCameraOperation 不开始新的操作，同一次操作返回同一个对象', () => {
    using env = setup();
    const { context } = env.state;
    const initial = context.currentCameraOperation();

    expect(context.currentCameraOperation()).toBe(initial);
    expect(initial.signal.aborted).toBe(false);
    const operation = context.beginCameraOperation();

    expect(initial.signal.aborted).toBe(true);
    expect(context.currentCameraOperation()).toBe(operation);
    expect(Object.isFrozen(operation)).toBe(true);
  });

  it('view 只在视图 ready 时有值，同一个视图的入口是同一个对象；卸下后为 null', () => {
    using env = setup();
    const { context } = env.state;
    const view = new FakeView();
    env.state.attachView(view, CANVAS);
    expect(context.view.value).toBeNull();

    view.emit('ready');
    const viewport = context.view.value;
    expect(viewport).not.toBeNull();
    for (const state of ['paused', 'failed', 'initializing'] as const) {
      view.emit(state);
      expect(context.view.value).toBeNull();
    }
    view.emit('ready');
    expect(context.view.value).toBe(viewport);

    env.state.detachView(view);
    expect(context.view.value).toBeNull();

    const ready = new FakeView();
    ready.state = 'ready';
    env.state.attachView(ready, CANVAS);
    expect(context.view.value).not.toBeNull();
  });

  it('runCameraOperation：视图就绪时同步执行，并作废之前没完成的操作', () => {
    using env = setup();
    const view = new FakeView();
    env.state.attachView(view, CANVAS);
    view.emit('ready');
    const earlier = env.state.context.beginCameraOperation();

    env.state.context.runCameraOperation(camera => camera.flyTo({ zoom: 9 }));

    expect(view.flyToCalls).toStrictEqual([{ zoom: 9 }]);
    expect(earlier.signal.aborted).toBe(true);
  });

  it('run：还没就绪时等到就绪再执行，暂停不算就绪；期间有新的操作时放弃', () => {
    using env = setup();
    const { context } = env.state;
    const view = new FakeView();
    env.state.attachView(view, CANVAS);
    const done: string[] = [];

    context.runCameraOperation(() => done.push('被作废'));
    context.runCameraOperation(() => done.push('最后一次'));
    view.emit('paused');
    expect(done).toStrictEqual([]);

    view.emit('ready');
    view.emit('paused');
    view.emit('ready');

    expect(done).toStrictEqual(['最后一次']);
  });

  it('run：等待期间引擎失败、视图被替换，新视图就绪后照样执行', () => {
    using env = setup();
    const failing = new FakeView();
    env.state.attachView(failing, CANVAS);
    const operation = env.state.context.beginCameraOperation();
    operation.run(camera => camera.fitBounds(BOUNDS));

    failing.failure = { kind: 'engine', cause: 'unknown', error: new Error('引擎失败') };
    failing.emit('failed');
    env.state.detachView(failing);
    const retried = new FakeView();
    env.state.attachView(retried, CANVAS);
    expect(retried.fitBoundsCalls).toHaveLength(0);
    retried.emit('ready');

    expect(failing.fitBoundsCalls).toHaveLength(0);
    expect(retried.fitBoundsCalls).toHaveLength(1);
  });

  it('run：等待期间样式失败、之后自动恢复，恢复就绪时执行', () => {
    using env = setup();
    const view = new FakeView();
    env.state.attachView(view, CANVAS);
    env.state.context.runCameraOperation(camera => camera.fitBounds(BOUNDS));

    view.failure = { kind: 'style', error: new Error('invalid style') };
    view.emit('failed');
    view.failure = null;
    view.emit('initializing');
    view.emit('ready');

    expect(view.fitBoundsCalls).toHaveLength(1);
  });

  it('run 只能调用一次，回调最多执行一次：执行之后视图再失败、恢复都不重放', () => {
    using env = setup();
    const view = new FakeView();
    env.state.attachView(view, CANVAS);
    const operation = env.state.context.currentCameraOperation();
    let runs = 0;

    operation.run(() => runs++);
    expect(() => operation.run(() => runs++)).toThrow('一次相机操作只能 run 一次');
    expect(() => env.state.context.currentCameraOperation().run(() => runs++)).toThrow('一次相机操作只能 run 一次');
    view.emit('ready');
    view.emit('failed');
    view.emit('initializing');
    view.emit('ready');

    expect(runs).toBe(1);
  });

  it('已经作废的操作 run 时不执行回调；上下文释放后 run 也不执行', () => {
    using env = setup();
    const view = new FakeView();
    env.state.attachView(view, CANVAS);
    view.emit('ready');
    const operation = env.state.context.beginCameraOperation();
    env.state.context.beginCameraOperation();
    let runs = 0;

    operation.run(() => runs++);
    env.state[Symbol.dispose]();
    env.state.context.runCameraOperation(() => runs++);

    expect(runs).toBe(0);
  });

  it('等待中的操作：挂上一个已经就绪的视图时执行', () => {
    using env = setup();
    let runs = 0;
    env.state.context.runCameraOperation(() => runs++);

    const ready = new FakeView();
    ready.state = 'ready';
    env.state.attachView(ready, CANVAS);

    expect(runs).toBe(1);
  });

  it('地图刚就绪时：等待中的操作先执行，就绪后才开始的新操作接着执行，最后停在新的定位', async () => {
    using env = setup();
    const { view, markReady } = pendingView();
    env.state.attachView(view, CANVAS);
    const { context } = env.state;
    // 先登记的等待者：等这一轮加载完成后发起新的定位（例如按地址里的参数定位）
    const locateWhenReady = async () => {
      await context.whenReady();
      context.runCameraOperation(camera => camera.flyTo({ zoom: 12 }));
    };
    void locateWhenReady();
    context.runCameraOperation(camera => camera.flyTo({ zoom: 9 }));

    view.emit('ready');
    markReady();
    await settle();

    expect(view.flyToCalls).toStrictEqual([{ zoom: 9 }, { zoom: 12 }]);
  });

  it('等待中的操作就绪时执行；它的回调里开始的新操作立即执行', () => {
    using env = setup();
    const view = new FakeView();
    env.state.attachView(view, CANVAS);
    const { context } = env.state;
    const initial = context.currentCameraOperation();
    const done: string[] = [];
    // 初始化在当前操作下等待；它的回调里开始了新的操作（新的操作作废了它自己，视图已经就绪，立即执行）
    initial.run(() => {
      done.push('初始化');
      context.runCameraOperation(() => done.push('回调里开始的操作'));
    });

    view.emit('ready');

    expect(done).toStrictEqual(['初始化', '回调里开始的操作']);
  });

  it('相机控制只在回调期间有效：存下来之后调用抛错；回调里开始了新的操作后，旧的控制什么也不做', () => {
    using env = setup();
    const view = new FakeView();
    env.state.attachView(view, CANVAS);
    view.emit('ready');
    const { context } = env.state;
    let saved: CameraControl | undefined;

    context.runCameraOperation(camera => {
      saved = camera;
      context.runCameraOperation(next => next.flyTo({ zoom: 12 }));
      camera.flyTo({ zoom: 9 });
      camera.fitBounds(BOUNDS);
    });
    // 回调期间视图不再就绪：这次操作的控制同样什么也不做
    context.runCameraOperation(camera => {
      view.emit('paused');
      camera.flyTo({ zoom: 11 });
      view.emit('ready');
    });

    expect(view.flyToCalls).toStrictEqual([{ zoom: 12 }]);
    expect(view.fitBoundsCalls).toStrictEqual([]);
    expect(() => saved?.flyTo({ zoom: 10 })).toThrow('相机控制只在 run 的回调期间有效');
    expect(() => saved?.fitBounds(BOUNDS)).toThrow('相机控制只在 run 的回调期间有效');
    expect(view.flyToCalls).toStrictEqual([{ zoom: 12 }]);
  });

  it('回调抛错交给 onError：就绪时同步执行、等到就绪再执行都一样，不抛给调用方', () => {
    using env = setup();
    const view = new FakeView();
    env.state.attachView(view, CANVAS);
    const waiting = new Error('等到就绪后出错');
    const immediate = new Error('立即执行时出错');

    env.state.context.runCameraOperation(() => {
      throw waiting;
    });
    view.emit('ready');
    expect(() =>
      env.state.context.runCameraOperation(() => {
        throw immediate;
      })
    ).not.toThrow();

    expect(env.errors).toStrictEqual([waiting, immediate]);
  });

  it('等待中的操作执行、被作废、上下文释放时移除监听；释放之后视图就绪也不执行', () => {
    using listeners = trackAbortListeners();
    const executed = setup();
    const superseded = setup();
    const released = setup();
    const views = [executed, superseded, released].map(env => {
      const view = new FakeView();
      env.state.attachView(view, CANVAS);
      env.state.context.runCameraOperation(camera => camera.flyTo({ zoom: 9 }));
      return view;
    });
    expect(listeners.active).toBeGreaterThan(0);

    views[0]?.emit('ready');
    superseded.state.context.beginCameraOperation();
    released.state[Symbol.dispose]();
    views[2]?.emit('ready');

    expect(listeners.active).toBe(0);
    expect(views.map(view => view.flyToCalls.length)).toStrictEqual([1, 0, 0]);
    for (const env of [executed, superseded, released]) {
      env[Symbol.dispose]();
    }
  });
});

describe('MapContextState 的 whenReady', () => {
  it('等待结束、返回之前 signal 中止（就绪的同一轮里排在后面的回调）：以中止结束，不算就绪', async () => {
    using env = setup();
    const { view, markReady } = pendingView();
    env.state.attachView(view, CANVAS);
    const controller = new AbortController();
    const waiting = env.state.context.whenReady(controller.signal);
    // 视图就绪时，这个回调排在 whenReady 的等待之后、它继续执行之前
    void view.ready.then(() => controller.abort());

    markReady();

    expect(await settled(waiting)).toBe('AbortError');
  });

  it('等待结束、返回之前视图被卸下（就绪的同一轮里排在后面的回调）：以 AbortError 结束', async () => {
    using env = setup();
    const { view, markReady } = pendingView();
    env.state.attachView(view, CANVAS);
    const waiting = env.state.context.whenReady();
    void view.ready.then(() => env.state.detachView(view));

    markReady();

    expect(await settled(waiting)).toBe('AbortError');
  });

  it('等待中的视图被替换：以 AbortError 结束，旧视图后来就绪也不算', async () => {
    using env = setup();
    const first = pendingView();
    env.state.attachView(first.view, CANVAS);
    const waiting = env.state.context.whenReady();

    env.state.detachView(first.view);
    env.state.attachView(pendingView().view, CANVAS);
    first.markReady();

    expect(await settled(waiting)).toBe('AbortError');
  });

  it('旧视图就绪的同一轮里被替换：不能当作就绪', async () => {
    using env = setup();
    const first = pendingView();
    env.state.attachView(first.view, CANVAS);
    const waiting = env.state.context.whenReady();

    first.markReady();
    env.state.detachView(first.view);
    env.state.attachView(pendingView().view, CANVAS);

    expect(await settled(waiting)).toBe('AbortError');
  });

  it('等到的第一个视图在就绪前被替换：同样以 AbortError 结束', async () => {
    using env = setup();
    const waiting = env.state.context.whenReady();
    const first = pendingView();
    env.state.attachView(first.view, CANVAS);
    await Promise.resolve();

    env.state.detachView(first.view);
    first.markReady();

    expect(await settled(waiting)).toBe('AbortError');
  });

  it('等待中的视图被卸下、它自己一直没有结果：立即以 AbortError 结束，不跟着挂起', async () => {
    using env = setup();
    const first = pendingView();
    env.state.attachView(first.view, CANVAS);
    const waiting = env.state.context.whenReady();

    env.state.detachView(first.view);

    expect(await settled(waiting)).toBe('AbortError');
  });

  it('视图没被替换时照常等到就绪', async () => {
    using env = setup();
    const first = pendingView();
    env.state.attachView(first.view, CANVAS);
    const waiting = env.state.context.whenReady();

    first.markReady();

    expect(await settled(waiting)).toBe('resolved');
  });
});

describe('MapContextState 的定位可视区域', () => {
  it('还没有画布时四边都是边距', () => {
    using env = setup();

    expect(env.state.context.overlayPadding()).toEqual({ top: 16, right: 16, bottom: 16, left: 16 });
  });

  it('按登记的元素此刻的位置计算；元素为空、不在文档里时不算，注销后不再算', () => {
    using env = setup();
    env.state.attachView(new FakeView(), CANVAS);
    const panel = ref<HTMLElement | null>(fakeElement(box(16, 16, 320, 588)));
    const detached = ref<HTMLElement>(fakeElement(box(1104, 16, 320, 588), false));
    const empty = ref<HTMLElement>();
    const unregister = env.state.registerOverlay(panel, 'left');
    env.state.registerOverlay(detached, 'right');
    env.state.registerOverlay(empty, 'top');

    expect(env.state.context.overlayPadding()).toEqual({ top: 16, right: 16, bottom: 16, left: 352 });

    // 面板收成窄条：下一次定位时量到的就是窄条
    panel.value = fakeElement(box(16, 16, 40, 588));
    expect(env.state.context.overlayPadding().left).toBe(72);

    unregister();
    expect(env.state.context.overlayPadding().left).toBe(16);
  });

  it('相机控制的 fitBounds 没传 padding 时避开悬浮元素，明确传入（包括 0）时以传入的为准', () => {
    using env = setup();
    const view = new FakeView();
    env.state.attachView(view, CANVAS);
    view.emit('ready');
    env.state.registerOverlay(ref(fakeElement(box(16, 16, 320, 588))), 'left');

    env.state.context.runCameraOperation(camera => {
      camera.fitBounds(BOUNDS, { duration: 0 });
      camera.fitBounds(BOUNDS, { padding: 0 });
      camera.fitBounds(BOUNDS, { padding: { top: 1, right: 2, bottom: 3, left: 4 } });
    });

    expect(view.fitBoundsCalls).toEqual([
      { duration: 0, padding: { top: 16, right: 16, bottom: 16, left: 352 } },
      { padding: 0 },
      { padding: { top: 1, right: 2, bottom: 3, left: 4 } }
    ]);
  });

  it('useMapOverlay 拿得到上下文、但不在作用域里时抛错，不留下注销不掉的登记', () => {
    using env = setup();
    const app = createApp({});
    app.provide(INTERNAL_MAP_CONTEXT, env.state);

    expect(() => app.runWithContext(() => useMapOverlay(ref<HTMLElement>(), 'left'))).toThrow(
      'useMapOverlay 只能在组件的 setup 或 effectScope 中调用'
    );
  });
});
