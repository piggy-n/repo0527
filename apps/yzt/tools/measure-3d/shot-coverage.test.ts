// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { shotCoverage } from './shot-coverage.ts';

type Rgb = readonly [number, number, number];

const shot = (colors: readonly Rgb[]) => ({
  data: colors.flatMap(([red, green, blue]) => [red, green, blue, 255]),
  width: colors.length,
  height: 1
});

const GROUND: Rgb = [40, 80, 40];
const WHITE: Rgb = [250, 250, 250];
const DARK: Rgb = [90, 90, 90];
// 一个通道暗：不算接近白色
const YELLOW: Rgb = [250, 250, 100];

describe('shotCoverage', () => {
  it('模型的像素里数接近白色的：三个通道都要够亮', () => {
    expect(shotCoverage(shot([WHITE, DARK, YELLOW, GROUND]), shot([GROUND, GROUND, GROUND, GROUND]))).toEqual({
      modelCoveragePct: 75,
      brightPct: (1 / 3) * 100
    });
  });

  it('没变的白色背景不是模型的像素', () => {
    expect(shotCoverage(shot([WHITE, DARK]), shot([WHITE, GROUND]))).toEqual({ modelCoveragePct: 50, brightPct: 0 });
  });

  it('差别不超过噪声的不算模型', () => {
    expect(shotCoverage(shot([[48, 88, 48]]), shot([GROUND])).modelCoveragePct).toBe(0);
    expect(shotCoverage(shot([[49, 88, 48]]), shot([GROUND])).modelCoveragePct).toBe(100);
  });

  it('两张一样时没有模型的像素，比例是 null', () => {
    expect(shotCoverage(shot([GROUND]), shot([GROUND]))).toEqual({ modelCoveragePct: 0, brightPct: null });
  });
});
