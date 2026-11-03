// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { JIANGSU_CITIES } from '@/shared/map/region/region-catalog';
import { roundBreaks, valueBreaks } from './analysis';
import { createCalculator } from './calculator';
import { defaultParams, withWalkMinutes } from './params';
import { citiesScope } from './scope';
import { loadTestAtlas } from './test-atlas';

const conditions = {
  years: [2026, 2025],
  scope: citiesScope(JIANGSU_CITIES.map(city => city.code)),
  indicatorIds: ['B-65', 'A-31', 'A-39', 'A-15']
};
const calculatorOf = async () => createCalculator(await loadTestAtlas());

describe('分级', () => {
  it('分级断点：所选年度标准口径下区县值的五档分位数，递增', async () => {
    const breaks = valueBreaks(await calculatorOf(), conditions, 'B-65', { ...defaultParams(), recognition: 'intersect' });

    expect(breaks).toEqual([44, 61, 72, 82]);
  });

  it('改过步行时长时按这个时长分档：时长不同的结果不在一个量级', async () => {
    const calculator = await calculatorOf();
    const longer = valueBreaks(calculator, conditions, 'B-65', withWalkMinutes(defaultParams(), 'B-65', 10));
    expect(longer[0]).toBeGreaterThan(44);
    const shorter = valueBreaks(calculator, conditions, 'A-31', withWalkMinutes(defaultParams(), 'A-31', 5));
    const standard = valueBreaks(calculator, conditions, 'A-31', defaultParams());
    expect(shorter[3]).toBeLessThan(standard[0] ?? 0);
  });

  it('断点取整：分得开时不多留小数，否则一位一位加，最多多留两位', () => {
    expect(roundBreaks([44.2, 61.4, 72.1, 82.3], 0)).toEqual([44, 61, 72, 82]);
    expect(roundBreaks([95.81, 96.12, 96.46, 96.97], 0)).toEqual([95.8, 96.1, 96.5, 97]);
    expect(roundBreaks([99.68, 99.74, 99.76, 99.87], 0)).toEqual([99.68, 99.74, 99.76, 99.87]);
    expect(roundBreaks([100, 100, 100, 100], 0)).toEqual([100, 100, 100, 100]);
  });

  it('值都挤在一起时多留小数，四档仍然递增', async () => {
    const calculator = await calculatorOf();
    const breaks = valueBreaks(calculator, conditions, 'A-31', withWalkMinutes(defaultParams(), 'A-31', 25));
    expect(breaks.toSorted((a, b) => a - b)).toEqual(breaks);
    expect(new Set(breaks).size).toBe(4);
  });
});
