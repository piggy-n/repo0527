// @vitest-environment node
import { MAPLIBRE_FOVY } from '@mx/map-core';
import { describe, expect, it } from 'vitest';
import { frustumFov, NADIR_EPSILON, normalizeBearing, readablePitch, writablePitch } from './camera-math';

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
