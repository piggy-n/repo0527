// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  distanceToZoom,
  frustumFov,
  MAPLIBRE_FOVY,
  NADIR_EPSILON,
  normalizeBearing,
  readablePitch,
  writablePitch,
  zoomToDistance
} from './camera-math';

describe('缩放级与距离', () => {
  it('赤道 0 级、画布 512 像素高时，画布中心的每像素米数是 78271.5', () => {
    const distance = zoomToDistance(0, 0, 512, MAPLIBRE_FOVY);
    // 竖直方向 512 像素对应的地面长度除以像素数
    const metersPerPixel = (2 * distance * Math.tan(MAPLIBRE_FOVY / 2)) / 512;

    expect(metersPerPixel).toBeCloseTo(78271.516964, 4);
  });

  it('级别加 1 距离减半；纬度越高同级距离越近', () => {
    const at10 = zoomToDistance(10, 32, 800, MAPLIBRE_FOVY);

    expect(zoomToDistance(11, 32, 800, MAPLIBRE_FOVY)).toBeCloseTo(at10 / 2, 6);
    expect(zoomToDistance(10, 60, 800, MAPLIBRE_FOVY)).toBeLessThan(at10);
  });

  it('两个方向互逆', () => {
    for (const zoom of [3.2, 6.8, 12, 17.5]) {
      const distance = zoomToDistance(zoom, 31.5, 937, MAPLIBRE_FOVY);
      expect(distanceToZoom(distance, 31.5, 937, MAPLIBRE_FOVY)).toBeCloseTo(zoom, 9);
    }
  });

  it('在地下、贴着地面时按 1 米算，得到有限的级别', () => {
    const atOneMeter = distanceToZoom(1, 31, 800, MAPLIBRE_FOVY);

    expect(distanceToZoom(-30, 31, 800, MAPLIBRE_FOVY)).toBeCloseTo(distanceToZoom(30, 31, 800, MAPLIBRE_FOVY), 9);
    expect(distanceToZoom(0, 31, 800, MAPLIBRE_FOVY)).toBe(atOneMeter);
    expect(Number.isFinite(atOneMeter)).toBe(true);
  });

  it('画布没有高度、视场角不合法时抛错，不算出 NaN', () => {
    expect(() => zoomToDistance(10, 32, 0, MAPLIBRE_FOVY)).toThrow(RangeError);
    expect(() => distanceToZoom(100, 32, 800, 0)).toThrow(RangeError);
    expect(() => distanceToZoom(100, 32, Number.NaN, MAPLIBRE_FOVY)).toThrow(RangeError);
  });
});

describe('视场角', () => {
  it('竖屏、方形画布直接用竖直视场角；宽屏换成对应的水平视场角', () => {
    expect(frustumFov(MAPLIBRE_FOVY, 0.6)).toBe(MAPLIBRE_FOVY);
    expect(frustumFov(MAPLIBRE_FOVY, 1)).toBe(MAPLIBRE_FOVY);
    const horizontal = frustumFov(MAPLIBRE_FOVY, 16 / 9);
    expect(Math.tan(horizontal / 2)).toBeCloseTo(Math.tan(MAPLIBRE_FOVY / 2) * (16 / 9), 12);
  });
});

describe('俯角与方位', () => {
  it('正俯视写入时抬高一点，读回时归零；其余原样', () => {
    expect(writablePitch(0)).toBe(NADIR_EPSILON);
    expect(writablePitch(35)).toBe(35);
    expect(readablePitch(NADIR_EPSILON)).toBe(0);
    expect(readablePitch(NADIR_EPSILON * 2)).toBe(0);
    expect(readablePitch(0.5)).toBe(0.5);
  });

  it('方位角归到 0 到 360 之间', () => {
    expect(normalizeBearing(-30)).toBe(330);
    expect(normalizeBearing(360)).toBe(0);
    expect(normalizeBearing(725)).toBe(5);
    // 解算出的微小负值不绕成 359.999…
    expect(normalizeBearing(-6e-9)).toBe(0);
    expect(normalizeBearing(359.9)).toBe(359.9);
  });
});
