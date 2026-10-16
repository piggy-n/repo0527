// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { mapPageLayout, PHONE_WIDTH } from './map-page-layout';

describe('mapPageLayout', () => {
  it('地图区域窄于 768 时是手机宽度；还量不到宽度（0）时不是', () => {
    expect(mapPageLayout(PHONE_WIDTH - 1, 900).phone).toBe(true);
    expect(mapPageLayout(PHONE_WIDTH, 900).phone).toBe(false);
    expect(mapPageLayout(0, 900).phone).toBe(false);
  });

  it('矮屏：地图区域低于 672 时业务组只显示图标（基础组加了指北针，ADR 0058）', () => {
    expect(mapPageLayout(1440, 672).compactToolbar).toBe(false);
    expect(mapPageLayout(1440, 671).compactToolbar).toBe(true);
  });

  it('手机宽度时还要放下叠在基础组上面的两张卡片：低于 804 就只显示图标', () => {
    expect(mapPageLayout(375, 804).compactToolbar).toBe(false);
    expect(mapPageLayout(375, 803).compactToolbar).toBe(true);
    // 375 × 812 的手机，地图区域 737
    expect(mapPageLayout(375, 737)).toStrictEqual({ phone: true, compactToolbar: true });
  });

  it('还量不到高度（0）时按常规显示文字', () => {
    expect(mapPageLayout(375, 0).compactToolbar).toBe(false);
  });
});
