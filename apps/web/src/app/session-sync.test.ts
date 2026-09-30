import { ElMessage } from 'element-plus';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { Role } from '@/shared/auth/roles';
import { type Session, useSessionStore } from '@/shared/auth/session-store';
import { createTestJwtExpiringAt } from '@/shared/auth/testing';
import { RouteName } from '@/shared/router/route-names';
import { setupSessionSync } from './session-sync';

const STORAGE_KEY = 'yzt.session';
const Empty = { render: () => null };
const sessionA: Session = {
  token: createTestJwtExpiringAt(Date.now() + 3_600_000),
  user: { loginName: 'zhangsan', role: Role.user }
};
// 同一账号重新登录，token 不同
const sessionA2: Session = { ...sessionA, token: createTestJwtExpiringAt(Date.now() + 5_400_000) };
const sessionB: Session = {
  token: createTestJwtExpiringAt(Date.now() + 7_200_000),
  user: { loginName: 'lisi', role: Role.user }
};

let router: Router;
let reloadPage: ReturnType<typeof vi.fn<() => void>>;
let stop: () => void;

beforeEach(async () => {
  localStorage.clear();
  setActivePinia(createPinia());
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/login', name: RouteName.login, component: Empty, meta: { public: true } },
      { path: '/current-map', name: RouteName.currentMap, component: Empty }
    ]
  });
  await router.push('/current-map');
  reloadPage = vi.fn<() => void>();
  stop = setupSessionSync(router, reloadPage);
});

afterEach(() => {
  stop();
  vi.restoreAllMocks();
});

// 模拟其他标签页修改会话：浏览器只向其他标签页派发 storage 事件，这里手动派发
function changeInOtherTab(session: Session | null) {
  if (session) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
  window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }));
}

describe('setupSessionSync', () => {
  it('其他标签页换账号登录时，同步会话并重新加载页面', () => {
    useSessionStore().start(sessionA);

    changeInOtherTab(sessionB);

    expect(useSessionStore().token).toBe(sessionB.token);
    expect(reloadPage).toHaveBeenCalledOnce();
  });

  it('本标签页未登录、其他标签页登录时，重新加载页面', () => {
    changeInOtherTab(sessionB);

    expect(reloadPage).toHaveBeenCalledOnce();
  });

  it('其他标签页用同一账号重新登录时，只更新 token', () => {
    useSessionStore().start(sessionA);

    changeInOtherTab(sessionA2);

    expect(useSessionStore().token).toBe(sessionA2.token);
    expect(reloadPage).not.toHaveBeenCalled();
    expect(router.currentRoute.value.name).toBe(RouteName.currentMap);
  });

  it('其他标签页退出时，清空本标签页的会话、提示并回到登录页', async () => {
    const warning = vi.spyOn(ElMessage, 'warning').mockReturnValue({ close: () => undefined });
    useSessionStore().start(sessionA);

    changeInOtherTab(null);

    expect(useSessionStore().session).toBeNull();
    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe(RouteName.login));
    expect(warning).toHaveBeenCalledOnce();
    expect(reloadPage).not.toHaveBeenCalled();
  });

  it('在公开页面时其他标签页退出，只清空会话，不提示也不跳转', async () => {
    const warning = vi.spyOn(ElMessage, 'warning').mockReturnValue({ close: () => undefined });
    await router.push('/login');
    useSessionStore().start(sessionA);

    changeInOtherTab(null);

    expect(useSessionStore().session).toBeNull();
    expect(router.currentRoute.value.name).toBe(RouteName.login);
    expect(warning).not.toHaveBeenCalled();
  });
});
