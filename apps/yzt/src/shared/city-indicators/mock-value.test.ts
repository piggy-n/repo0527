// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { JIANGSU_CITIES } from '../map/region/region-catalog';
import { INDICATORS, requireIndicator } from './catalog';
import { mockIndicatorValue } from './mock-value';

const YEARS = Array.from({ length: 10 }, (_, index) => 2026 - index);
const valueOf = (cityCode: string, year: number, id: string) => mockIndicatorValue(cityCode, requireIndicator(id), year);

describe('mockIndicatorValue', () => {
  it('同样的市、年份、指标总是同一个值，与调用顺序无关', () => {
    const indicator = requireIndicator('B-65');
    const first = JIANGSU_CITIES.map(city => mockIndicatorValue(city.code, indicator, 2026));
    const reversed = JIANGSU_CITIES.toReversed().map(city => mockIndicatorValue(city.code, indicator, 2026)).toReversed();

    expect(reversed).toEqual(first);
    expect(new Set(first).size).toBeGreaterThan(1);
  });

  it('建筑合计等于分项，生活圈并集不小于交集', () => {
    for (const city of JIANGSU_CITIES) {
      for (const year of YEARS) {
        expect(valueOf(city.code, year, 'A-16')).toBe(valueOf(city.code, year, 'D02-3-1') + valueOf(city.code, year, 'D02-3-2'));
        expect(valueOf(city.code, year, 'G01-6')).toBe(valueOf(city.code, year, 'G01-6-1') + valueOf(city.code, year, 'G01-6-2'));
        expect(valueOf(city.code, year, 'A09-2')).toBeGreaterThanOrEqual(valueOf(city.code, year, 'A-30'));
      }
    }
  });

  it('全部指标都不小于 0，百分比不超过 100', () => {
    const outOfRange = INDICATORS.flatMap(indicator =>
      JIANGSU_CITIES.flatMap(city =>
        YEARS.map(year => ({ id: indicator.id, value: mockIndicatorValue(city.code, indicator, year), unit: indicator.unit }))
      )
    ).filter(({ value, unit }) => value < 0 || (unit === '%' && value > 100));

    expect(outOfRange).toEqual([]);
  });
});
