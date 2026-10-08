import { flushPromises, mount } from '@vue/test-utils';
import { ElMessage, ElMessageBox, type MessageBoxData } from 'element-plus';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { Role } from '@/shared/auth/roles';
import { useSessionStore } from '@/shared/auth/session-store';
import { RouteName } from '@/shared/router/route-names';
import { queryClient } from '../../query-client';
import { UserMenu } from './UserMenu';

const Empty = { render: () => null };
let router: Router;

async function mountMenu() {
  const pinia = createPinia();
  setActivePinia(pinia);
  useSessionStore().start({ token: 't', user: { loginName: 'zhangsan', realName: '张三', role: Role.user } });
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/login', name: RouteName.login, component: Empty },
      { path: '/current-map', name: RouteName.currentMap, component: Empty }
    ]
  });
  await router.push('/current-map');
  const wrapper = mount(UserMenu, { global: { plugins: [pinia, router] }, attachTo: document.body });
  // 打开下拉菜单，菜单内容渲染在 body 下
  await wrapper.find('button').trigger('click');
  await vi.waitFor(() => expect(document.body.textContent).toContain('退出登录'));
  return wrapper;
}

function clickLogout() {
  const item = [...document.querySelectorAll<HTMLElement>('.el-dropdown-menu__item')].find(element =>
    element.textContent?.includes('退出登录')
  );
  item?.click();
}

beforeEach(() => {
  localStorage.clear();
  queryClient.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('UserMenu', () => {
  it('显示名字、登录名与角色', async () => {
    await mountMenu();

    expect(document.body.textContent).toContain('张三');
    expect(document.body.textContent).toContain('zhangsan · 普通用户');
  });

  it('确认退出后清空会话和查询缓存、回到登录页并提示', async () => {
    // Element 把返回值声明为对象与字符串的交叉类型，实际点击确定时返回 'confirm'
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as MessageBoxData);
    const success = vi.spyOn(ElMessage, 'success').mockReturnValue({ close: () => undefined });
    await mountMenu();
    queryClient.setQueryData(['files'], ['上一个账号的数据']);

    clickLogout();
    await flushPromises();

    await vi.waitFor(() => expect(router.currentRoute.value.name).toBe(RouteName.login));
    expect(useSessionStore().session).toBeNull();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(success).toHaveBeenCalledWith('已退出登录');
  });

  it('取消退出时保持登录', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel');
    await mountMenu();

    clickLogout();
    await flushPromises();

    expect(router.currentRoute.value.name).toBe(RouteName.currentMap);
    expect(useSessionStore().session).not.toBeNull();
  });
});
