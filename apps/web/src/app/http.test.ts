import { ElMessage } from 'element-plus';
import { HttpResponse, http as mock } from 'msw';
import { setupServer } from 'msw/node';
import { createPinia, setActivePinia } from 'pinia';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { z } from 'zod';
import { Role } from '@/shared/auth/roles';
import { useSessionStore } from '@/shared/auth/session-store';
import { createTestJwtExpiringAt } from '@/shared/auth/testing';
import { http } from '@/shared/http/client';
import { configureHttp } from '@/shared/http/configure';
import { RouteName } from '@/shared/router/route-names';
import { setupHttp } from './http';

const server = setupServer();
const Empty = { render: () => null };
const token = createTestJwtExpiringAt(Date.now() + 3_600_000);

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterAll(() => {
  server.close();
});

let router: Router;

beforeEach(async () => {
  localStorage.clear();
  setActivePinia(createPinia());
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/login', name: RouteName.login, component: Empty },
      { path: '/current-map', name: RouteName.currentMap, component: Empty }
    ]
  });
  await router.push('/current-map');
  setupHttp(router);
});

afterEach(() => {
  server.resetHandlers();
  configureHttp({});
  vi.restoreAllMocks();
});

function signIn() {
  useSessionStore().start({ token, user: { loginName: 'zhangsan', role: Role.user } });
}

// 请求 /echo-token，返回服务端收到的 token 请求头
async function requestToken() {
  server.use(
    mock.get('/backend/echo-token', ({ request }) => HttpResponse.json({ code: 200, data: request.headers.get('token') }))
  );
  return http.get('/echo-token', { schema: z.string().nullable() });
}

function respondUnauthorized() {
  server.use(mock.get('/backend/data', () => HttpResponse.json({ code: 401, msg: '用户未登录' }, { status: 401 })));
  return http.get('/data', { schema: z.unknown() }).catch(() => undefined);
}

describe('setupHttp', () => {
  it('已登录时请求带上 token，未登录时不带', async () => {
    expect(await requestToken()).toBeNull();

    signIn();
    expect(await requestToken()).toBe(token);

    useSessionStore().clear();
    expect(await requestToken()).toBeNull();
  });

  it('收到 401 时清空会话、提示并回到登录页', async () => {
    const warning = vi.spyOn(ElMessage, 'warning').mockReturnValue({ close: () => undefined });
    signIn();

    await respondUnauthorized();
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe(RouteName.login));

    expect(useSessionStore().session).toBeNull();
    expect(warning).toHaveBeenCalledOnce();
  });

  it('在登录页收到 401 时只清空会话，不提示也不跳转', async () => {
    const warning = vi.spyOn(ElMessage, 'warning').mockReturnValue({ close: () => undefined });
    await router.push('/login');
    signIn();

    await respondUnauthorized();

    expect(useSessionStore().session).toBeNull();
    expect(router.currentRoute.value.name).toBe(RouteName.login);
    expect(warning).not.toHaveBeenCalled();
  });
});
