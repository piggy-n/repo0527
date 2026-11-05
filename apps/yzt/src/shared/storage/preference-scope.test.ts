import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { effectScope } from 'vue';
import { Role } from '../auth/roles';
import { useSessionStore } from '../auth/session-store';
import { createTestJwtExpiringAt } from '../auth/testing';
import { createMemoryStore } from './key-value-store';
import { usePreferenceScope } from './preference-scope';

function login(loginName: string, token = createTestJwtExpiringAt(Date.now() + 3_600_000)) {
  useSessionStore().start({ token, user: { loginName, role: Role.user } });
}

// 在 effectScope 里创建，返回范围和停止作用域的函数
function createScope() {
  const effect = effectScope();
  const scope = effect.run(() => usePreferenceScope({ store: createMemoryStore() }));
  return { scope, stop: () => effect.stop() };
}

beforeEach(() => {
  localStorage.clear();
  setActivePinia(createPinia());
});

describe('usePreferenceScope', () => {
  it('没有登录：null，拥有者就不读不写', () => {
    expect(createScope().scope).toBeNull();
  });

  it('键是创建时固定的登录名（编码）加名称', () => {
    login('张三/admin');
    const { scope, stop } = createScope();

    expect(scope?.key('resource-layers')).toBe('%E5%BC%A0%E4%B8%89%2Fadmin/resource-layers');
    stop();
  });

  it('本标签页退出（清空会话）时立即结束；之后的键不变', () => {
    login('zhangsan');
    const { scope, stop } = createScope();

    useSessionStore().clear();

    expect(scope?.signal.aborted).toBe(true);
    expect(scope?.key('basemap')).toBe('zhangsan/basemap');
    stop();
  });

  it('同一账号重新登录（只换了 token）不结束；换了账号结束', () => {
    login('zhangsan');
    const { scope, stop } = createScope();

    login('zhangsan', createTestJwtExpiringAt(Date.now() + 7_200_000));
    expect(scope?.signal.aborted).toBe(false);
    login('lisi');
    expect(scope?.signal.aborted).toBe(true);
    stop();
  });

  it('作用域销毁（路由离开）时结束', () => {
    login('zhangsan');
    const { scope, stop } = createScope();

    stop();

    expect(scope?.signal.aborted).toBe(true);
  });

  it('不在作用域中调用时抛错', () => {
    expect(() => usePreferenceScope()).toThrow('usePreferenceScope 只能在组件的 setup 或 effectScope 中调用');
  });
});
