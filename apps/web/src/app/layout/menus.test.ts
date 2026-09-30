import { describe, expect, it } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { Role } from '@/shared/auth/roles';
import { RouteName } from '@/shared/router/route-names';
import { routes } from '../router/routes';
import { isNavItemActive, type NavItem, navItems, visibleNavItems } from './menus';

// 用真实的路由表取页面权限，同时检查菜单与路由的 meta.roles 是否一致
const router = createRouter({ history: createMemoryHistory(), routes });
const rolesOf = (route: RouteName) => router.resolve({ name: route }).meta.roles;
const labels = (items: NavItem[]) => items.map(({ label }) => label);

describe('visibleNavItems', () => {
  it('两种角色看到的导航与旧项目一致', () => {
    expect(labels(visibleNavItems(navItems, Role.admin, rolesOf))).toEqual([
      '资源管理',
      '现状底图',
      '查询统计',
      '文件管理',
      '系统管理',
      'AI对话'
    ]);
    expect(labels(visibleNavItems(navItems, Role.user, rolesOf))).toEqual([
      '现状底图',
      '查询统计',
      '数据下载',
      '文件管理',
      'AI对话'
    ]);
  });

  it('导航中的每个页面都在路由表中', () => {
    const targets = navItems.flatMap(item =>
      item.kind === 'link' ? [item.route] : item.groups.flatMap(group => group.links.map(({ route }) => route))
    );

    expect(targets.filter(route => !router.hasRoute(route))).toEqual([]);
  });

  it('下拉面板中没有权限的页面被去掉，整组都没有权限时去掉整组', () => {
    const onlyAdmin = new Set<RouteName>([RouteName.spaceMonitoringBasicStatistics, RouteName.spaceMonitoringIndicators]);
    const items = visibleNavItems(navItems, Role.user, route => (onlyAdmin.has(route) ? [Role.admin] : undefined));
    const query = items.find(item => item.kind === 'dropdown');

    expect(query?.kind === 'dropdown' && query.groups.map(({ label }) => label)).toEqual(['数据查询']);
  });

  it('下拉面板中的页面都没有权限时去掉整项', () => {
    const items = visibleNavItems(navItems, Role.user, () => [Role.admin]);

    expect(items).toEqual([]);
  });
});

describe('isNavItemActive', () => {
  const [, currentMap, query] = navItems;

  it('链接项在对应页面时选中', () => {
    expect(currentMap && isNavItemActive(currentMap, RouteName.currentMap)).toBe(true);
    expect(currentMap && isNavItemActive(currentMap, RouteName.fileManagement)).toBe(false);
  });

  it('下拉项在其中任一页面时选中', () => {
    expect(query && isNavItemActive(query, RouteName.spaceMonitoringIndicators)).toBe(true);
    expect(query && isNavItemActive(query, RouteName.currentMap)).toBe(false);
    expect(query && isNavItemActive(query, undefined)).toBe(false);
  });
});
