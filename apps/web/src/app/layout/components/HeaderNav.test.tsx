import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { Role } from '@/shared/auth/roles';
import { useSessionStore } from '@/shared/auth/session-store';
import { routesWithoutPages } from '../../router/test-routes';
import { HeaderNav } from './HeaderNav';

// 用真实的路由表：导航的权限来自路由的 meta.roles
async function mountNav(role: Role, path: string) {
  const pinia = createPinia();
  setActivePinia(pinia);
  useSessionStore().start({ token: 't', user: { loginName: 'u', role } });
  const router = createRouter({ history: createMemoryHistory(), routes: routesWithoutPages() });
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
      labels: ['资源管理', '现状底图', '查询统计', '文件管理', '系统管理', '智能体'],
      active: '现状底图'
    });
  });

  it('普通用户看到数据下载；在查询统计的子页面时选中查询统计', async () => {
    const wrapper = await mountNav(Role.user, '/land-change-query');

    expect(desktopNav(wrapper)).toEqual({
      labels: ['现状底图', '查询统计', '数据下载', '文件管理', '智能体'],
      active: '查询统计'
    });
  });

  it('智能体在它的页面上选中，展开后只有一列页面、没有分组', async () => {
    const wrapper = await mountNav(Role.user, '/indicator-simulation');
    expect(desktopNav(wrapper).active).toBe('智能体');

    const agent = wrapper.findAll('button').find(button => button.text() === '智能体');
    await agent?.trigger('click');
    await vi.waitFor(() => expect(document.querySelector('[class*="_single_"]')).not.toBeNull());

    const panel = document.querySelector('[class*="_single_"]');
    expect([...(panel?.querySelectorAll('a') ?? [])].map(link => [link.textContent, link.getAttribute('href')])).toEqual([
      ['AI对话', '/ai-chat'],
      ['城市国土空间监测指标AI计算', '/indicator-simulation']
    ]);
    // 查询统计的面板也渲染在 body 下，只看智能体所在的弹层
    expect(panel?.closest('.el-popper')?.querySelector('[class*="_groups_"]')).toBeNull();
  });

  it('专项统计里的驾驶舱是新标签页打开的链接', async () => {
    const wrapper = await mountNav(Role.user, '/current-map');

    const query = wrapper.findAll('button').find(button => button.text() === '查询统计');
    await query?.trigger('click');
    await vi.waitFor(() => expect(document.querySelector('[class*="_groups_"]')).not.toBeNull());
    const special = [...document.querySelectorAll<HTMLElement>('[class*="_groups_"] button')].find(
      button => button.textContent?.trim() === '专项统计'
    );
    special?.dispatchEvent(new MouseEvent('mouseenter'));
    await vi.waitFor(() => expect(document.querySelector('a[href="/city-dashboard"]')).not.toBeNull());

    const dashboard = document.querySelector('a[href="/city-dashboard"]');
    expect([dashboard?.textContent, dashboard?.getAttribute('target'), dashboard?.getAttribute('rel')]).toEqual([
      '驾驶舱',
      '_blank',
      'noopener'
    ]);
  });

  it('链接项渲染为指向对应页面的链接', async () => {
    const wrapper = await mountNav(Role.user, '/current-map');

    expect(wrapper.find('a[href="/file-management"]').exists()).toBe(true);
  });
});
