import { mount } from '@vue/test-utils';
import { ElForm, ElFormItem } from 'element-plus';
import { HttpResponse, type JsonBodyType, http as mock } from 'msw';
import { setupServer } from 'msw/node';
import { createPinia, type Pinia, setActivePinia } from 'pinia';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import { Role } from '@/shared/auth/roles';
import { useSessionStore } from '@/shared/auth/session-store';
import { useLoginForm } from './useLoginForm';

const server = setupServer();
const SUCCESS = { code: 200, data: { token: 'jwt-token', roleCode: 'admin', loginName: 'zhangsan' } };

let pinia: Pinia;
let form: ReturnType<typeof useLoginForm>;

// 宿主组件：只把 ElForm 绑定到 useLoginForm，用例直接操作它返回的状态和 submit
const Host = defineComponent({
  setup() {
    form = useLoginForm();
    return () => (
      <ElForm ref={form.formRef} model={form.model} rules={form.rules}>
        <ElFormItem prop="loginName" />
        <ElFormItem prop="password" />
      </ElForm>
    );
  }
});

function mountForm(loginName = '', password = '') {
  mount(Host, { global: { plugins: [pinia] } });
  form.model.loginName = loginName;
  form.model.password = password;
}

// 模拟登录接口，返回收到的请求体列表
function mockLogin(responseBody: JsonBodyType = SUCCESS) {
  const requests: unknown[] = [];
  server.use(
    mock.post('/backend/user/login', async ({ request }) => {
      requests.push(await request.json());
      return HttpResponse.json(responseBody);
    })
  );
  return requests;
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
});

afterAll(() => {
  server.close();
});

describe('useLoginForm', () => {
  it.each([
    ['都未填写', '', ''],
    ['账号只有空格', '   ', 'secret'],
    ['密码未填写', 'zhangsan', '']
  ])('%s时校验不通过，不发请求', async (_, loginName, password) => {
    const requests = mockLogin();
    mountForm(loginName, password);

    await expect(form.submit()).resolves.toBeUndefined();

    expect(requests).toHaveLength(0);
    expect(form.submitting.value).toBe(false);
  });

  it('登录成功时保存并返回会话，账号去掉首尾空格', async () => {
    const requests = mockLogin();
    mountForm('  zhangsan ', 'secret');

    const session = await form.submit();

    expect(session?.user.role).toBe(Role.admin);
    expect(useSessionStore().session).toEqual(session);
    expect(requests).toMatchObject([{ loginName: 'zhangsan' }]);
    expect(form.submitting.value).toBe(false);
  });

  it('登录失败时 errorMessage 是后端的提示，不保存会话；再次提交时先清空', async () => {
    mockLogin({ code: 500, msg: '用户名或密码错误' });
    mountForm('zhangsan', 'wrong');

    await expect(form.submit()).resolves.toBeUndefined();
    expect(form.errorMessage.value).toBe('用户名或密码错误');
    expect(useSessionStore().session).toBeNull();

    mockLogin();
    await form.submit();
    expect(form.errorMessage.value).toBe('');
  });

  it('提交中再次调用会被忽略，只发一次请求', async () => {
    let release: (() => void) | undefined;
    const responded = new Promise<void>(resolve => {
      release = resolve;
    });
    let count = 0;
    server.use(
      mock.post('/backend/user/login', async () => {
        count += 1;
        await responded;
        return HttpResponse.json(SUCCESS);
      })
    );
    mountForm('zhangsan', 'secret');

    const first = form.submit();
    expect(form.submitting.value).toBe(true);
    await expect(form.submit()).resolves.toBeUndefined();

    release?.();
    await first;
    expect(count).toBe(1);
    expect(form.submitting.value).toBe(false);
  });
});
