// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { JIANGSU_CITIES } from '@/shared/map/region/region-catalog';
import { passState, valueBreaks } from './analysis';
import { createCalculator } from './calculator';
import { loadTestAtlas } from './test-atlas';

const conditions = {
  years: [2026, 2025],
  cityCodes: JIANGSU_CITIES.map(city => city.code),
  indicatorIds: ['B-65', 'A-31', 'A-39', 'A-15']
};
const calculatorOf = async () => createCalculator(await loadTestAtlas());

describe('分级与达标', () => {
  it('分级断点：所选年度标准口径下区县值的五档分位数，递增', async () => {
    const breaks = valueBreaks(await calculatorOf(), conditions, 'B-65');

    expect(breaks).toEqual([44, 61, 72, 82]);
  });

  it('达标、接近（差距在 5% 以内）、未达标', () => {
    expect([passState(70, 70), passState(66.5, 70), passState(66.4, 70)]).toEqual(['pass', 'near', 'fail']);
  });
});
