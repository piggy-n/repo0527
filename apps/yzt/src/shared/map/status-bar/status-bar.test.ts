// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  belowSurface,
  eyeHeightLabel,
  eyeText,
  fitStatusLayout,
  formatLength,
  scaleBar,
  visibleAngles
} from './status-bar';

describe('scaleBar', () => {
  it('取不超过 80 像素的整齐长度，线段长度按每像素的米数换算', () => {
    // 南京第 9 级：100 像素约 12960 米，80 像素约 10368 米
    expect(scaleBar(12960)).toStrictEqual({ meters: 10000, width: 10000 / 129.6, label: '10 km' });
    // 80 像素正好是 1000 米时取 1000 米
    expect(scaleBar(1250)).toStrictEqual({ meters: 1000, width: 80, label: '1 km' });
    // 80 像素约 4000 米时取 2000 米，约 600 米时取 500 米
    expect(scaleBar(5000)?.meters).toBe(2000);
    expect(scaleBar(750)?.meters).toBe(500);
  });

  it('各级别的线段都在 32～80 像素之间，长度是 1、2、5 × 10ⁿ 米', () => {
    for (let exponent = -1; exponent <= 7; exponent += 0.01) {
      const bar = scaleBar(10 ** exponent);
      expect(bar).not.toBeNull();
      const { meters, width } = bar ?? { meters: 0, width: 0 };
      expect(width).toBeLessThanOrEqual(80);
      expect(width).toBeGreaterThan(32);
      const mantissa = meters / 10 ** Math.floor(Math.log10(meters) + 1e-9);
      expect([1, 2, 5]).toContain(Math.round(mantissa * 1e6) / 1e6);
    }
  });

  it('距离不是正数时为 null', () => {
    expect(scaleBar(0)).toBeNull();
    expect(scaleBar(-10)).toBeNull();
    expect(scaleBar(Number.NaN)).toBeNull();
    expect(scaleBar(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('formatLength', () => {
  it('满 1000 米写 km', () => {
    expect(formatLength(0.5)).toBe('0.5 m');
    expect(formatLength(500)).toBe('500 m');
    expect(formatLength(1000)).toBe('1 km');
    expect(formatLength(20000)).toBe('20 km');
  });
});

describe('eyeHeightLabel', () => {
  it('不到 1 km 写整米，不到 10 km 保留一位小数，再高写整千米；分档按取整后的值', () => {
    expect(eyeHeightLabel(120.4)).toBe('120 m');
    expect(eyeHeightLabel(999.6)).toBe('1.0 km');
    expect(eyeHeightLabel(2400)).toBe('2.4 km');
    expect(eyeHeightLabel(9960)).toBe('10 km');
    expect(eyeHeightLabel(420_300)).toBe('420 km');
  });
});

describe('eyeText', () => {
  it('地表以上写视点高度；在地表以下（取整后）写视点在地表以下多少米', () => {
    expect(eyeText(120.4)).toBe('视点高度 120 m');
    expect(eyeText(-0.4)).toBe('视点高度 0 m');
    expect(eyeText(-3.4)).toBe('视点在地表以下 3 m');
    expect(eyeText(-1250)).toBe('视点在地表以下 1.3 km');
    expect([belowSurface(-0.4), belowSurface(-0.6), belowSurface(3)]).toStrictEqual([false, true, false]);
  });
});

describe('visibleAngles', () => {
  it('取整后为 0 的不显示；旋转在 -179～180 之间', () => {
    expect(visibleAngles({ bearing: 0.4, pitch: -0.4 })).toStrictEqual({ bearing: null, pitch: null });
    expect(visibleAngles({ bearing: 15.4, pitch: 30.6 })).toStrictEqual({ bearing: 15, pitch: 31 });
    expect(visibleAngles({ bearing: -2, pitch: 0 })).toStrictEqual({ bearing: -2, pitch: null });
    expect(visibleAngles({ bearing: 358, pitch: 0 })).toStrictEqual({ bearing: -2, pitch: null });
    expect(visibleAngles({ bearing: -180, pitch: 0 })).toStrictEqual({ bearing: 180, pitch: null });
    expect(visibleAngles({ bearing: 359.6, pitch: 0 })).toStrictEqual({ bearing: null, pitch: null });
  });
});

describe('fitStatusLayout', () => {
  const WIDTHS = { full: 443, 'no-angles': 322, 'scale-only': 133 };

  it('先去掉旋转和俯仰，再去掉经纬度；比例尺一直保留', () => {
    expect(fitStatusLayout(WIDTHS, 860)).toBe('full');
    expect(fitStatusLayout(WIDTHS, 443)).toBe('full');
    expect(fitStatusLayout(WIDTHS, 442)).toBe('no-angles');
    expect(fitStatusLayout(WIDTHS, 188)).toBe('scale-only');
    expect(fitStatusLayout(WIDTHS, 100)).toBe('scale-only');
  });

  it('还量不到可用宽度时全部显示', () => {
    expect(fitStatusLayout(WIDTHS, 0)).toBe('full');
    expect(fitStatusLayout(WIDTHS, Number.NaN)).toBe('full');
  });
});
