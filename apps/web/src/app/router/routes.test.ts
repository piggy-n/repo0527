import type { RouteRecordRaw } from 'vue-router';
import { describe, expect, it } from 'vitest';
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
});
