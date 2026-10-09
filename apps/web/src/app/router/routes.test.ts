import type { RouteRecordRaw } from 'vue-router';
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

    expect(publicNames.toSorted()).toEqual([RouteName.login, RouteName.notFound, RouteName.themePreview, RouteName.devMap].toSorted());
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
});
