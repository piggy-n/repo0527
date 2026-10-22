// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { CITIES, INDICATORS } from './catalog';
import { compareIndicator, formatValue } from './calculations';
import { createMapClassification, getMapClassIndex } from './map-classification';
import { createValueAxisScale } from './charts/axis-scale';
import { createChartOption, isStacked } from './charts/options';
import type { ChartPreference, DashboardData } from './model';

const indicator = INDICATORS.find(item => item.id === 'A-15')!;

describe('统计口径与展示计算', () => {
  it('忽略缺失值与非有限值，零值仍参与均值，空集返回 null', () => {
    const values = new Map([['320100', 0], ['320200', 10], ['320300', NaN]]);
    const data: DashboardData = { years: [2026], value: (_, city) => values.get(city) ?? null };
    expect(compareIndicator(data, indicator, [2026], CITIES)[0]).toMatchObject({ average: 5 });
    expect(compareIndicator(data, indicator, [2026], [])[0].average).toBeNull();
    expect(compareIndicator(data, indicator, [], CITIES)).toEqual([]);
    expect(formatValue(null, indicator)).toBe('—');
    expect(formatValue(2.25, { unit: '1:X', precision: 2 })).toBe('1:2.25');
  });

  it('分档不拆相同值，边界归高档，越界值归首尾', () => {
    const classification = createMapClassification([0, 0, 10, 10, 20, 30, 40, null, NaN]);
    expect(classification.sampleCount).toBe(7);
    expect(classification.classCount).toBe(5);
    expect(classification.breaks).toHaveLength(4);
    classification.breaks.forEach((boundary, index) => expect(getMapClassIndex(
      boundary,
      classification
    )).toBe(index + 1));
    expect(getMapClassIndex(-100, classification)).toBe(0);
    expect(getMapClassIndex(100, classification)).toBe(4);
    expect(getMapClassIndex(null, classification)).toBeNull();
    expect(createMapClassification([null, NaN]).classCount).toBe(0);
    expect(createMapClassification([2, 2, 2])).toMatchObject({
      classCount: 1,
      breaks: [],
      displayMin: 2,
      displayMax: 2
    });
  });

  it.each([2, 3, 4])('有限观测值只分 %i 档，窄区间保留有效分界', count => {
    const values = Array.from({ length: count }, (_, index) => .001 + index * .00001);
    const classification = createMapClassification(values);
    expect(classification.classCount).toBe(count);
    expect(values.map(value => getMapClassIndex(value, classification))).toEqual(values.map((_, index) => index));
  });

  it('等距轴含零、同值扩展、整数步长，百分比异常仍完整显示', () => {
    expect(createValueAxisScale([84, 86], { includeZero: true }).min).toBe(0);
    const equal = createValueAxisScale([4, 4]);
    expect(equal.min).toBeLessThan(4);
    expect(equal.max).toBeGreaterThan(4);
    const integer = createValueAxisScale([0, 1], { includeZero: true, integer: true });
    expect(integer.interval).toBeGreaterThanOrEqual(1);
    const percentage = createValueAxisScale([-8, 112], { lowerBound: 0, upperBound: 100 });
    expect(percentage.min).toBeLessThanOrEqual(-8);
    expect(percentage.max).toBeGreaterThanOrEqual(112);
    expect((percentage.max - percentage.min) / percentage.interval).toBeLessThanOrEqual(6);
  });

  it('四年柱图是年度值累计并移除均值线，折线恢复最新年均值', () => {
    const comparison = [2023, 2024, 2025, 2026].map(year => ({ year, values: [30, 40], average: 35 }));
    const preference: ChartPreference = { type: 'bar', showAverage: true, legend: {} };
    const input = { indicator, cities: CITIES.slice(0, 2), comparison, preference };
    expect(isStacked(input)).toBe(true);
    const stacked = createChartOption(input);
    expect(stacked.yAxis).toMatchObject({ name: '年度值累计（%）' });
    expect(stacked.series).toHaveLength(4);
    expect(stacked.series).toEqual(expect.arrayContaining([expect.objectContaining({ stack: 'annual-comparison' })]));
    const line = createChartOption({ ...input, preference: { ...preference, type: 'line' } });
    expect(line.series).toHaveLength(5);
    expect(line.series).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'average', name: '2026均值' })]));
  });
});
