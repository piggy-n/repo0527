import { HttpResponse, type JsonBodyType, http as mock } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Role } from '@/shared/auth/roles';
import { configureHttp } from '@/shared/http/configure';
import { ApiError } from '@/shared/http/errors';
import { login } from './api';

const server = setupServer();
const requestBodySchema = z.object({ loginName: z.string(), password: z.string() });

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

// 模拟登录接口，返回收到的请求体，便于断言
function mockLogin(responseBody: JsonBodyType) {
  const received: { body?: z.infer<typeof requestBodySchema> } = {};
  server.use(
    mock.post('/backend/user/login', async ({ request }) => {
      received.body = requestBodySchema.parse(await request.json());
      return HttpResponse.json(responseBody);
    })
  );
  return received;
}

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

describe('login', () => {
  it('提交登录名和 SM2 加密后的密码，返回会话', async () => {
    const received = mockLogin({
      code: 200,
      msg: '操作成功',
      data: { token: 'jwt-token', roleCode: 'admin', id: 7, loginName: 'zhangsan', realName: '张三', avatar: null }
    });

    const session = await login({ loginName: 'zhangsan', password: 'secret' });

    expect(session).toEqual({
      token: 'jwt-token',
      user: { id: '7', loginName: 'zhangsan', realName: '张三', role: Role.admin }
    });
    expect(received.body?.loginName).toBe('zhangsan');
    expect(received.body?.password).not.toContain('secret');
    expect(received.body?.password).toMatch(/^[0-9a-f]+$/);
    expect(received.body?.password).toHaveLength(128 + 64 + 'secret'.length * 2);
  });

  it('响应缺少登录名时依次用 username、输入的登录名；无法识别的角色按普通用户处理', async () => {
    mockLogin({ code: 200, data: { token: 't1', roleCode: 'auditor', username: 'zs' } });
    await expect(login({ loginName: 'input', password: 'p' })).resolves.toMatchObject({
      user: { loginName: 'zs', role: Role.user }
    });

    mockLogin({ code: 200, data: { token: 't2', roleCode: 'user', loginName: '', username: null } });
    await expect(login({ loginName: 'input', password: 'p' })).resolves.toMatchObject({
      user: { loginName: 'input', role: Role.user }
    });
  });

  it('登录失败时抛出 ApiError，不触发全局提示', async () => {
    const onError = vi.fn<(error: ApiError) => void>();
    configureHttp({ onError });
    mockLogin({ code: 500, msg: '用户名或密码错误' });

    const error = await catchApiError(login({ loginName: 'zhangsan', password: 'wrong' }));

    expect(error.kind).toBe('business');
    expect(error.message).toBe('用户名或密码错误');
    expect(onError).not.toHaveBeenCalled();
  });

  it.each([
    ['缺少 token', { roleCode: 'admin' }],
    ['token 为空', { token: '', roleCode: 'admin' }],
    ['缺少 roleCode', { token: 't' }]
  ])('响应%s时抛出 invalid-response', async (_, data) => {
    mockLogin({ code: 200, data });

    const error = await catchApiError(login({ loginName: 'zhangsan', password: 'p' }));

    expect(error.kind).toBe('invalid-response');
  });
});
