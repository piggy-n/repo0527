// @vitest-environment node
import {
  MapSession,
  NO_SOURCE_ERRORS,
  type MapView,
  type MapViewFailure,
  type PickResult,
  type RenderedFeature,
  type SourceErrors,
  type Unsubscribe,
  type ViewKind,
  type ViewState
} from '@yzt/map-core';
import { describe, expect, it, vi } from 'vitest';
import { MapContextState } from './context';
import { resolveOverlayOptions } from './overlay';
import { type LoadMapView, MapViewSwitch } from './view-switch';

// 可控的模块与样式加载，拒绝后也不会留下未处理的 Promise
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
}

// 等待只经过微任务；未结束时让断言失败，而不是等到用例超时
function outcome(promise: Promise<unknown>): Promise<unknown> {
  return Promise.race([
    promise.then(() => 'resolved', (error: unknown) => error),
    new Promise(resolve => setTimeout(() => resolve('pending'), 0))
  ]);
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

// 视图按真实接口保留每轮加载结果，暂停不会中断正在加载的样式
class FakeView implements MapView {
  readonly kind: ViewKind;
  state: ViewState = 'paused';
  failure: MapViewFailure | null = null;
  sourceErrors: SourceErrors = NO_SOURCE_ERRORS;
  active = false;
  pauseCalls = 0;
  resumeCalls = 0;
  disposeCalls = 0;
  onResume: (() => void) | undefined;
  resumeError: Error | undefined;
  pauseError: Error | undefined;
  #round = deferred<void>();
  #loading = false;
  readonly #listeners = new Map<string, Set<(payload: unknown) => void>>();

  constructor(kind: ViewKind) {
    this.kind = kind;
    this.#round.resolve();
  }

  whenReady(): Promise<void> {
    return this.#round.promise;
  }

  /** 开始新的样式加载；恢复显示时也可能触发这一过程 */
  beginLoading(): void {
    this.#round = deferred<void>();
    this.#loading = true;
    this.emit('initializing');
  }

  markReady(): void {
    this.#loading = false;
    this.emit(this.active ? 'ready' : 'paused');
    this.#round.resolve();
  }

  fail(error: unknown): void {
    this.active = false;
    this.failure = { kind: 'engine', cause: 'unknown', error };
    this.emit('failed');
    this.#round.reject(error);
  }

  pause(): void {
    this.pauseCalls++;
    if (this.pauseError) {
      throw this.pauseError;
    }
    this.active = false;
    if (this.state === 'ready') {
      this.emit('paused');
    }
  }

  resume(): void {
    this.resumeCalls++;
    if (this.resumeError) {
      throw this.resumeError;
    }
    this.active = true;
    this.onResume?.();
    if (!this.#loading && this.state !== 'failed' && this.state !== 'disposed') {
      this.emit('ready');
    }
  }

  flyTo(): void {}
  fitBounds(): void {}
  pick(): PickResult {
    return { kind: 'miss' };
  }
  project(): null {
    return null;
  }
  queryRendered(): readonly RenderedFeature[] {
    return [];
  }

  on(event: 'statechange', callback: (state: ViewState) => void): Unsubscribe;
  on(event: 'resize', callback: () => void): Unsubscribe;
  on(event: 'settle', callback: () => void): Unsubscribe;
  on(event: 'sourceerrorchange', callback: (errors: SourceErrors) => void): Unsubscribe;
  on(event: string, callback: (payload: never) => void): Unsubscribe {
    const listener = callback as (payload: unknown) => void;
    const listeners = this.#listeners.get(event) ?? new Set();
    this.#listeners.set(event, listeners.add(listener));
    return () => listeners.delete(listener);
  }

  emit(state: ViewState): void {
    this.state = state;
    for (const listener of this.#listeners.get('statechange') ?? []) {
      listener(state);
    }
  }

  get listeners(): number {
    return [...this.#listeners.values()].reduce((sum, entries) => sum + entries.size, 0);
  }

  [Symbol.dispose](): void {
    this.disposeCalls++;
    this.active = false;
    this.emit('disposed');
    this.#round.reject(new DOMException('测试视图已释放', 'AbortError'));
  }
}

// Node 下只需要画布的测量接口，不创建浏览器环境
function container(): HTMLElement {
  return {
    isConnected: true,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 600 })
  } as unknown as HTMLElement;
}

function setup(options: { load?: LoadMapView; active?: boolean } = {}) {
  const views = { '2d': new FakeView('2d'), '3d': new FakeView('3d') };
  const load = vi.fn<LoadMapView>(options.load ?? (async kind => () => views[kind]));
  const session = new MapSession({ groups: [], camera: { center: [119, 32], zoom: 7, bearing: 0, pitch: 0 } });
  const errors: unknown[] = [];
  const map = new MapContextState(session, error => errors.push(error), resolveOverlayOptions());
  const containers = { '2d': container(), '3d': container() };
  const owner = new MapViewSwitch(map, containers, load, options.active);
  return {
    views,
    load,
    map,
    owner,
    containers,
    errors,
    [Symbol.dispose]() {
      owner[Symbol.dispose]();
      map[Symbol.dispose]();
      session[Symbol.dispose]();
    }
  };
}

describe('MapViewSwitch', () => {
  it('候选加载完成前保留原图，完成后才暂停原图并交接上下文', async () => {
    using env = setup();
    const { owner, views, map } = env;
    expect(await outcome(owner.switchTo('2d'))).toBe('resolved');
    const previous = map.context.view.value;
    views['3d'].beginLoading();
    views['3d'].onResume = () => expect(views['2d'].active).toBe(false);

    const switching = owner.switchTo('3d');
    expect(await outcome(switching)).toBe('pending');
    expect(owner.state.value).toMatchObject({ current: '2d', target: '3d', status: 'loading' });
    expect(map.context.view.value).toBe(previous);
    expect(views['2d'].active).toBe(true);
    expect(views['3d'].active).toBe(false);

    views['3d'].markReady();
    expect(await outcome(switching)).toBe('resolved');
    expect(owner.state.value).toMatchObject({ current: '3d', target: '3d', status: 'ready' });
    expect(map.context.view.value?.kind).toBe('3d');
    expect(views['2d'].active).toBe(false);
    expect(views['3d'].active).toBe(true);
  });

  it('返回当前视图会取消切换，旧候选随后完成也不能抢回显示', async () => {
    using env = setup();
    expect(await outcome(env.owner.switchTo('2d'))).toBe('resolved');
    env.views['3d'].beginLoading();
    const pending = env.owner.switchTo('3d');
    expect(await outcome(pending)).toBe('pending');

    expect(await outcome(env.owner.switchTo('2d'))).toBe('resolved');
    expect(await outcome(pending)).toBe('resolved');
    env.views['3d'].markReady();
    await flush();

    expect(env.owner.state.value).toMatchObject({ current: '2d', target: '2d', status: 'ready' });
    expect(env.map.context.view.value?.kind).toBe('2d');
    expect(env.views['3d'].resumeCalls).toBe(0);
  });

  it('同一目标在加载中被重复选择时共用加载，切走再回来复用视图', async () => {
    using env = setup();
    expect(await outcome(env.owner.switchTo('2d'))).toBe('resolved');
    env.views['3d'].beginLoading();
    const first = env.owner.switchTo('3d');
    const latest = env.owner.switchTo('3d');
    expect(await outcome(first)).toBe('resolved');
    expect(await outcome(latest)).toBe('pending');
    expect(env.load.mock.calls).toStrictEqual([['2d'], ['3d']]);

    env.views['3d'].markReady();
    expect(await outcome(latest)).toBe('resolved');
    expect(await outcome(env.owner.switchTo('2d'))).toBe('resolved');
    expect(await outcome(env.owner.switchTo('3d'))).toBe('resolved');

    expect(env.load.mock.calls).toStrictEqual([['2d'], ['3d']]);
    expect(env.views['2d'].disposeCalls).toBe(0);
    expect(env.views['3d'].disposeCalls).toBe(0);
  });

  it('模块失败保留原图，重试重新加载候选并完成切换', async () => {
    const failed = new Error('模块加载失败');
    const two = new FakeView('2d');
    const three = new FakeView('3d');
    let failModule = true;
    using env = setup({
      load: async kind => {
        if (kind === '3d' && failModule) {
          throw failed;
        }
        return () => kind === '2d' ? two : three;
      }
    });
    expect(await outcome(env.owner.switchTo('2d'))).toBe('resolved');
    expect(await outcome(env.owner.switchTo('3d'))).toBe('resolved');
    expect(env.owner.state.value).toMatchObject({ current: '2d', target: '3d', status: 'failed', error: failed });
    expect(env.map.context.view.value?.kind).toBe('2d');
    expect(two.active).toBe(true);

    failModule = false;
    expect(await outcome(env.owner.retry())).toBe('resolved');
    expect(env.map.context.view.value?.kind).toBe('3d');
    expect(env.load.mock.calls).toStrictEqual([['2d'], ['3d'], ['3d']]);
  });

  it('候选首次就绪失败会释放它，重试创建新视图，原图一直可用', async () => {
    const two = new FakeView('2d');
    const broken = new FakeView('3d');
    const replacement = new FakeView('3d');
    broken.beginLoading();
    let candidate = broken;
    using env = setup({ load: async kind => () => kind === '2d' ? two : candidate });
    expect(await outcome(env.owner.switchTo('2d'))).toBe('resolved');
    const switching = env.owner.switchTo('3d');
    expect(await outcome(switching)).toBe('pending');
    const error = new Error('首帧失败');

    broken.fail(error);
    expect(await outcome(switching)).toBe('resolved');
    expect(env.owner.state.value).toMatchObject({ current: '2d', target: '3d', status: 'failed', error });
    expect(broken.disposeCalls).toBe(1);
    expect(broken.listeners).toBe(0);
    expect(two.active).toBe(true);

    candidate = replacement;
    expect(await outcome(env.owner.retry())).toBe('resolved');
    expect(env.map.context.view.value?.kind).toBe('3d');
    expect(replacement.active).toBe(true);
  });

  it('激活候选抛错会还原原图并释放候选，下一次重试可以成功', async () => {
    const two = new FakeView('2d');
    const broken = new FakeView('3d');
    const replacement = new FakeView('3d');
    const error = new Error('恢复失败');
    broken.resumeError = error;
    let candidate = broken;
    using env = setup({ load: async kind => () => kind === '2d' ? two : candidate });
    expect(await outcome(env.owner.switchTo('2d'))).toBe('resolved');

    expect(await outcome(env.owner.switchTo('3d'))).toBe('resolved');
    expect(env.owner.state.value).toMatchObject({ current: '2d', target: '3d', status: 'failed', error });
    expect(env.map.context.view.value?.kind).toBe('2d');
    expect(two.active).toBe(true);
    expect(broken.disposeCalls).toBe(1);

    candidate = replacement;
    expect(await outcome(env.owner.retry())).toBe('resolved');
    expect(env.map.context.view.value?.kind).toBe('3d');
  });

  it('激活和回退时暂停候选都抛错，仍还原原图并释放候选', async () => {
    using env = setup();
    expect(await outcome(env.owner.switchTo('2d'))).toBe('resolved');
    const resumeError = new Error('激活失败');
    const pauseError = new Error('暂停失败');
    env.views['3d'].resumeError = resumeError;
    env.views['3d'].pauseError = pauseError;

    expect(await outcome(env.owner.switchTo('3d'))).toBe('resolved');

    expect(env.owner.state.value).toMatchObject({ current: '2d', target: '3d', status: 'failed', error: resumeError });
    expect(env.map.context.view.value?.kind).toBe('2d');
    expect(env.views['2d'].active).toBe(true);
    expect(env.views['3d'].disposeCalls).toBe(1);
    expect(env.errors).toStrictEqual([pauseError]);
  });

  it('挂上视图执行排队定位时又切换，旧调用不能覆盖新一轮加载反馈', async () => {
    using env = setup();
    env.views['3d'].beginLoading();
    let next: Promise<void> | undefined;
    env.map.context.runCameraOperation(() => {
      next = env.owner.switchTo('3d');
    });

    expect(await outcome(env.owner.switchTo('2d'))).toBe('resolved');
    expect(env.owner.state.value).toMatchObject({ current: '2d', target: '3d', status: 'loading' });
    expect(env.map.context.view.value?.kind).toBe('2d');
    expect(next).toBeDefined();

    env.views['3d'].markReady();
    expect(await outcome(next ?? Promise.reject(new Error('没有发起下一次切换')))).toBe('resolved');
    expect(env.owner.state.value).toMatchObject({ current: '3d', target: '3d', status: 'ready' });
  });

  it('激活候选时重入选择同一目标，旧意图作废后保留候选供新意图完成', async () => {
    using env = setup();
    expect(await outcome(env.owner.switchTo('2d'))).toBe('resolved');
    let latest: Promise<void> | undefined;
    env.views['3d'].onResume = () => {
      env.views['3d'].onResume = undefined;
      latest = env.owner.switchTo('3d');
    };

    expect(await outcome(env.owner.switchTo('3d'))).toBe('resolved');
    expect(latest).toBeDefined();
    expect(await outcome(latest ?? Promise.reject(new Error('没有发起新的三维切换')))).toBe('resolved');

    expect(env.owner.state.value).toMatchObject({ current: '3d', target: '3d', status: 'ready' });
    expect(env.map.context.view.value?.kind).toBe('3d');
    expect(env.views['3d'].active).toBe(true);
    expect(env.views['3d'].disposeCalls).toBe(0);
    expect(env.views['2d'].active).toBe(false);
    expect(env.load.mock.calls).toStrictEqual([['2d'], ['3d']]);
  });

  it('恢复缓存二维引发新一轮样式加载时还原三维，等新一轮结束再交接', async () => {
    using env = setup();
    expect(await outcome(env.owner.switchTo('2d'))).toBe('resolved');
    expect(await outcome(env.owner.switchTo('3d'))).toBe('resolved');
    const two = env.views['2d'];
    two.onResume = () => {
      two.onResume = undefined;
      two.beginLoading();
    };

    const switching = env.owner.switchTo('2d');
    expect(await outcome(switching)).toBe('pending');
    expect(env.owner.state.value).toMatchObject({ current: '3d', target: '2d', status: 'loading' });
    expect(env.map.context.view.value?.kind).toBe('3d');
    expect(two.active).toBe(false);
    expect(env.views['3d'].active).toBe(true);

    two.markReady();
    expect(await outcome(switching)).toBe('resolved');
    expect(env.map.context.view.value?.kind).toBe('2d');
    expect(two.active).toBe(true);
    expect(env.views['3d'].active).toBe(false);
    expect(env.load.mock.calls).toStrictEqual([['2d'], ['3d']]);
  });

  it('追赶样式期间改回原图，晚到的样式不能再次触发交接', async () => {
    using env = setup();
    expect(await outcome(env.owner.switchTo('2d'))).toBe('resolved');
    expect(await outcome(env.owner.switchTo('3d'))).toBe('resolved');
    const two = env.views['2d'];
    two.onResume = () => {
      two.onResume = undefined;
      two.beginLoading();
    };
    const switching = env.owner.switchTo('2d');
    expect(await outcome(switching)).toBe('pending');

    expect(await outcome(env.owner.switchTo('3d'))).toBe('resolved');
    expect(await outcome(switching)).toBe('resolved');
    two.markReady();
    await flush();

    expect(env.owner.state.value).toMatchObject({ current: '3d', target: '3d', status: 'ready' });
    expect(env.map.context.view.value?.kind).toBe('3d');
    expect(two.active).toBe(false);
  });

  it('追赶样式失败保留三维，重试释放失败的二维并重新创建', async () => {
    const original = new FakeView('2d');
    const replacement = new FakeView('2d');
    const three = new FakeView('3d');
    let two = original;
    using env = setup({ load: async kind => () => kind === '2d' ? two : three });
    expect(await outcome(env.owner.switchTo('2d'))).toBe('resolved');
    expect(await outcome(env.owner.switchTo('3d'))).toBe('resolved');
    original.onResume = () => {
      original.onResume = undefined;
      original.beginLoading();
    };
    const switching = env.owner.switchTo('2d');
    expect(await outcome(switching)).toBe('pending');
    const error = new Error('追赶样式失败');

    original.fail(error);
    expect(await outcome(switching)).toBe('resolved');
    expect(env.owner.state.value).toMatchObject({ current: '3d', target: '2d', status: 'failed', error });
    expect(env.map.context.view.value?.kind).toBe('3d');
    expect(three.active).toBe(true);

    two = replacement;
    expect(await outcome(env.owner.retry())).toBe('resolved');
    expect(original.disposeCalls).toBe(1);
    expect(env.map.context.view.value?.kind).toBe('2d');
  });

  it('准备期间隐藏页面，候选完成后仍保留原图暂停，恢复页面才交接', async () => {
    using env = setup();
    expect(await outcome(env.owner.switchTo('2d'))).toBe('resolved');
    env.views['3d'].beginLoading();
    const switching = env.owner.switchTo('3d');
    expect(await outcome(switching)).toBe('pending');

    env.owner.setActive(false);
    env.views['3d'].markReady();
    expect(await outcome(switching)).toBe('pending');
    expect(env.owner.state.value).toMatchObject({ current: '2d', target: '3d', status: 'loading' });
    expect(env.map.context.viewState.value).toBe('paused');
    expect(env.map.context.view.value).toBeNull();
    expect(env.views['2d'].active).toBe(false);
    expect(env.views['3d'].resumeCalls).toBe(0);

    env.owner.setActive(true);
    expect(await outcome(switching)).toBe('resolved');
    expect(env.owner.state.value).toMatchObject({ current: '3d', target: '3d', status: 'ready' });
    expect(env.map.context.view.value?.kind).toBe('3d');
    expect(env.views['3d'].active).toBe(true);
  });

  it('最初隐藏时可以准备当前视图，恢复时只执行一次排队的定位', async () => {
    using env = setup({ active: false });
    const locate = vi.fn<() => void>();
    env.map.context.runCameraOperation(locate);

    const switching = env.owner.switchTo('2d');
    expect(await outcome(switching)).toBe('pending');
    expect(env.views['2d'].resumeCalls).toBe(0);
    expect(locate).not.toHaveBeenCalled();
    env.owner.setActive(true);
    env.owner.setActive(true);
    expect(await outcome(switching)).toBe('resolved');

    expect(env.views['2d'].resumeCalls).toBe(1);
    expect(locate).toHaveBeenCalledTimes(1);
  });

  it('页面隐藏时准备成功但恢复时激活失败，仍能回到原图', async () => {
    using env = setup();
    expect(await outcome(env.owner.switchTo('2d'))).toBe('resolved');
    env.owner.setActive(false);
    const error = new Error('恢复页面时激活失败');
    env.views['3d'].resumeError = error;
    const switching = env.owner.switchTo('3d');
    expect(await outcome(switching)).toBe('pending');
    expect(env.owner.state.value).toMatchObject({ current: '2d', target: '3d', status: 'loading' });

    env.owner.setActive(true);
    expect(await outcome(switching)).toBe('resolved');

    expect(env.owner.state.value).toMatchObject({ current: '2d', target: '3d', status: 'failed', error });
    expect(env.map.context.view.value?.kind).toBe('2d');
    expect(env.views['2d'].active).toBe(true);
    expect(env.views['3d'].disposeCalls).toBe(1);
  });

  it('当前视图运行中失败会更新切换反馈，重试用新视图替换', async () => {
    const original = new FakeView('2d');
    const replacement = new FakeView('2d');
    let current = original;
    using env = setup({ load: async () => () => current });
    expect(await outcome(env.owner.switchTo('2d'))).toBe('resolved');
    const error = new Error('上下文丢失');

    original.fail(error);
    expect(env.owner.state.value).toMatchObject({ current: '2d', target: '2d', status: 'failed', error });
    expect(env.map.context.failure.value?.error).toBe(error);
    current = replacement;
    expect(await outcome(env.owner.retry())).toBe('resolved');

    expect(original.disposeCalls).toBe(1);
    expect(replacement.active).toBe(true);
    expect(env.map.context.view.value?.kind).toBe('2d');
  });

  it.each(['pause', 'resume'] as const)('页面 %s 抛错时释放仍未标记失败的当前视图，重试重新创建', async action => {
    const original = new FakeView('2d');
    const replacement = new FakeView('2d');
    let current = original;
    using env = setup({ load: async () => () => current });
    expect(await outcome(env.owner.switchTo('2d'))).toBe('resolved');
    const error = new Error('当前视图生命周期失败');
    if (action === 'resume') {
      env.owner.setActive(false);
      original.resumeError = error;
    } else {
      original.pauseError = error;
    }
    expect(original.state).toBe(action === 'resume' ? 'paused' : 'ready');

    env.owner.setActive(action === 'resume');

    expect(env.owner.state.value).toMatchObject({ current: null, target: '2d', status: 'failed', error });
    expect(env.map.context.viewState.value).toBe('idle');
    expect(original.disposeCalls).toBe(1);
    expect(original.active).toBe(false);
    expect(original.listeners).toBe(0);
    current = replacement;
    const retry = env.owner.retry();
    env.owner.setActive(true);
    expect(await outcome(retry)).toBe('resolved');
    expect(env.load).toHaveBeenCalledTimes(2);
    expect(env.owner.state.value).toMatchObject({ current: '2d', target: '2d', status: 'ready' });
    expect(env.map.context.view.value?.kind).toBe('2d');
    expect(replacement.active).toBe(true);
  });

  it('卸载释放所有已创建视图和监听；重复卸载或后续请求没有副作用', async () => {
    using env = setup();
    expect(await outcome(env.owner.switchTo('2d'))).toBe('resolved');
    expect(await outcome(env.owner.switchTo('3d'))).toBe('resolved');
    env.owner[Symbol.dispose]();
    env.owner[Symbol.dispose]();

    expect(env.map.context.viewState.value).toBe('idle');
    expect(env.views['2d'].disposeCalls).toBe(1);
    expect(env.views['3d'].disposeCalls).toBe(1);
    expect(env.views['2d'].listeners).toBe(0);
    expect(env.views['3d'].listeners).toBe(0);
    expect(await outcome(env.owner.switchTo('2d'))).toBe('resolved');
    env.owner.setActive(true);
    expect(env.load).toHaveBeenCalledTimes(2);
  });

  it('模块晚于卸载返回时不创建视图，切换等待在卸载时立即结束', async () => {
    const module = deferred<(element: HTMLElement) => MapView>();
    const create = vi.fn<() => FakeView>(() => new FakeView('3d'));
    using env = setup({ load: () => module.promise });
    const switching = env.owner.switchTo('3d');
    expect(await outcome(switching)).toBe('pending');

    env.owner[Symbol.dispose]();
    expect(await outcome(switching)).toBe('resolved');
    module.resolve(create);
    await flush();

    expect(create).not.toHaveBeenCalled();
    expect(env.map.context.viewState.value).toBe('idle');
    expect(env.errors).toStrictEqual([]);
  });

  it('候选已创建但仍加载时卸载，候选也只释放一次且不会晚到交接', async () => {
    using env = setup();
    expect(await outcome(env.owner.switchTo('2d'))).toBe('resolved');
    env.views['3d'].beginLoading();
    const switching = env.owner.switchTo('3d');
    expect(await outcome(switching)).toBe('pending');

    env.owner[Symbol.dispose]();
    expect(await outcome(switching)).toBe('resolved');
    await flush();

    expect(env.views['2d'].disposeCalls).toBe(1);
    expect(env.views['3d'].disposeCalls).toBe(1);
    expect(env.views['3d'].resumeCalls).toBe(0);
    expect(env.map.context.viewState.value).toBe('idle');
    expect(env.errors).toStrictEqual([]);
  });
});
