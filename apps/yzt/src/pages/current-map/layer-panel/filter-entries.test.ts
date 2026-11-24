// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { filterMenuEntry, filterToolItem } from './filter-entries';

const ROW = { model: false, filterable: true, filtering: false };

describe('要素过滤的入口（ADR 0173）', () => {
  it('工具栏的"过滤"：没有选中时、三维模型、没有可过滤字段的资源不能用，提示写出原因；开着浮层时按下', () => {
    expect(filterToolItem(ROW, true)).toStrictEqual({
      key: 'filter',
      icon: 'layer-filter',
      label: '图层过滤',
      tip: '过滤',
      disabled: false,
      pressed: true
    });
    expect(filterToolItem({ ...ROW, filtering: true }, false)).toMatchObject({ disabled: false, tip: '过滤（已过滤）' });
    expect(filterToolItem(null, false)).toMatchObject({ disabled: true, tip: '过滤' });
    expect(filterToolItem({ ...ROW, model: true }, false)).toMatchObject({ disabled: true, tip: '三维模型没有属性过滤' });
    expect(filterToolItem({ ...ROW, filterable: false }, false)).toMatchObject({
      disabled: true,
      tip: '没有可过滤的字段'
    });
  });

  it('右键菜单的"过滤…"：不能用时灰掉、写出原因', () => {
    expect(filterMenuEntry(ROW)).toStrictEqual({ key: 'filter', label: '过滤…', icon: 'layer-filter', disabled: false });
    expect(filterMenuEntry({ ...ROW, filterable: false })).toStrictEqual({
      key: 'filter',
      label: '过滤…',
      icon: 'layer-filter',
      disabled: true,
      hint: '没有可过滤的字段'
    });
  });
});
