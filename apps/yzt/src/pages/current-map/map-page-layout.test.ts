// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { mapPageLayout, PHONE_WIDTH } from './map-page-layout';

// 现状底图的业务组：6 组 10 个按钮；三维原型没有打印
const CURRENT_MAP = [
  ['browse', 'feature-pick'],
  ['measure-distance', 'measure-area'],
  ['region-locate', 'coordinate-locate'],
  ['boundaries', 'legend'],
  ['print'],
  ['clear']
];
const PROTOTYPE = CURRENT_MAP.filter(group => !group.includes('print'));

describe('mapPageLayout', () => {
  it('地图区域窄于 768 时是手机宽度；还量不到宽度（0）时不是', () => {
    expect(mapPageLayout(PHONE_WIDTH - 1, 900, CURRENT_MAP).phone).toBe(true);
    expect(mapPageLayout(PHONE_WIDTH, 900, CURRENT_MAP).phone).toBe(false);
    expect(mapPageLayout(0, 900, CURRENT_MAP).phone).toBe(false);
  });

  it('地图区域低于业务组排成一列的高度时分成两列：现状底图是 733，少一组、一个按钮的三维原型是 692', () => {
    expect(mapPageLayout(1440, 733, CURRENT_MAP).toolbarColumns).toBe(false);
    expect(mapPageLayout(1440, 732, CURRENT_MAP).toolbarColumns).toBe(true);
    expect(mapPageLayout(1440, 692, PROTOTYPE).toolbarColumns).toBe(false);
    expect(mapPageLayout(1440, 691, PROTOTYPE).toolbarColumns).toBe(true);
  });

  it('窄屏和宽屏的底图入口都在基础组下方，使用同一个高度规则', () => {
    expect(mapPageLayout(375, 733, CURRENT_MAP).toolbarColumns).toBe(false);
    expect(mapPageLayout(375, 732, CURRENT_MAP).toolbarColumns).toBe(true);
    expect(mapPageLayout(375, 737, CURRENT_MAP)).toStrictEqual({ phone: true, toolbarColumns: false });
  });

  it('还量不到高度（0）时按单列显示', () => {
    expect(mapPageLayout(375, 0, CURRENT_MAP).toolbarColumns).toBe(false);
  });
});
