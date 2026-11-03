// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { JIANGSU_CITIES } from '../map/region/region-catalog';
import { INDICATORS, requireIndicator } from './catalog';
import { indicatorValue, indicatorValueSource } from './indicator-value';
import { mockIndicatorValue } from './mock-value';
import report from './report-values.json';

const YEARS = Array.from({ length: 11 }, (_, index) => 2027 - index);
const REPORTED = Object.keys(report['2026']);
const PARTS = ['D02-3-1', 'D02-3-2'];
const valueOf = (cityCode: string, year: number, id: string) => indicatorValue(cityCode, requireIndicator(id), year);
const mockOf = (cityCode: string, year: number, id: string) => mockIndicatorValue(cityCode, requireIndicator(id), year);

describe('简报数据', () => {
  it('两个年度都是 32 项、13 个市，编码都在目录里，小数位不超过目录的精度', () => {
    const cityCodes = JIANGSU_CITIES.map(city => city.code).toSorted();
    expect(REPORTED).toHaveLength(32);
    expect(Object.keys(report['2025'])).toEqual(REPORTED);
    for (const block of [report['2026'], report['2025']]) {
      for (const [id, values] of Object.entries(block)) {
        const { precision } = requireIndicator(id);
        expect(Object.keys(values).toSorted()).toEqual(cityCodes);
        for (const value of Object.values(values)) {
          expect(Number(value.toFixed(precision))).toBe(value);
        }
      }
    }
  });

  it('2026、2025 就是简报的数，包括简报里的 0', () => {
    expect([valueOf('320100', 2026, 'B-65'), valueOf('320100', 2025, 'B-65')]).toEqual([49.6, 49.27]);
    expect([valueOf('320500', 2026, 'B-21'), valueOf('320500', 2025, 'B-21')]).toEqual([61.42, 73.64]);
    expect([valueOf('320100', 2026, 'A-16'), valueOf('320100', 2025, 'A-16')]).toEqual([406, 448]);
    expect([valueOf('320600', 2026, 'B-12'), valueOf('320600', 2025, 'B-12')]).toEqual([0, 89]);
  });
});

describe('简报年份之外', () => {
  it('2024 及以前从简报的 2025 出发，按原 mock 和 2025 的比例折算', () => {
    for (const id of ['B-65', 'A-39', 'B-19']) {
      const { precision } = requireIndicator(id);
      for (const year of [2017, 2021, 2024]) {
        const ratio = mockOf('320100', year, id) / mockOf('320100', 2025, id);
        const anchor = valueOf('320100', 2025, id);
        expect(valueOf('320100', year, id)).toBe(Number((anchor * ratio).toFixed(precision)));
      }
    }
  });

  it('2026 以后从简报的 2026 出发折算', () => {
    const ratio = mockOf('320100', 2027, 'B-65') / mockOf('320100', 2026, 'B-65');

    expect(valueOf('320100', 2027, 'B-65')).toBe(Number((49.6 * ratio).toFixed(2)));
  });

  it('原 mock 在基准年是 0 时比例无从算起，保持简报的值', () => {
    expect(mockOf('320200', 2025, 'B-12')).toBe(0);
    expect(valueOf('320200', 2022, 'B-12')).toBe(136);
    expect(mockOf('320800', 2025, 'B-57')).toBe(0);
    expect(valueOf('320800', 2022, 'B-57')).toBe(15.71);
  });

  it('全部指标都不小于 0，百分比不超过 100（2027 年 B-47 已经是 100，比例大于 1）', () => {
    const outOfRange = INDICATORS.flatMap(indicator =>
      JIANGSU_CITIES.flatMap(city =>
        YEARS.map(year => ({ id: indicator.id, value: indicatorValue(city.code, indicator, year), unit: indicator.unit }))
      )
    ).filter(({ value, unit }) => !(value >= 0) || (unit === '%' && value > 100));

    expect(outOfRange).toEqual([]);
    expect(mockOf('320900', 2027, 'B-47')).toBeGreaterThan(mockOf('320900', 2026, 'B-47'));
    expect(valueOf('320900', 2027, 'B-47')).toBe(100);
  });
});

describe('简报两年口径不同的 A-15', () => {
  it('2026 是简报的数，2025 及以前都从 2026 折算，不用 2025 的旧口径', () => {
    expect(valueOf('321300', 2026, 'A-15')).toBe(51.95);
    expect(report['2025']['A-15']['321300']).toBe(90.92);
    for (const city of JIANGSU_CITIES) {
      for (const year of [2025, 2024, 2021, 2017]) {
        const ratio = mockOf(city.code, year, 'A-15') / mockOf(city.code, 2026, 'A-15');

        expect(valueOf(city.code, year, 'A-15')).toBe(Number((valueOf(city.code, 2026, 'A-15') * ratio).toFixed(2)));
      }
    }
  });

  it('13 个市 2025 到 2026 都没有口径造成的断崖', () => {
    const ratios = JIANGSU_CITIES.map(city => valueOf(city.code, 2025, 'A-15') / valueOf(city.code, 2026, 'A-15'));

    expect(Math.min(...ratios)).toBeGreaterThan(0.9);
    expect(Math.max(...ratios)).toBeLessThan(1.1);
  });
});

describe('简报没有的指标', () => {
  it('除了超高层的两个分项，都和原 mock 完全一样', () => {
    const others = INDICATORS.filter(indicator => !REPORTED.includes(indicator.id) && !PARTS.includes(indicator.id));
    expect(others).toHaveLength(62);
    for (const indicator of others) {
      for (const city of JIANGSU_CITIES) {
        for (const year of YEARS) {
          expect(indicatorValue(city.code, indicator, year)).toBe(mockIndicatorValue(city.code, indicator, year));
        }
      }
    }
  });
});

describe('指标之间的约束', () => {
  it('建筑合计等于分项，生活圈并集不小于交集，全部年份都成立', () => {
    for (const city of JIANGSU_CITIES) {
      for (const year of YEARS) {
        expect(valueOf(city.code, year, 'D02-3-1') + valueOf(city.code, year, 'D02-3-2')).toBe(valueOf(city.code, year, 'A-16'));
        expect(valueOf(city.code, year, 'G01-6-1') + valueOf(city.code, year, 'G01-6-2')).toBe(valueOf(city.code, year, 'G01-6'));
        expect(valueOf(city.code, year, 'A09-2')).toBeGreaterThanOrEqual(valueOf(city.code, year, 'A-30'));
      }
    }
  });

  it('超高层的分项按原 mock 的占比分配简报的合计，都是不小于 0 的整数', () => {
    const share = mockOf('320100', 2026, 'D02-3-1') / mockOf('320100', 2026, 'A-16');

    expect(valueOf('320100', 2026, 'D02-3-1')).toBe(Math.round(406 * share));
    for (const city of JIANGSU_CITIES) {
      for (const year of YEARS) {
        for (const id of PARTS) {
          const value = valueOf(city.code, year, id);
          expect(Number.isInteger(value) && value >= 0).toBe(true);
        }
      }
    }
  });
});

describe('indicatorValueSource', () => {
  it('简报年份是 report，其余年份是 scaled，超高层的分项是 scaled，简报没有的是 mock', () => {
    expect(['B-65', 'A-16'].map(id => indicatorValueSource(id, 2026))).toEqual(['report', 'report']);
    expect(indicatorValueSource('B-65', 2025)).toBe('report');
    expect(indicatorValueSource('B-65', 2024)).toBe('scaled');
    expect(indicatorValueSource('B-65', 2027)).toBe('scaled');
    expect(PARTS.map(id => indicatorValueSource(id, 2026))).toEqual(['scaled', 'scaled']);
    expect(['A08-2', 'A09-2'].map(id => indicatorValueSource(id, 2026))).toEqual(['mock', 'mock']);
  });

  it('A-15 只有 2026 是 report，2025 也是折算的', () => {
    expect([2026, 2025, 2024, 2027].map(year => indicatorValueSource('A-15', year))).toEqual([
      'report',
      'scaled',
      'scaled',
      'scaled'
    ]);
  });
});
