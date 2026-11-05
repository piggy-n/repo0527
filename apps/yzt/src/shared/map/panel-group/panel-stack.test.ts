// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { panelStackHeight, panelStackLayout, type PanelStackInput } from './panel-stack';

const input: PanelStackInput = {
  height: 700,
  functionsOpen: true,
  detailOpen: true,
  preferred: 'detail',
  collapsed: { functions: false, detail: false }
};

describe('panelStackLayout', () => {
  it('两个内容能放下时功能最多占 40%，只有功能时使用整列', () => {
    expect(panelStackLayout(input)).toStrictEqual({
      collapsed: { functions: false, detail: false },
      functionsMaxHeight: 280
    });
    expect(panelStackLayout({ ...input, detailOpen: false }).functionsMaxHeight).toBe(700);
  });

  it('空间不足只收起非当前面板，恢复高度后自动恢复', () => {
    expect(panelStackLayout({ ...input, height: 400 }).collapsed).toStrictEqual({
      functions: true, detail: false
    });
    expect(panelStackLayout({ ...input, height: 400, preferred: 'functions' })).toStrictEqual({
      collapsed: { functions: false, detail: true },
      functionsMaxHeight: 340
    });
    expect(panelStackLayout(input).collapsed).toStrictEqual({ functions: false, detail: false });
  });

  it('手动收起保留，给另一块留出整列减标题与间距的空间', () => {
    const collapsed = { functions: false, detail: true };
    expect(panelStackLayout({ ...input, collapsed }).functionsMaxHeight).toBe(640);
    expect(panelStackLayout({ ...input, height: 400, collapsed }).collapsed).toStrictEqual(collapsed);
  });

  it('还量不到尺寸不自动收起', () => {
    expect(panelStackLayout({ ...input, height: 0 })).toStrictEqual({
      collapsed: { functions: false, detail: false },
      functionsMaxHeight: undefined
    });
  });
});

describe('panelStackHeight', () => {
  it('浮层展开或高度变化时让出空间，关闭恢复，浮层在列外时不增加列高', () => {
    expect(panelStackHeight(700, 90, null)).toBe(700);
    expect(panelStackHeight(700, 90, 700)).toBe(598);
    expect(panelStackHeight(700, 90, 660)).toBe(558);
    expect(panelStackHeight(700, 90, 900)).toBe(700);
    expect(panelStackHeight(700, 90, 80)).toBe(0);
  });
});
