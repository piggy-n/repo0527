import { MxSplitLayout } from '@yzt/ui';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import { RouteName } from '../router/route-names';
import { SideNav, type SideNavItem } from './SideNav';

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

const items: SideNavItem[] = [
  { label: '资源审核', icon: 'menu-audit', route: RouteName.systemManagement },
  { label: '统计报表', icon: 'menu-report', route: RouteName.systemManagementReports }
];

const Layout = defineComponent(() => () => (
  <MxSplitLayout asideType="menu" asideLabel="系统管理">
    {{
      aside: () => <SideNav label="系统管理" items={items} />,
      default: () => <main />
    }}
  </MxSplitLayout>
));

async function mountAt(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/system-management', name: RouteName.systemManagement, component: Layout },
      { path: '/system-management/statistical-report', name: RouteName.systemManagementReports, component: Layout }
    ]
  });
  await router.push(path);
  const wrapper = mount(() => h(RouterView), { global: { plugins: [router] }, attachTo: document.body });
  await flushPromises();
  return { router, wrapper };
}

// 抽屉打开时内容移进 body 下的抽屉里，所以在整个页面里找
const links = () => [...document.querySelectorAll<HTMLAnchorElement>('nav[aria-label="系统管理"] a')];
const current = () => links().find(link => link.getAttribute('aria-current') === 'page')?.textContent;

describe('SideNav', () => {
  it('菜单项是链接，当前页标上 aria-current；查询参数不影响当前页', async () => {
    const { router } = await mountAt('/system-management');
    expect(links().map(link => [link.textContent, link.getAttribute('href')])).toEqual([
      ['资源审核', '/system-management'],
      ['统计报表', '/system-management/statistical-report']
    ]);
    expect(current()).toBe('资源审核');

    await router.push({ name: RouteName.systemManagement, query: { apply: 'apply-1' } });
    expect(current()).toBe('资源审核');

    await router.push({ name: RouteName.systemManagementReports });
    expect(current()).toBe('统计报表');
  });

  it('点菜单项跳到对应的路由', async () => {
    const { router } = await mountAt('/system-management');
    links()[1]?.click();
    await flushPromises();
    expect(router.currentRoute.value.name).toBe(RouteName.systemManagementReports);
  });

  it('窄屏：在抽屉里点了菜单项就关闭抽屉', async () => {
    // jsdom 没有 matchMedia，模拟一个始终是窄屏的版本
    vi.stubGlobal('matchMedia', (media: string) => ({
      media,
      matches: true,
      addEventListener: () => undefined,
      removeEventListener: () => undefined
    }));
    const { wrapper, router } = await mountAt('/system-management');
    await wrapper.findAll('button').find(button => button.text() === '系统管理')?.trigger('click');
    await vi.waitFor(() => expect(document.querySelector('.el-drawer nav')).not.toBeNull());

    links()[1]?.click();
    await flushPromises();
    expect(router.currentRoute.value.name).toBe(RouteName.systemManagementReports);
    await vi.waitFor(() => expect(document.querySelector<HTMLElement>('.el-overlay')?.style.display).toBe('none'));
  });
});
