import { ElMessage } from 'element-plus';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter, type Router, type RouteRecordRaw } from 'vue-router';
import { Role } from '@/shared/auth/roles';
import { useSessionStore } from '@/shared/auth/session-store';
import { createTestJwtExpiringAt } from '@/shared/auth/testing';
import { RouteName } from '@/shared/router/route-names';
import { queryClient } from '../query-client';
import { installAuthGuard } from './auth-guard';

const Empty = { render: () => null };

// 只包含用例需要的路由，meta 的写法与真实路由表相同
const routes: RouteRecordRaw[] = [
  { path: '/login', name: RouteName.login, component: Empty, meta: { public: true } },
  { path: '/', name: RouteName.home, redirect: { name: RouteName.currentMap } },
  { path: '/current-map', name: RouteName.currentMap, component: Empty },
  { path: '/system-management', name: RouteName.systemManagement, component: Empty, meta: { roles: [Role.admin] } },
  { path: '/:pathMatch(.*)*', name: RouteName.notFound, component: Empty, meta: { public: true } }
];

function setupRouter(): Router {
  const router = createRouter({ history: createMemoryHistory(), routes });
  installAuthGuard(router);
  return router;
}

function signIn(role: Role, expiresAt = Date.now() + 3_600_000) {
  useSessionStore().start({ token: createTestJwtExpiringAt(expiresAt), user: { loginName: 'zhangsan', role } });
}

async function visit(path: string) {
  const router = setupRouter();
  await router.push(path);
  return router.currentRoute.value;
}

beforeEach(() => {
  localStorage.clear();
  setActivePinia(createPinia());
  queryClient.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const spyWarning = () => vi.spyOn(ElMessage, 'warning').mockReturnValue({ close: () => undefined });

describe('未登录', () => {
  it('访问业务页时去登录页，不提示', async () => {
    const warning = spyWarning();

    expect((await visit('/current-map')).name).toBe(RouteName.login);
    expect(warning).not.toHaveBeenCalled();
  });

  it('根路径重定向到业务页后，同样要求登录', async () => {
    expect((await visit('/')).name).toBe(RouteName.login);
  });

  it('可以访问公开页面', async () => {
    expect((await visit('/login')).name).toBe(RouteName.login);
    expect((await visit('/no-such-page')).name).toBe(RouteName.notFound);
  });
});

describe('已登录', () => {
  it('可以访问不限角色的页面', async () => {
    signIn(Role.user);

    expect((await visit('/current-map')).name).toBe(RouteName.currentMap);
  });

  it('访问登录页时进入角色首页', async () => {
    signIn(Role.user);

    expect((await visit('/login')).name).toBe(RouteName.currentMap);
  });

  it('访问没有权限的页面时回到角色首页，有权限的角色可以访问', async () => {
    signIn(Role.user);
    expect((await visit('/system-management')).name).toBe(RouteName.currentMap);

    signIn(Role.admin);
    expect((await visit('/system-management')).name).toBe(RouteName.systemManagement);
  });

  it('token 过期时去登录页，结束会话（清空会话和查询缓存）并提示', async () => {
    const warning = spyWarning();
    signIn(Role.admin, Date.now() - 1000);
    queryClient.setQueryData(['files'], ['上一个账号的数据']);

    expect((await visit('/current-map')).name).toBe(RouteName.login);
    expect(useSessionStore().session).toBeNull();
    expect(localStorage.length).toBe(0);
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(warning).toHaveBeenCalledWith(expect.objectContaining({ message: '登录状态已过期，请重新登录' }));
  });

  it('token 的载荷不是对象时不抛错，无法得知过期时间，按未过期放行', async () => {
    // 载荷是 JSON null
    useSessionStore().start({ token: 'e30.bnVsbA.x', user: { loginName: 'zhangsan', role: Role.user } });

    expect((await visit('/current-map')).name).toBe(RouteName.currentMap);
  });

  it('token 过期时访问登录页，停留在登录页', async () => {
    signIn(Role.admin, Date.now() - 1000);

    expect((await visit('/login')).name).toBe(RouteName.login);
  });
});
