// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { navigate } from '@/shared/router/navigate';
import { createNavigationRecovery } from './navigation-recovery';

afterEach(() => vi.restoreAllMocks());

/** 最小路由，用可切换的分块加载失败模拟网络恢复 */
function fixture() {
  const page = { render: () => null };
  let failed = true;
  const load = vi.fn(() => failed ? Promise.reject(new Error('分块加载失败')) : Promise.resolve(page));
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: page }, { path: '/map', component: load }]
  });
  const reload = vi.fn<(href: string) => void>();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const recovery = createNavigationRecovery(router, reload);
  return { router, recovery, reload, load, restore: () => { failed = false; } };
}

describe('导航失败恢复', () => {
  it('首次导航失败也保留目标；重复失败只有一个状态，恢复后重试成功并清除提示', async () => {
    const { router, recovery, load, restore } = fixture();
    expect(await navigate(router, '/map?year=2025#detail')).toBe(false);
    expect(recovery.failure.value?.fullPath).toBe('/map?year=2025#detail');
    await recovery.retry();
    expect(recovery.failure.value?.fullPath).toBe('/map?year=2025#detail');
    expect(recovery.retrying.value).toBe(false);
    restore();
    await Promise.all([recovery.retry(), recovery.retry()]);
    expect(load).toHaveBeenCalledTimes(3);
    expect(router.currentRoute.value.fullPath).toBe('/map?year=2025#detail');
    expect(recovery.failure.value).toBeNull();
    expect(recovery.retrying.value).toBe(false);
    recovery.dispose();
  });

  it('刷新保留失败目标的查询和锚点；成功转到别处后不再刷新旧目标', async () => {
    const { router, recovery, reload } = fixture();
    await navigate(router, '/map?year=2025#detail');
    recovery.reload();
    expect(reload).toHaveBeenCalledExactlyOnceWith('/map?year=2025#detail');
    expect(await navigate(router, '/')).toBe(true);
    recovery.reload();
    expect(recovery.failure.value).toBeNull();
    expect(reload).toHaveBeenCalledTimes(1);
    recovery.dispose();
  });

  it('重试重新经过守卫，权限变化后可以转到别处', async () => {
    const { router, recovery } = fixture();
    await navigate(router, '/map');
    router.beforeEach(to => to.path === '/map' ? '/' : true);
    await recovery.retry();
    expect(router.currentRoute.value.path).toBe('/');
    expect(recovery.failure.value).toBeNull();
    recovery.dispose();
  });

  it('旧导航晚到的失败不重新打开提示', async () => {
    const { router, recovery } = fixture();
    let reject!: (error: Error) => void;
    router.addRoute({
      path: '/slow',
      component: () => {
        return new Promise<{ render: () => null }>((_resolve, onReject) => { reject = onReject; });
      }
    });
    const previous = navigate(router, '/slow');
    await vi.waitFor(() => expect(reject).toBeTypeOf('function'));
    await navigate(router, '/');
    reject(new Error('旧分块失败'));
    expect(await previous).toBe(false);
    expect(recovery.failure.value).toBeNull();
    recovery.dispose();
  });
});
