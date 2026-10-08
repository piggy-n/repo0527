import { delay, HttpResponse, http as mock } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { z } from 'zod';
import { http } from './client';
import { configureHttp, type HttpHooks } from './configure';
import { ApiError } from './errors';

const server = setupServer();
const userSchema = z.object({ name: z.string() });

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
  configureHttp({});
});

afterAll(() => {
  server.close();
});

// 捕获请求抛出的 ApiError，便于逐项断言
async function catchApiError(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason
  );
  if (!(error instanceof ApiError)) {
    throw new Error('预期抛出 ApiError');
  }
  return error;
}

function setupHooks() {
  const hooks = {
    onError: vi.fn<(error: ApiError) => void>(),
    onUnauthorized: vi.fn<NonNullable<HttpHooks['onUnauthorized']>>()
  };
  configureHttp(hooks);
  return hooks;
}

describe('http 成功', () => {
  it('返回按 schema 校验后的 data，类型由 schema 推断', async () => {
    server.use(mock.get('/backend/user', () => HttpResponse.json({ code: 200, msg: 'ok', data: { name: '张三' } })));

    const user = await http.get('/user', { schema: userSchema });

    expect(user).toEqual({ name: '张三' });
    expectTypeOf(user).toEqualTypeOf<{ name: string }>();
  });

  it('附加 getHeaders 返回的请求头和查询参数', async () => {
    configureHttp({ getHeaders: () => ({ token: 'abc' }) });
    server.use(
      mock.get('/backend/echo', ({ request }) => {
        const { searchParams } = new URL(request.url);
        return HttpResponse.json({
          code: 200,
          data: { token: request.headers.get('token'), year: searchParams.get('year') }
        });
      })
    );

    const result = await http.get('/echo', {
      schema: z.object({ token: z.string().nullable(), year: z.string().nullable() }),
      query: { year: 2026 }
    });

    expect(result).toEqual({ token: 'abc', year: '2026' });
  });

  it('post 发送 JSON 请求体', async () => {
    server.use(
      mock.post('/backend/users', async ({ request }) =>
        HttpResponse.json({ code: 200, data: await request.json() })
      )
    );

    const created = await http.post('/users', { name: '李四' }, { schema: userSchema });

    expect(created).toEqual({ name: '李四' });
  });
});

describe('http 失败', () => {
  it('业务码不是 200：business，提示后端的 msg', async () => {
    const hooks = setupHooks();
    server.use(mock.get('/backend/user', () => HttpResponse.json({ code: 500, msg: '图层不存在' })));

    const error = await catchApiError(http.get('/user', { schema: userSchema }));

    expect(error).toMatchObject({ kind: 'business', code: 500, message: '图层不存在' });
    expect(hooks.onError).toHaveBeenCalledWith(error);
  });

  it('业务码 401：unauthorized，只触发 onUnauthorized', async () => {
    const hooks = setupHooks();
    server.use(mock.get('/backend/user', () => HttpResponse.json({ code: 401, msg: '用户未登录' })));

    const error = await catchApiError(http.get('/user', { schema: userSchema }));

    expect(error).toMatchObject({ kind: 'unauthorized', message: '登录状态已过期，请重新登录' });
    expect(hooks.onUnauthorized).toHaveBeenCalledWith(error, { headers: {} });
    expect(hooks.onError).not.toHaveBeenCalled();
  });

  it('silent 不影响 onUnauthorized', async () => {
    const hooks = setupHooks();
    server.use(mock.get('/backend/user', () => HttpResponse.json({ code: 401, msg: '用户未登录' })));

    await catchApiError(http.get('/user', { schema: userSchema, silent: true }));

    expect(hooks.onUnauthorized).toHaveBeenCalledOnce();
  });

  it('HTTP 401：同样是 unauthorized', async () => {
    const hooks = setupHooks();
    server.use(mock.get('/backend/user', () => new HttpResponse(null, { status: 401 })));

    const error = await catchApiError(http.get('/user', { schema: userSchema }));

    expect(error).toMatchObject({ kind: 'unauthorized', status: 401 });
    expect(hooks.onUnauthorized).toHaveBeenCalledOnce();
  });

  it('onUnauthorized 收到的是请求发出时附加的请求头', async () => {
    const hooks = setupHooks();
    let token = 'old';
    configureHttp({ ...hooks, getHeaders: () => ({ token }) });
    server.use(
      mock.get('/backend/user', async () => {
        await delay(20);
        return HttpResponse.json({ code: 401, msg: '用户未登录' });
      })
    );

    const pending = catchApiError(http.get('/user', { schema: userSchema }));
    token = 'new';
    const error = await pending;

    expect(hooks.onUnauthorized).toHaveBeenCalledWith(error, { headers: { token: 'old' } });
  });

  it('登录凭据已过期：不发出请求，按 unauthorized 处理', async () => {
    const hooks = setupHooks();
    configureHttp({ ...hooks, getHeaders: () => ({ token: 'expired' }), isCredentialExpired: () => true });
    const requests: string[] = [];
    server.use(
      mock.get('/backend/user', ({ request }) => {
        requests.push(request.url);
        return HttpResponse.json({ code: 200, data: { name: '张三' } });
      })
    );

    const error = await catchApiError(http.get('/user', { schema: userSchema, silent: true }));

    expect(requests).toEqual([]);
    expect(error).toMatchObject({ kind: 'unauthorized', message: '登录状态已过期，请重新登录', url: '/user' });
    expect(hooks.onUnauthorized).toHaveBeenCalledWith(error, { headers: { token: 'expired' } });
    expect(hooks.onError).not.toHaveBeenCalled();
  });

  it('HTTP 状态码错误：http，没有 msg 时按状态码提示', async () => {
    setupHooks();
    server.use(mock.get('/backend/user', () => new HttpResponse(null, { status: 404 })));

    const error = await catchApiError(http.get('/user', { schema: userSchema }));

    expect(error).toMatchObject({ kind: 'http', status: 404, message: '请求错误，未找到该资源' });
  });

  it('HTTP 状态码错误：响应体有 msg 时优先使用', async () => {
    server.use(mock.get('/backend/user', () => HttpResponse.json({ msg: '数据库连接失败' }, { status: 500 })));

    const error = await catchApiError(http.get('/user', { schema: userSchema }));

    expect(error).toMatchObject({ kind: 'http', status: 500, message: '数据库连接失败' });
  });

  it('data 不符合 schema：invalid-response', async () => {
    server.use(mock.get('/backend/user', () => HttpResponse.json({ code: 200, data: { name: 1 } })));

    const error = await catchApiError(http.get('/user', { schema: userSchema }));

    expect(error.kind).toBe('invalid-response');
  });

  it('响应没有外层结构：invalid-response', async () => {
    server.use(mock.get('/backend/user', () => HttpResponse.json({ name: '张三' })));

    const error = await catchApiError(http.get('/user', { schema: userSchema }));

    expect(error.kind).toBe('invalid-response');
  });

  it('网络错误：network', async () => {
    server.use(mock.get('/backend/user', () => HttpResponse.error()));

    const error = await catchApiError(http.get('/user', { schema: userSchema }));

    expect(error).toMatchObject({ kind: 'network', message: '网络出现问题，请稍后再试' });
  });

  it('超时：timeout', async () => {
    server.use(
      mock.get('/backend/user', async () => {
        await delay(200);
        return HttpResponse.json({ code: 200, data: { name: '张三' } });
      })
    );

    const error = await catchApiError(http.get('/user', { schema: userSchema, timeout: 20 }));

    expect(error.kind).toBe('timeout');
  });

  it('取消：canceled，不触发任何回调', async () => {
    const hooks = setupHooks();
    server.use(
      mock.get('/backend/user', async () => {
        await delay(200);
        return HttpResponse.json({ code: 200, data: { name: '张三' } });
      })
    );
    const controller = new AbortController();

    const pending = catchApiError(http.get('/user', { schema: userSchema, signal: controller.signal }));
    controller.abort();
    const error = await pending;

    expect(error.kind).toBe('canceled');
    expect(hooks.onError).not.toHaveBeenCalled();
    expect(hooks.onUnauthorized).not.toHaveBeenCalled();
  });

  it('传入已经取消的 signal：不发请求，直接 canceled', async () => {
    const controller = new AbortController();
    controller.abort();

    // 没有注册任何接口，真的发出请求会因 onUnhandledRequest: 'error' 而失败
    const error = await catchApiError(http.get('/user', { schema: userSchema, signal: controller.signal }));

    expect(error.kind).toBe('canceled');
  });

  it('silent 请求不触发 onError', async () => {
    const hooks = setupHooks();
    server.use(mock.get('/backend/user', () => HttpResponse.json({ code: 500, msg: '图层不存在' })));

    await catchApiError(http.get('/user', { schema: userSchema, silent: true }));

    expect(hooks.onError).not.toHaveBeenCalled();
  });
});
