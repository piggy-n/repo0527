// @vitest-environment node
import {
  type CameraState,
  type FitBoundsOptions,
  type MapInputEvent,
  type MapView,
  type MapViewFailure,
  MapSession,
  NO_SCENE_STATUS,
  NO_SOURCE_ERRORS,
  type PickResult,
  type RenderedFeature,
  type ScreenPoint,
  type RoamStatus,
  type SceneStatus,
  type SourceErrors,
  type ToolView,
  type Unsubscribe,
  type ViewBounds,
  type ViewKind,
  type ViewState
} from '@yzt/map-core';
import { describe, expect, it, vi } from 'vitest';
import { createApp, ref } from 'vue';
import { type CameraControl, type FrameScheduler, INTERNAL_MAP_CONTEXT, MapContextState } from './context';
import { type Box, resolveOverlayOptions } from './overlay';
import { useMapOverlay } from './use-map';

// 卸下之后仍会发事件的视图：MapLibreView 释放时会清空监听，接口本身并不保证这一点
class FakeView implements MapView {
  readonly kind: ViewKind;
  // 上下文让它暂停、恢复的次数；状态变化由用例用 emit 模拟
  pauseCalls = 0;
  resumeCalls = 0;
  readonly flyToCalls: Partial<CameraState>[] = [];
  readonly fitBoundsCalls: (FitBoundsOptions | undefined)[] = [];
  state: ViewState = 'initializing';
  failure: MapViewFailure | null = null;
  sourceErrors: SourceErrors = NO_SOURCE_ERRORS;
  // 这一轮整体加载的结果，测试可以换成还没结束的 Promise
  ready: Promise<void> = Promise.resolve();
  readonly #listeners = new Map<string, Set<(payload: unknown) => void>>();

  constructor(kind: ViewKind = '2d') {
    this.kind = kind;
  }

  whenReady(): Promise<void> {
    return this.ready;
  }
  pause(): void {
    this.pauseCalls++;
  }
  resume(): void {
    this.resumeCalls++;
  }
  flyTo(target: Partial<CameraState>): void {
    this.flyToCalls.push(target);
  }
  fitBounds(_bounds: ViewBounds, options?: FitBoundsOptions): void {
    this.fitBoundsCalls.push(options);
  }
  // reveal 用到的投影结果；拾取到的经纬度就是屏幕坐标，surface 为 null 时拾取不到
  projected: ScreenPoint | null = null;
  pickSurface: 'map' | null = null;
  pick({ x, y }: ScreenPoint): PickResult {
    return this.pickSurface ? { kind: 'hit', surface: this.pickSurface, lngLat: [x, y] } : { kind: 'miss' };
  }
  project(): ScreenPoint | null {
    return this.projected;
  }
  // queryRendered 收到的参数和要返回的要素
  readonly queries: unknown[][] = [];
  rendered: RenderedFeature[] = [];
  queryRendered(...args: unknown[]): RenderedFeature[] {
    this.queries.push(args);
    return this.rendered;
  }

  on(event: 'statechange', callback: (state: ViewState) => void): Unsubscribe;
  on(event: 'resize', callback: () => void): Unsubscribe;
  on(event: 'settle', callback: () => void): Unsubscribe;
  on(event: 'sourceerrorchange', callback: (errors: SourceErrors) => void): Unsubscribe;
  on(event: string, callback: (payload: never) => void): Unsubscribe {
    // 和 MapLibreView 一样，释放后不能再订阅
    if (this.disposed) {
      throw new Error('FakeView 已释放');
    }
    // 各个重载的回调只接收自己那种事件的参数
    const listener = callback as (payload: unknown) => void;
    const listeners = this.#listeners.get(event) ?? new Set();
    this.#listeners.set(event, listeners.add(listener));
    return () => listeners.delete(listener);
  }

  emit(state: ViewState): void {
    this.state = state;
    this.#fire('statechange', state);
  }

  /** 模拟画布尺寸变化 */
  resize(): void {
    this.#fire('resize', undefined);
  }

  /** 模拟画面稳定 */
  settleDown(): void {
    this.#fire('settle', undefined);
  }

  listenerCount(event: string): number {
    return this.#listeners.get(event)?.size ?? 0;
  }

  /** 模拟数据源错误的记录变化 */
  setSourceErrors(errors: SourceErrors): void {
    this.sourceErrors = errors;
    this.#fire('sourceerrorchange', errors);
  }

  disposed = false;

  [Symbol.dispose](): void {
    this.disposed = true;
  }

  #fire(event: string, payload: unknown): void {
    for (const listener of this.#listeners.get(event) ?? []) {
      listener(payload);
    }
  }
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

  it('数据源错误：挂上时取视图的记录，变化时更新；卸下后为空，换上的新视图从它自己的记录开始', () => {
    using env = setup();
    const first = new FakeView();
    const failed: SourceErrors = new Map([['resources-szy_kt', new Error('tile')]]);
    first.sourceErrors = failed;
    env.state.attachView(first, CANVAS);
    expect(env.state.context.sourceErrors.value).toBe(failed);

    const more: SourceErrors = new Map([...failed, ['boundaries-city', new Error('404')]]);
    first.setSourceErrors(more);
    expect(env.state.context.sourceErrors.value).toBe(more);

    env.state.detachView(first);
    expect(env.state.context.sourceErrors.value).toBe(NO_SOURCE_ERRORS);
    first.setSourceErrors(failed);
    expect(env.state.context.sourceErrors.value).toBe(NO_SOURCE_ERRORS);

    const second = new FakeView();
    env.state.attachView(second, CANVAS);
    expect(env.state.context.sourceErrors.value).toBe(NO_SOURCE_ERRORS);
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

describe('MapContextState 的选择', () => {
  const PADDY = { sourceId: 'resources-bgdc_dltb', featureId: 'a' };
  const RIVER = { sourceId: 'resources-csxhjctb_hydl', featureId: 'b' };

  it('selection 从会话已有的选择开始，跟随会话变化；select、clearSelection 写进会话；上下文释放后不再跟随', () => {
    const camera = { center: [119.4, 32.9] as const, zoom: 7, bearing: 0, pitch: 0 };
    using session = new MapSession({ groups: ['basemap'], camera });
    session.selection.set([PADDY]);
    const state = new MapContextState(session, () => undefined, resolveOverlayOptions());
    const { context } = state;
    expect(context.selection.value).toBe(session.selection.current);

    context.select([RIVER]);
    expect(session.selection.current).toStrictEqual([RIVER]);
    expect(context.selection.value).toBe(session.selection.current);
    session.selection.set([PADDY, RIVER]);
    expect(context.selection.value).toStrictEqual([PADDY, RIVER]);
    context.clearSelection();
    expect(session.selection.current).toStrictEqual([]);
    expect(context.selection.value).toStrictEqual([]);

    state[Symbol.dispose]();
    session.selection.set([PADDY]);
    expect(context.selection.value).toStrictEqual([]);
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

// 由测试推进的下一帧
function manualFrames() {
  const callbacks = new Set<() => void>();
  const schedule: FrameScheduler = callback => {
    callbacks.add(callback);
    return () => callbacks.delete(callback);
  };
  return {
    schedule,
    get pending() {
      return callbacks.size;
    },
    flush() {
      const due = [...callbacks];
      callbacks.clear();
      for (const callback of due) {
        callback();
      }
    }
  };
}

const NO_MODIFIERS = { shift: false, ctrl: false, alt: false, meta: false };

function pointerEvent(type: 'move' | 'leave' | 'down', x: number, y: number): MapInputEvent {
  return { type, point: { x, y }, button: 0, clickCount: 0, modifiers: NO_MODIFIERS };
}

const VIEW_3D: ToolView = { kind: '3d', pick: () => ({ kind: 'miss' }), project: () => null, queryRendered: () => [] };

function setupPointer() {
  const camera = { center: [119.4, 32.9] as const, zoom: 7, bearing: 0, pitch: 0 };
  const session = new MapSession({ groups: ['basemap'], camera });
  const frames = manualFrames();
  const state = new MapContextState(session, () => undefined, resolveOverlayOptions(), frames.schedule);
  const view = new FakeView();
  state.attachView(view, CANVAS);
  return {
    session,
    state,
    frames,
    view,
    pointer: state.context.pointer,
    input: (event: MapInputEvent, target: ToolView = view) => session.tool.dispatch(event, target),
    [Symbol.dispose]() {
      state[Symbol.dispose]();
      session[Symbol.dispose]();
    }
  };
}

describe('MapContextState 的鼠标位置', () => {
  it('一帧里多次移动只更新一次，取最后的位置；按下、抬起也算移动，按键不算；离开画布时为 null', () => {
    using ctx = setupPointer();
    ctx.view.emit('ready');

    ctx.input(pointerEvent('move', 10, 20));
    ctx.input(pointerEvent('down', 30, 40));
    ctx.input({ type: 'key', key: 'Escape' });
    expect(ctx.frames.pending).toBe(1);
    expect(ctx.pointer.value).toBeNull();

    ctx.frames.flush();
    expect(ctx.pointer.value).toStrictEqual({ x: 30, y: 40 });

    ctx.input(pointerEvent('leave', 50, 60));
    ctx.frames.flush();
    expect(ctx.pointer.value).toBeNull();
  });

  it('视图不在就绪时不跟踪；视图失败、卸下时清空，并取消还没写入的那一帧', () => {
    using ctx = setupPointer();
    ctx.input(pointerEvent('move', 10, 20));
    expect(ctx.frames.pending).toBe(0);

    ctx.view.emit('ready');
    ctx.input(pointerEvent('move', 10, 20));
    ctx.frames.flush();
    ctx.input(pointerEvent('move', 30, 40));
    ctx.view.emit('failed');
    expect(ctx.pointer.value).toBeNull();
    expect(ctx.frames.pending).toBe(0);

    ctx.view.emit('ready');
    ctx.input(pointerEvent('move', 10, 20));
    ctx.frames.flush();
    ctx.state.detachView(ctx.view);
    expect(ctx.pointer.value).toBeNull();
  });

  it('只跟踪当前视图的输入；上下文释放后清空，不再跟踪', () => {
    using ctx = setupPointer();
    ctx.view.emit('ready');

    ctx.input(pointerEvent('move', 10, 20), VIEW_3D);
    expect(ctx.frames.pending).toBe(0);

    ctx.input(pointerEvent('move', 30, 40));
    ctx.frames.flush();
    ctx.input(pointerEvent('move', 50, 60));
    ctx.state[Symbol.dispose]();
    expect(ctx.pointer.value).toBeNull();
    expect(ctx.frames.pending).toBe(0);

    ctx.input(pointerEvent('move', 70, 80));
    expect(ctx.frames.pending).toBe(0);
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

  it('view 的渲染要素查询原样转发给视图，返回视图的结果', () => {
    using env = setup();
    const view = new FakeView();
    view.state = 'ready';
    view.rendered = [{ sourceId: 'resources-bgdc_dltb', layerId: 'resources-bgdc_dltb', properties: { guid: 'a' } }];
    env.state.attachView(view, CANVAS);
    const options = { sources: ['resources-bgdc_dltb'], withGeometry: true };

    expect(env.state.context.view.value?.queryRendered({ x: 1, y: 2 }, options)).toBe(view.rendered);
    expect(view.queries).toStrictEqual([[{ x: 1, y: 2 }, options]]);
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

  it('作废上一次操作的回调里又开始了新的操作：新的那次执行，外层这次不执行', () => {
    using env = setup();
    const view = new FakeView();
    env.state.attachView(view, CANVAS);
    const { context } = env.state;
    const done: string[] = [];
    context.currentCameraOperation().signal.addEventListener(
      'abort',
      () => context.runCameraOperation(() => done.push('回调里开始的')),
      { once: true }
    );

    context.runCameraOperation(() => done.push('外层'));
    view.emit('ready');

    expect(done).toStrictEqual(['回调里开始的']);
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

describe('MapContextState 的 whenSettled', () => {
  it('等到视图的下一次画面稳定，之后取消订阅', async () => {
    using env = setup();
    const view = new FakeView();
    env.state.attachView(view, CANVAS);
    view.emit('ready');
    const waiting = env.state.context.whenSettled();
    await settle();
    expect(await settled(waiting)).toBe('pending');

    view.settleDown();

    expect(await settled(waiting)).toBe('resolved');
    expect(view.listenerCount('settle')).toBe(0);
  });

  it('还没有视图时等视图挂上，再等它的画面稳定', async () => {
    using env = setup();
    const waiting = env.state.context.whenSettled();
    const view = new FakeView();
    env.state.attachView(view, CANVAS);
    await settle();

    view.settleDown();

    expect(await settled(waiting)).toBe('resolved');
  });

  it('等待中的视图被卸下：以 AbortError 结束、取消订阅，换上的视图稳定也不算', async () => {
    using env = setup();
    const first = new FakeView();
    env.state.attachView(first, CANVAS);
    const waiting = env.state.context.whenSettled();
    await settle();

    env.state.detachView(first);
    const second = new FakeView();
    env.state.attachView(second, CANVAS);
    second.settleDown();

    expect(await settled(waiting)).toBe('AbortError');
    expect(first.listenerCount('settle')).toBe(0);
  });

  it('等到视图挂上的同一轮里它又被卸下、释放：以 AbortError 结束，不订阅已释放的视图', async () => {
    using env = setup();
    const waiting = env.state.context.whenSettled();
    const view = new FakeView();
    env.state.attachView(view, CANVAS);
    // 画布组件卸载时先卸下、再释放视图
    env.state.detachView(view);
    view[Symbol.dispose]();

    expect(await settled(waiting)).toBe('AbortError');
    expect(view.listenerCount('settle')).toBe(0);
  });

  it('signal 中止、上下文释放时结束等待并取消订阅', async () => {
    const env = setup();
    const view = new FakeView();
    env.state.attachView(view, CANVAS);
    const controller = new AbortController();
    const bySignal = env.state.context.whenSettled(controller.signal);
    const byDispose = env.state.context.whenSettled();
    await settle();

    controller.abort();
    expect(await settled(bySignal)).toBe('AbortError');
    env[Symbol.dispose]();

    expect(await settled(byDispose)).toBe('AbortError');
    expect(view.listenerCount('settle')).toBe(0);
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

  it('相机控制的 reveal：被挡住时把平移后的画布中心对应的位置作为中心，不缩放、不加 padding', () => {
    using env = setup();
    const view = new FakeView();
    view.pickSurface = 'map';
    env.state.attachView(view, CANVAS);
    view.emit('ready');
    // 贴右边、高 300 的面板：可视区域的右边是 1440 - 352 = 1088
    env.state.registerOverlay(ref(fakeElement(box(1104, 16, 320, 300))), 'right');
    const reveal = (point: ScreenPoint | null) => {
      view.projected = point;
      env.state.context.runCameraOperation(camera => camera.reveal([120, 32]));
    };

    reveal({ x: 1200, y: 100 });
    // 点要向左挪 112，画布中心 (720, 310) 向右 112 处的位置成为新的中心
    expect(view.flyToCalls).toStrictEqual([{ center: [832, 310] }]);
  });

  it('reveal 在没被挡住、投影不到、拾取不到时不动', () => {
    using env = setup();
    const view = new FakeView();
    env.state.attachView(view, CANVAS);
    view.emit('ready');
    env.state.registerOverlay(ref(fakeElement(box(1104, 16, 320, 300))), 'right');
    const reveal = (point: ScreenPoint | null) => {
      view.projected = point;
      env.state.context.runCameraOperation(camera => camera.reveal([120, 32]));
    };

    reveal({ x: 1200, y: 400 });
    reveal(null);
    reveal({ x: 1200, y: 100 });

    expect(view.flyToCalls).toStrictEqual([]);
    expect(env.errors).toStrictEqual([]);
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

// 三维视图：另外报告三维内容的状态（ADR 0081 第 2 节）
class SceneFakeView extends FakeView {
  sceneStatus: SceneStatus = NO_SCENE_STATUS;
  roamStatus: RoamStatus | null = null;
  readonly #sceneListeners = new Set<(status: SceneStatus) => void>();
  readonly #roamListeners = new Set<(status: RoamStatus | null) => void>();

  constructor() {
    super('3d');
  }

  onSceneStatusChange(callback: (status: SceneStatus) => void): Unsubscribe {
    this.#sceneListeners.add(callback);
    return () => this.#sceneListeners.delete(callback);
  }

  setSceneStatus(status: SceneStatus): void {
    this.sceneStatus = status;
    this.#sceneListeners.forEach(listener => listener(status));
  }

  onRoamStatusChange(callback: (status: RoamStatus | null) => void): Unsubscribe {
    this.#roamListeners.add(callback);
    return () => this.#roamListeners.delete(callback);
  }

  setRoamStatus(status: RoamStatus | null): void {
    this.roamStatus = status;
    this.#roamListeners.forEach(listener => listener(status));
  }

  get sceneListeners(): number {
    return this.#sceneListeners.size + this.#roamListeners.size;
  }
}

describe('MapContextState 的三维内容状态（ADR 0081 第 2 节）', () => {
  it('只反映当前三维视图的报告；切回二维时为空，再切回三维时取视图现在的状态；卸下时退订', () => {
    using env = setup();
    const flat = new FakeView('2d');
    const globe = new SceneFakeView();
    env.state.attachView(flat, CANVAS);
    env.state.attachView(globe, CANVAS);
    const loading: SceneStatus = new Map([['station', { state: 'loading' }]]);

    // 二维是当前视图：三维的报告不反映
    globe.setSceneStatus(loading);
    expect(env.state.context.sceneStatus.value).toBe(NO_SCENE_STATUS);

    env.state.context.setDimension('3d');
    expect(env.state.context.sceneStatus.value).toBe(loading);
    const failed: SceneStatus = new Map([['station', { state: 'failed', error: new Error('404') }]]);
    globe.setSceneStatus(failed);
    expect(env.state.context.sceneStatus.value).toBe(failed);

    env.state.context.setDimension('2d');
    expect(env.state.context.sceneStatus.value).toBe(NO_SCENE_STATUS);

    env.state.detachView(globe);
    expect(globe.sceneListeners).toBe(0);
  });

  it('漫游的进度同样只反映当前三维视图（ADR 0083）', () => {
    using env = setup();
    const flat = new FakeView('2d');
    const globe = new SceneFakeView();
    env.state.attachView(flat, CANVAS);
    env.state.attachView(globe, CANVAS);
    const walking: RoamStatus = { id: 'enter', run: 0, distance: 12, total: 120, finished: false };

    globe.setRoamStatus(walking);
    expect(env.state.context.roamStatus.value).toBeNull();
    env.state.context.setDimension('3d');
    expect(env.state.context.roamStatus.value).toBe(walking);
    globe.setRoamStatus(null);
    expect(env.state.context.roamStatus.value).toBeNull();
    globe.setRoamStatus(walking);
    env.state.context.setDimension('2d');
    expect(env.state.context.roamStatus.value).toBeNull();
  });
});

describe('MapContextState 的二三维切换（ADR 0079 第 8 节）', () => {
  it('默认二维；切到三维时二维暂停，还没有三维视图时是 idle，三维视图挂上后反映它', () => {
    using env = setup();
    const flat = new FakeView('2d');
    env.state.attachView(flat, CANVAS);
    flat.emit('ready');
    expect(env.state.context.dimension.value).toBe('2d');

    env.state.context.setDimension('3d');
    expect(flat.pauseCalls).toBe(1);
    expect(env.state.context.viewState.value).toBe('idle');
    expect(env.state.context.view.value).toBeNull();

    const globe = new FakeView('3d');
    globe.state = 'ready';
    env.state.attachView(globe, CANVAS);
    expect(env.state.context.viewState.value).toBe('ready');
    expect(env.state.context.view.value?.kind).toBe('3d');
  });

  it('切回二维：三维暂停、二维恢复；不是当前种类的视图的事件不反映到上下文', () => {
    using env = setup();
    const flat = new FakeView('2d');
    const globe = new FakeView('3d');
    env.state.attachView(flat, CANVAS);
    flat.emit('ready');
    env.state.attachView(globe, CANVAS);
    const revision = env.state.context.projectionRevision.value;

    // 三维不是当前的：它的状态、尺寸、数据源错误都不影响上下文
    globe.emit('failed');
    globe.resize();
    globe.setSourceErrors(new Map([['basemap-imagery', new Error('404')]]));
    expect(env.state.context.viewState.value).toBe('ready');
    expect(env.state.context.projectionRevision.value).toBe(revision);
    expect(env.state.context.sourceErrors.value).toBe(NO_SOURCE_ERRORS);

    env.state.context.setDimension('3d');
    expect(env.state.context.viewState.value).toBe('failed');
    expect(globe.resumeCalls).toBe(1);
    // 换了视图，屏幕投影跟着变
    expect(env.state.context.projectionRevision.value).toBe(revision + 1);

    env.state.context.setDimension('2d');
    expect(globe.pauseCalls).toBe(1);
    expect(flat.resumeCalls).toBe(1);
    expect(env.state.context.view.value?.kind).toBe('2d');
  });

  it('同一种视图只能有一个画布，两种视图可以同时挂上；切到同一种不做任何事', () => {
    using env = setup();
    env.state.attachView(new FakeView('2d'), CANVAS);
    env.state.attachView(new FakeView('3d'), CANVAS);

    expect(() => env.state.attachView(new FakeView('3d'), CANVAS)).toThrow('每种视图只能有一个画布：3d');
    const revision = env.state.context.projectionRevision.value;
    env.state.context.setDimension('2d');
    expect(env.state.context.projectionRevision.value).toBe(revision);
  });

  it('shouldRun：页面没有停用、并且是当前种类时才运行；停用时暂停当前视图，激活时恢复，重复调用不起作用', () => {
    using env = setup();
    const flat = new FakeView('2d');
    env.state.attachView(flat, CANVAS);
    expect(env.state.shouldRun('2d')).toBe(true);
    expect(env.state.shouldRun('3d')).toBe(false);

    env.state.setPageActive(false);
    env.state.setPageActive(false);
    expect(flat.pauseCalls).toBe(1);
    expect(env.state.shouldRun('2d')).toBe(false);

    // 停用期间切换种类：不恢复新的视图，也不再暂停旧的
    const globe = new FakeView('3d');
    env.state.attachView(globe, CANVAS);
    env.state.context.setDimension('3d');
    expect(globe.resumeCalls).toBe(0);
    expect(flat.pauseCalls).toBe(1);

    env.state.setPageActive(true);
    expect(globe.resumeCalls).toBe(1);
    expect(flat.resumeCalls).toBe(0);
  });

  it('等待中的相机操作：切到三维后，三维视图挂上并就绪时执行', () => {
    using env = setup();
    const flat = new FakeView('2d');
    env.state.attachView(flat, CANVAS);
    env.state.context.setDimension('3d');
    const zooms: number[] = [];

    env.state.context.runCameraOperation(camera => camera.flyTo({ zoom: 12 }));
    const globe = new FakeView('3d');
    env.state.attachView(globe, CANVAS);
    expect(globe.flyToCalls).toStrictEqual([]);
    globe.emit('ready');

    zooms.push(...globe.flyToCalls.map(({ zoom }) => zoom ?? -1));
    expect(zooms).toStrictEqual([12]);
    expect(flat.flyToCalls).toStrictEqual([]);
  });

  it('等待中的二维视图在切到三维时以 AbortError 结束，三维就绪不算它就绪', async () => {
    using env = setup();
    const { view: flat } = pendingView();
    env.state.attachView(flat, CANVAS);
    const waiting = env.state.context.whenReady();

    env.state.context.setDimension('3d');

    expect(await settled(waiting)).toBe('AbortError');
  });

  it('切换种类时清掉鼠标位置：新视图的输入来了再跟踪', () => {
    const frames: (() => void)[] = [];
    const camera = { center: [119.4, 32.9] as const, zoom: 7, bearing: 0, pitch: 0 };
    using session = new MapSession({ groups: ['basemap'], camera });
    using state = new MapContextState(session, () => undefined, resolveOverlayOptions(), callback => {
      frames.push(callback);
      return () => undefined;
    });
    const flat = new FakeView('2d');
    state.attachView(flat, CANVAS);
    flat.emit('ready');
    const toolView: ToolView = {
      kind: '2d',
      pick: () => ({ kind: 'miss' }),
      project: () => null,
      queryRendered: () => []
    };
    const move: MapInputEvent = {
      type: 'move',
      point: { x: 3, y: 4 },
      button: 0,
      clickCount: 0,
      modifiers: { shift: false, ctrl: false, alt: false, meta: false }
    };
    session.tool.dispatch(move, toolView);
    frames.splice(0).forEach(frame => frame());
    expect(state.context.pointer.value).toStrictEqual({ x: 3, y: 4 });

    state.context.setDimension('3d');

    expect(state.context.pointer.value).toBeNull();
  });
});
