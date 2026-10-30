import type { RouteRecordNameGeneric } from 'vue-router';
import { canAccess, type Role } from '@/shared/auth/roles';
import type { IconName } from '@/shared/icons/SvgIcon';
import { RouteName } from '@/shared/router/route-names';

export interface NavLinkTarget {
  label: string;
  route: RouteName;
}

/** 点击后直接跳转的导航项 */
export interface NavLink extends NavLinkTarget {
  kind: 'link';
  icon: IconName;
  // 同一个页面的其他路由，在这些路由上也显示为选中（如系统管理的统计报表）
  alsoActiveOn?: readonly RouteName[];
}

/** 两级下拉面板中的一组页面 */
export interface NavGroup {
  label: string;
  links: NavLinkTarget[];
}

/** 点击后展开两级下拉面板的导航项 */
export interface NavDropdown {
  kind: 'dropdown';
  label: string;
  icon: IconName;
  groups: NavGroup[];
}

/** 点击后展开一层下拉的导航项：页面少、不分组（如"智能体"） */
export interface NavMenu {
  kind: 'menu';
  label: string;
  icon: IconName;
  links: NavLinkTarget[];
}

// kind 区分三种导航项，判断 kind 后 TS 会收窄到对应的类型
export type NavItem = NavLink | NavDropdown | NavMenu;

// 顶部导航，顺序沿用旧项目：按角色过滤后，正好是两种角色各自的顺序
export const navItems: readonly NavItem[] = [
  { kind: 'link', label: '资源管理', icon: 'nav-resource', route: RouteName.resourceManagement },
  { kind: 'link', label: '现状底图', icon: 'nav-current-map', route: RouteName.currentMap },
  {
    kind: 'dropdown',
    label: '查询统计',
    icon: 'nav-query',
    groups: [
      {
        label: '数据查询',
        links: [
          { label: '国土变更调查', route: RouteName.landChangeQuery },
          { label: '城市国土空间监测', route: RouteName.spaceMonitoringQuery },
          { label: '森林草原湿地荒漠调查监测', route: RouteName.forestGrassWetlandDesertQuery },
          { label: '水资源基础调查', route: RouteName.waterResourceBasicQuery }
        ]
      },
      {
        label: '专项统计',
        links: [
          { label: '城市国土空间监测基本统计', route: RouteName.spaceMonitoringBasicStatistics },
          { label: '城市国土空间监测指标', route: RouteName.spaceMonitoringIndicators }
        ]
      }
    ]
  },
  { kind: 'link', label: '数据下载', icon: 'nav-download', route: RouteName.resourceApplication },
  { kind: 'link', label: '文件管理', icon: 'nav-files', route: RouteName.fileManagement },
  {
    kind: 'link',
    label: '系统管理',
    icon: 'nav-system',
    route: RouteName.systemManagement,
    alsoActiveOn: [RouteName.systemManagementReports]
  },
  {
    kind: 'menu',
    label: '智能体',
    icon: 'nav-ai',
    links: [
      { label: 'AI对话', route: RouteName.aiChat },
      { label: '城市国土空间监测指标AI计算', route: RouteName.indicatorSimulation }
    ]
  }
];

/** 页面允许的角色，由调用方从路由的 meta.roles 取得 */
export type RolesOf = (route: RouteName) => readonly Role[] | undefined;

/** 按角色过滤导航；下拉中没有权限的页面去掉，整组或整项都没有页面时一并去掉 */
export function visibleNavItems(items: readonly NavItem[], role: Role, rolesOf: RolesOf): NavItem[] {
  const allowed = ({ route }: NavLinkTarget) => canAccess(role, rolesOf(route));

  return items.flatMap((item): NavItem[] => {
    if (item.kind === 'link') {
      return allowed(item) ? [item] : [];
    }
    if (item.kind === 'menu') {
      const links = item.links.filter(allowed);
      return links.length > 0 ? [{ ...item, links }] : [];
    }
    const groups = item.groups
      .map(group => ({ ...group, links: group.links.filter(allowed) }))
      .filter(group => group.links.length > 0);
    return groups.length > 0 ? [{ ...item, groups }] : [];
  });
}

/** 导航项是否对应当前页面；链接项的同页路由、下拉面板中任一页面是当前页面时也算 */
export function isNavItemActive(item: NavItem, current: RouteRecordNameGeneric | null | undefined): boolean {
  if (item.kind === 'link') {
    return item.route === current || item.alsoActiveOn?.some(route => route === current) === true;
  }
  return linksOf(item).some(link => link.route === current);
}

/** 下拉项里的全部页面 */
export function linksOf(item: NavDropdown | NavMenu): NavLinkTarget[] {
  return item.kind === 'menu' ? item.links : item.groups.flatMap(group => group.links);
}
