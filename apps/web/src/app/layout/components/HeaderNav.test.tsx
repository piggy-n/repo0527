import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { Role } from '@/shared/auth/roles';
import { useSessionStore } from '@/shared/auth/session-store';
import { routes } from '../../router/routes';
import { HeaderNav } from './HeaderNav';

// 用真实的路由表：导航的权限来自路由的 meta.roles
async function mountNav(role: Role, path: string) {
  const pinia = createPinia();
  setActivePinia(pinia);
  useSessionStore().start({ token: 't', user: { loginName: 'u', role } });
  const router = createRouter({ history: createMemoryHistory(), routes });
  await router.push(path);
  return mount(HeaderNav, { global: { plugins: [pinia, router] }, attachTo: document.body });
}

// 桌面导航中各项的文字，以及被标为当前页的那一项
function desktopNav(wrapper: Awaited<ReturnType<typeof mountNav>>) {
  const desktop = wrapper.find('[class*="_desktop_"]');
  return {
    labels: [...desktop.element.children].map(element => element.textContent?.trim()),
    active: desktop.find('[class*="_active_"]').text()
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('HeaderNav', () => {
  it('管理员看到资源管理和系统管理，当前页被选中', async () => {
    const wrapper = await mountNav(Role.admin, '/current-map');

    expect(desktopNav(wrapper)).toEqual({
      labels: ['资源管理', '现状底图', '查询统计', '文件管理', '系统管理', 'AI对话'],
      active: '现状底图'
    });
  });

  it('普通用户看到数据下载；在查询统计的子页面时选中查询统计', async () => {
    const wrapper = await mountNav(Role.user, '/land-change-query');

    expect(desktopNav(wrapper)).toEqual({
      labels: ['现状底图', '查询统计', '数据下载', '文件管理', 'AI对话'],
      active: '查询统计'
    });
  });

  it('链接项渲染为指向对应页面的链接', async () => {
    const wrapper = await mountNav(Role.user, '/current-map');

    expect(wrapper.find('a[href="/file-management"]').exists()).toBe(true);
  });
});
