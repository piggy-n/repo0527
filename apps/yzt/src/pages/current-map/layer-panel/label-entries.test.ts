// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { labelMenuEntries, labelToolItem } from './label-entries';

const ROW = { model: false, labelable: true, labeled: false };

describe('标注的入口（ADR 0160）', () => {
  it('工具栏的"标注"：没有选中时、三维模型、没有登记字段的资源不能用，提示写出原因；开着浮层时按下', () => {
    expect(labelToolItem(ROW, true)).toStrictEqual({
      key: 'label',
      icon: 'map-label',
      label: '图层标注',
      tip: '标注',
      disabled: false,
      pressed: true
    });
    expect(labelToolItem(null, false)).toMatchObject({ disabled: true, tip: '标注' });
    expect(labelToolItem({ ...ROW, model: true }, false)).toMatchObject({ disabled: true, tip: '三维模型没有标注' });
    expect(labelToolItem({ ...ROW, labelable: false }, false)).toMatchObject({ disabled: true, tip: '没有可标注的字段' });
  });

  it('右键菜单：开着标注时写"隐藏标注"，否则"显示标注"，后面是"标注…"；不能用时两项都灰掉、写出原因', () => {
    expect(labelMenuEntries(ROW).map(entry => (entry === 'divider' ? entry : [entry.key, entry.label]))).toStrictEqual([
      ['label-visible', '显示标注'],
      ['label', '标注…']
    ]);
    expect(labelMenuEntries({ ...ROW, labeled: true })[0]).toMatchObject({ label: '隐藏标注', icon: 'map-label-off' });
    expect(labelMenuEntries({ ...ROW, labelable: false })).toStrictEqual([
      { key: 'label-visible', label: '显示标注', icon: 'map-label', disabled: true, hint: '没有可标注的字段' },
      { key: 'label', label: '标注…', icon: 'symbol-settings', disabled: true, hint: '没有可标注的字段' }
    ]);
  });
});
