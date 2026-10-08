import { ElMessage } from 'element-plus';
import { delay, HttpResponse, http as mock } from 'msw';
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
import { queryClient } from './query-client';

const server = setupServer();
const Empty = { render: () => null };
const token = createTestJwtExpiringAt(Date.now() + 3_600_000);
const otherToken = createTestJwtExpiringAt(Date.now() + 7_200_000);

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
  queryClient.clear();
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

function signIn(sessionToken = token) {
  useSessionStore().start({ token: sessionToken, user: { loginName: 'zhangsan', role: Role.user } });
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

  it('收到 401 时结束会话（清空会话和查询缓存）、提示并回到登录页', async () => {
    const warning = vi.spyOn(ElMessage, 'warning').mockReturnValue({ close: () => undefined });
    signIn();
    queryClient.setQueryData(['files'], ['上一个账号的数据']);

    await respondUnauthorized();
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe(RouteName.login));

    expect(useSessionStore().session).toBeNull();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(warning).toHaveBeenCalledOnce();
  });

  it('token 已过期时不发出请求，同样结束会话、提示并回到登录页', async () => {
    const warning = vi.spyOn(ElMessage, 'warning').mockReturnValue({ close: () => undefined });
    signIn(createTestJwtExpiringAt(Date.now() - 1000));
    // 这个接口不校验 token，请求发出去就会成功
    const requests: string[] = [];
    server.use(
      mock.get('/backend/data', ({ request }) => {
        requests.push(request.url);
        return HttpResponse.json({ code: 200, data: [] });
      })
    );

    await http.get('/data', { schema: z.unknown() }).catch(() => undefined);
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe(RouteName.login));

    expect(requests).toEqual([]);
    expect(useSessionStore().session).toBeNull();
    expect(warning).toHaveBeenCalledWith(expect.objectContaining({ message: '登录状态已过期，请重新登录' }));
  });

  it('未登录时照常发出请求（例如登录接口），不当作登录过期', async () => {
    const requests: string[] = [];
    server.use(
      mock.post('/backend/login', ({ request }) => {
        requests.push(request.url);
        return HttpResponse.json({ code: 200, data: null });
      })
    );

    await http.post('/login', {}, { schema: z.null() }).catch(() => undefined);

    expect(requests).toHaveLength(1);
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

  it('旧会话的请求晚到的 401 不影响之后建立的会话', async () => {
    const warning = vi.spyOn(ElMessage, 'warning').mockReturnValue({ close: () => undefined });
    signIn();
    server.use(
      mock.get('/backend/slow', async () => {
        await delay(20);
        return HttpResponse.json({ code: 401, msg: '用户未登录' }, { status: 401 });
      })
    );
    const pending = http.get('/slow', { schema: z.unknown() }).catch(() => undefined);

    // 请求返回前换账号登录；同一账号重新登录也会拿到新 token
    useSessionStore().start({ token: otherToken, user: { loginName: 'lisi', role: Role.user } });
    await pending;

    expect(useSessionStore().token).toBe(otherToken);
    expect(router.currentRoute.value.name).toBe(RouteName.currentMap);
    expect(warning).not.toHaveBeenCalled();
  });

  it('同一会话的多个请求都收到 401 时，只提示一次', async () => {
    const warning = vi.spyOn(ElMessage, 'warning').mockReturnValue({ close: () => undefined });
    signIn();

    await Promise.all([respondUnauthorized(), respondUnauthorized()]);

    expect(useSessionStore().session).toBeNull();
    expect(warning).toHaveBeenCalledOnce();
  });
});
