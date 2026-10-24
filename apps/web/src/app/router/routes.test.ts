import { createMemoryHistory, createRouter, type RouteRecordRaw } from 'vue-router';
import { describe, expect, it } from 'vitest';
import { Role } from '@/shared/auth/roles';
import { RouteName } from '@/shared/router/route-names';
import { routes } from './routes';

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
      RouteName.devAiChat,
      RouteName.devSystemManagement,
      RouteName.devMessageCenter,
      RouteName.devDataQuery,
      RouteName.devMap,
      RouteName.devResources,
      RouteName.devMapUi,
      RouteName.devMap3d,
      RouteName.devNavGrid
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
  it('只有现状底图切走时缓存', () => {
    const cached = records.filter(({ meta }) => meta?.keepAlive).map(({ name }) => String(name));

    expect(cached).toEqual([RouteName.currentMap]);
  });

  it('限定角色的页面与旧项目一致', () => {
    const restricted = records
      .filter(({ meta }) => meta?.roles !== undefined)
      .map(({ name, meta }) => [String(name), meta?.roles]);

    expect(Object.fromEntries(restricted)).toEqual({
      [RouteName.resourceManagement]: [Role.admin],
      [RouteName.systemManagement]: [Role.admin],
      [RouteName.resourceApplication]: [Role.user]
    });
  });

  it('系统管理保留两个旧地址，共用管理员权限并通过 props 区分栏目', () => {
    const router = createRouter({ history: createMemoryHistory(), routes });
    const audit = router.resolve('/system-management');
    const reports = router.resolve('/system-management/statistical-report');
    expect(audit.name).toBe(RouteName.systemManagement);
    expect(reports.name).toBe(RouteName.systemManagement);
    expect(reports.meta.roles).toEqual([Role.admin]);
    const record = records.find(item => item.name === RouteName.systemManagement);
    const props = record?.props;
    expect(typeof props).toBe('function');
    if (typeof props !== 'function') {
      throw new Error('系统管理需要通过路由 props 选择栏目');
    }
    expect(props({ ...audit, name: RouteName.systemManagement }))
      .toEqual({ section: 'audit', applicationId: undefined });
    expect(props({ ...reports, name: RouteName.systemManagement }))
      .toEqual({ section: 'reports', applicationId: undefined });
    expect(props({ ...audit, name: RouteName.systemManagement, query: { applicationId: 'one' } }))
      .toMatchObject({ applicationId: 'one' });
    expect(props({ ...audit, name: RouteName.systemManagement, query: { applicationId: ['one', 'two'] } }))
      .toMatchObject({ applicationId: undefined });
    expect(router.resolve('/system-management/unknown').name).toBe(RouteName.notFound);
  });

  it('消息中心由 Header 弹框承载，不保留独立页面', () => {
    const router = createRouter({ history: createMemoryHistory(), routes });
    expect(router.resolve('/message-center').name).toBe(RouteName.notFound);
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
