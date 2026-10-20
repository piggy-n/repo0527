// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { mapPageLayout, PHONE_WIDTH } from './map-page-layout';

describe('mapPageLayout', () => {
  it('地图区域窄于 768 时是手机宽度；还量不到宽度（0）时不是', () => {
    expect(mapPageLayout(PHONE_WIDTH - 1, 900).phone).toBe(true);
    expect(mapPageLayout(PHONE_WIDTH, 900).phone).toBe(false);
    expect(mapPageLayout(0, 900).phone).toBe(false);
  });

  it('地图区域低于 680 时业务组分成两列，留出基础组和底图入口的高度', () => {
    expect(mapPageLayout(1440, 680).toolbarColumns).toBe(false);
    expect(mapPageLayout(1440, 679).toolbarColumns).toBe(true);
  });

  it('窄屏和宽屏的底图入口都在基础组下方，使用同一个高度规则', () => {
    expect(mapPageLayout(375, 680).toolbarColumns).toBe(false);
    expect(mapPageLayout(375, 679).toolbarColumns).toBe(true);
    expect(mapPageLayout(375, 737)).toStrictEqual({ phone: true, toolbarColumns: false });
  });

  it('还量不到高度（0）时按单列显示', () => {
    expect(mapPageLayout(375, 0).toolbarColumns).toBe(false);
  });
});
