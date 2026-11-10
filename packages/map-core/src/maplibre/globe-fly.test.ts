// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { sameCenterOnGlobe, zoomFlightDuration } from './globe-fly';

// 纬度上差这么多度约 1 米
const METER = 1 / 111320;

describe('sameCenterOnGlobe', () => {
  it('同一个点算相同', () => {
    expect(sameCenterOnGlobe([117.18, 34.26], [117.18, 34.26])).toBe(true);
  });

  it('差 0.2 米以内点积还可能舍入到 1 以上，都算相同', () => {
    expect(sameCenterOnGlobe([117.18, 34.26], [117.18, 34.26 + 0.2 * METER])).toBe(true);
    expect(sameCenterOnGlobe([117.18, 34.26], [117.18, 34.26 + 0.5 * METER])).toBe(true);
  });

  it('差 2 米算不同：走 flyTo', () => {
    expect(sameCenterOnGlobe([117.18, 34.26], [117.18, 34.26 + 2 * METER])).toBe(false);
    expect(sameCenterOnGlobe([117.18, 34.26], [117.18 + 3 * METER, 34.26])).toBe(false);
  });

  it('隔得远算不同', () => {
    expect(sameCenterOnGlobe([117.18, 34.26], [120.66, 31.31])).toBe(false);
  });

  it('经度差 360 度是同一个点', () => {
    expect(sameCenterOnGlobe([-179.5, 10], [180.5, 10])).toBe(true);
  });
});

describe('zoomFlightDuration', () => {
  it('和 flyTo 默认的时长相同：缩放差 3.5 级约 1.4 秒', () => {
    expect(zoomFlightDuration(13.5, 10)).toBeCloseTo((1000 * 3.5 * Math.LN2) / 1.42 / 1.2, 5);
    expect(zoomFlightDuration(10, 13.5)).toBeCloseTo(zoomFlightDuration(13.5, 10), 5);
  });

  it('缩放没变时是 0', () => {
    expect(zoomFlightDuration(12, 12)).toBe(0);
  });
});
