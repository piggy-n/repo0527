import { flushPromises, mount } from '@vue/test-utils';
import { ElMessage } from 'element-plus';
import { HttpResponse, type JsonBodyType, http as mock } from 'msw';
import { setupServer } from 'msw/node';
import { createPinia, type Pinia, setActivePinia } from 'pinia';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginForm } from './LoginForm';

const server = setupServer();
const SUCCESS = { code: 200, data: { token: 'jwt-token', roleCode: 'user', loginName: 'zhangsan' } };

let pinia: Pinia;

function mockLogin(responseBody: JsonBodyType = SUCCESS) {
  const handler = vi.fn<() => Response>(() => HttpResponse.json(responseBody));
  server.use(mock.post('/backend/user/login', handler));
  return handler;
}

// 挂载并填好账号密码，返回组件和密码输入框
async function mountFilled() {
  const wrapper = mount(LoginForm, { global: { plugins: [pinia] }, attachTo: document.body });
  const [loginName, password] = wrapper.findAll('input');
  await loginName.setValue('zhangsan');
  await password.setValue('secret');
  return { wrapper, password };
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

beforeEach(() => {
  localStorage.clear();
  pinia = createPinia();
  setActivePinia(pinia);
});

afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

afterAll(() => {
  server.close();
});

describe('LoginForm', () => {
  it('在密码框按回车提交，登录成功时触发 success 并带上会话', async () => {
    mockLogin();
    const { wrapper, password } = await mountFilled();

    await password.trigger('keydown', { key: 'Enter' });

    await vi.waitFor(() => expect(wrapper.emitted('success')).toHaveLength(1));
    expect(wrapper.emitted('success')?.[0]).toMatchObject([{ token: 'jwt-token', user: { loginName: 'zhangsan' } }]);
  });

  it('用输入法选字时按的回车不提交', async () => {
    const handler = mockLogin();
    const { password } = await mountFilled();

    await password.trigger('keydown', { key: 'Enter', isComposing: true });
    await flushPromises();

    expect(handler).not.toHaveBeenCalled();
  });

  it('登录失败时弹出后端的提示，不触发 success', async () => {
    const error = vi.spyOn(ElMessage, 'error').mockReturnValue({ close: () => undefined });
    mockLogin({ code: 500, msg: '用户名或密码错误' });
    const { wrapper } = await mountFilled();

    await wrapper.find('button').trigger('click');

    await vi.waitFor(() => expect(error).toHaveBeenCalledWith('用户名或密码错误'));
    expect(wrapper.emitted('success')).toBeUndefined();
  });
});
