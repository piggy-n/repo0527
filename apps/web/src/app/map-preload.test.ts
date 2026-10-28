// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { RouteName } from '@/shared/router/route-names';
import { type MapPreloadOptions, preloadRuntimeWhenIdle, setupMapPreload } from './map-preload';

const Empty = { render: () => null };

function createTestRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/login', name: RouteName.login, component: Empty },
      { path: '/', name: RouteName.home, component: Empty }
    ]
  });
}

// 空闲回调由测试手动执行
function setup(
  options: MapPreloadOptions = {},
  load: () => Promise<unknown> = vi.fn<() => Promise<void>>(() => Promise.resolve())
) {
  const router = createTestRouter();
  const idle: (() => void)[] = [];
  setupMapPreload(router, load, { whenIdle: callback => idle.push(callback), saveData: () => false, ...options });
  return { router, idle, load };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('setupMapPreload', () => {
  it('第一次进入登录页后安排一次预加载，浏览器空闲时才加载', async () => {
    const { router, idle, load } = setup();

    await router.push('/login');
    expect(idle).toHaveLength(1);
    expect(load).not.toHaveBeenCalled();
    idle[0]?.();

    expect(load).toHaveBeenCalledTimes(1);
  });

  it('不是登录页时不安排；之后再进入登录页只安排一次', async () => {
    const { router, idle } = setup();

    await router.push('/');
    expect(idle).toHaveLength(0);
    await router.push('/login');
    await router.push('/');
    await router.push('/login');

    expect(idle).toHaveLength(1);
  });

  it('被守卫拦下的导航不算进入登录页', async () => {
    const { router, idle } = setup();
    router.beforeEach(to => to.name !== RouteName.login);

    await router.push('/login');

    expect(idle).toHaveLength(0);
  });

  it('省流量模式时跳过', async () => {
    const { router, idle } = setup({ saveData: () => true });

    await router.push('/login');

    expect(idle).toHaveLength(0);
  });

  it('加载失败时不抛出，拒绝有人处理', async () => {
    const failed = Promise.reject(new Error('分块加载失败'));
    const handled = vi.spyOn(failed, 'catch');
    const { router, idle } = setup({}, () => failed);
    await router.push('/login');

    expect(() => idle[0]?.()).not.toThrow();
    await flush();

    expect(handled).toHaveBeenCalledTimes(1);
  });

  it('默认用 requestIdleCallback，最多等 2 秒；按 navigator.connection 判断省流量', async () => {
    const requestIdleCallback = vi.fn<(callback: () => void, options: { timeout: number }) => void>(callback => callback());
    vi.stubGlobal('requestIdleCallback', requestIdleCallback);
    vi.stubGlobal('navigator', { connection: { saveData: false } });
    const router = createTestRouter();
    const load = vi.fn<() => Promise<void>>(() => Promise.resolve());
    setupMapPreload(router, load);

    await router.push('/login');

    expect(requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), { timeout: 2000 });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('没有 requestIdleCallback 时 1 秒后加载；navigator.connection.saveData 为真时跳过', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestIdleCallback', undefined);
    const withoutIdle = createTestRouter();
    const load = vi.fn<() => Promise<void>>(() => Promise.resolve());
    setupMapPreload(withoutIdle, load);
    await withoutIdle.push('/login');
    vi.advanceTimersByTime(999);
    expect(load).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(load).toHaveBeenCalledTimes(1);

    vi.stubGlobal('navigator', { connection: { saveData: true } });
    const savingData = createTestRouter();
    const skipped = vi.fn<() => Promise<void>>(() => Promise.resolve());
    setupMapPreload(savingData, skipped);
    await savingData.push('/login');
    vi.advanceTimersByTime(2000);

    expect(skipped).not.toHaveBeenCalled();
  });
});

describe('preloadRuntimeWhenIdle', () => {
  it('浏览器空闲时才加载；省流量模式时跳过（ADR 0091）', () => {
    const idle: (() => void)[] = [];
    const load = vi.fn<() => Promise<void>>(() => Promise.resolve());
    preloadRuntimeWhenIdle(load, { whenIdle: callback => idle.push(callback), saveData: () => false });
    expect(load).not.toHaveBeenCalled();
    idle[0]?.();
    expect(load).toHaveBeenCalledTimes(1);

    const skipped = vi.fn<() => Promise<void>>(() => Promise.resolve());
    preloadRuntimeWhenIdle(skipped, { whenIdle: callback => idle.push(callback), saveData: () => true });
    expect(idle).toHaveLength(1);
  });

  it('加载失败时不抛出，拒绝有人处理', async () => {
    const failed = Promise.reject(new Error('分块加载失败'));
    const handled = vi.spyOn(failed, 'catch');
    preloadRuntimeWhenIdle(() => failed, { whenIdle: callback => callback(), saveData: () => false });
    await flush();

    expect(handled).toHaveBeenCalledTimes(1);
  });
});
