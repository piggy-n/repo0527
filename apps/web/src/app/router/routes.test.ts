import type { RouteRecordRaw } from 'vue-router';
import { describe, expect, it } from 'vitest';
import { Role } from '@/shared/auth/roles';
import { RouteName } from '@/shared/router/route-names';
import { auditRouteProps, routes } from './routes';

function flatten(records: readonly RouteRecordRaw[]): RouteRecordRaw[] {
  return records.flatMap(record => [record, ...flatten(record.children ?? [])]);
}

describe('路由表', () => {
  const records = flatten(routes);

  it('路由名不重复', () => {
    const names = records.flatMap(({ name }) => (name === undefined ? [] : [name]));
    const duplicated = names.filter((name, index) => names.indexOf(name) !== index);

    expect(duplicated).toEqual([]);
  });

  it('渲染页面的路由都有标题', () => {
    const pages = records.filter(record => record.component !== undefined && record.children === undefined);
    const untitled = pages.filter(({ meta }) => !meta?.title).map(({ path }) => path);

    expect(untitled).toEqual([]);
  });

  // public 会跳过登录检查，新增公开页面时要同步修改这里
  it('只有登录页、404 和开发页面不需要登录', () => {
    const publicNames = records.filter(({ meta }) => meta?.public).map(({ name }) => String(name));

    expect(publicNames.toSorted()).toEqual([
      RouteName.login,
      RouteName.notFound,
      RouteName.devTheme,
      RouteName.devFileManagement,
      RouteName.devResourceManagement,
      RouteName.devMap,
      RouteName.devResources,
      RouteName.devMapUi,
      RouteName.devMap3d,
      RouteName.devNavGrid,
      RouteName.devSystemManagement,
      RouteName.devMessageCenter,
      RouteName.devMonitoringIndicators,
      RouteName.devMonitoringStatistics,
      RouteName.devIndicatorSimulation,
      RouteName.devDataQuery
    ].toSorted());
  });

  // 开发页面的约定见 AGENTS.md：页面在 pages/dev/<名称>/，路径 /dev/<名称>，路由名的值 dev-<名称>
  it('开发页面的路径和路由名相互对应', () => {
    const devRecords = records.filter(({ path, name }) => path.startsWith('/dev/') || String(name).startsWith('dev-'));
    const pairs = devRecords.map(({ path, name }) => [path, String(name)]);

    expect(pairs.length).toBeGreaterThan(0);
    expect(pairs).toEqual(devRecords.map(({ path }) => [path, `dev-${path.slice('/dev/'.length)}`]));
  });

  // 缓存的页面在布局里常驻、会话期间不释放（ADR 0063），新增时要同步修改这里
  it('现状底图和指标智能推演切走时缓存', () => {
    const cached = records.filter(({ meta }) => meta?.keepAlive).map(({ name }) => String(name));

    expect(cached).toEqual([RouteName.currentMap, RouteName.indicatorSimulation]);
  });

  it('限定角色的页面与旧项目一致', () => {
    const restricted = records
      .filter(({ meta }) => meta?.roles !== undefined)
      .map(({ name, meta }) => [String(name), meta?.roles]);

    expect(Object.fromEntries(restricted)).toEqual({
      [RouteName.resourceManagement]: [Role.admin],
      [RouteName.systemManagement]: [Role.admin],
      [RouteName.systemManagementReports]: [Role.admin],
      [RouteName.resourceApplication]: [Role.user]
    });
  });

  it('系统管理的资源审核把查询参数 apply 交给页面；空值和写了几次的不认', () => {
    expect(records.find(({ name }) => name === RouteName.systemManagement)?.props).toBe(auditRouteProps);

    expect(auditRouteProps({ query: { apply: 'apply-1' } })).toEqual({ section: 'audit', applyId: 'apply-1' });
    expect(auditRouteProps({ query: {} })).toEqual({ section: 'audit', applyId: null });
    expect(auditRouteProps({ query: { apply: '' } })).toEqual({ section: 'audit', applyId: null });
    expect(auditRouteProps({ query: { apply: ['a', 'b'] } })).toEqual({ section: 'audit', applyId: null });
  });

  it('驾驶舱独立懒加载，所有登录角色可访问且离开即释放', () => {
    const dashboard = routes.find(record => record.name === RouteName.cityDashboard);
    expect(dashboard?.path).toBe('/city-dashboard');
    expect(typeof dashboard?.component).toBe('function');
    expect(dashboard?.meta?.public).not.toBe(true);
    expect(dashboard?.meta?.roles).toBeUndefined();
    expect(dashboard?.meta?.keepAlive).not.toBe(true);
  });
});
