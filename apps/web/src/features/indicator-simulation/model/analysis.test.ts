// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { JIANGSU_CITIES } from '@/shared/map/region/region-catalog';
import { valueBreaks } from './analysis';
import { createCalculator } from './calculator';
import { loadTestAtlas } from './test-atlas';

const conditions = {
  years: [2026, 2025],
  cityCodes: JIANGSU_CITIES.map(city => city.code),
  indicatorIds: ['B-65', 'A-31', 'A-39', 'A-15']
};
const calculatorOf = async () => createCalculator(await loadTestAtlas());

describe('分级', () => {
  it('分级断点：所选年度标准口径下区县值的五档分位数，递增', async () => {
    const breaks = valueBreaks(await calculatorOf(), conditions, 'B-65');

    expect(breaks).toEqual([44, 61, 72, 82]);
  });
});
