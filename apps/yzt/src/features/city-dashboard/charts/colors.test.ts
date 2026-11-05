// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { CATEGORIES, CITIES, DASHBOARD_YEARS } from '../catalog';
import type { ChartType, Indicator } from '../model';
import { AVERAGE_COLOR, yearColor } from './colors';
import { createChartOption } from './options';

const colorsOf = (indicatorId: string) => DASHBOARD_YEARS.map(year => yearColor(year, indicatorId));

function seriesOf(indicator: Indicator, type: ChartType) {
  return createChartOption({
    indicator,
    cities: CITIES.slice(0, 2),
    comparison: [{ year: 2026, values: [1, 2], average: 1.5 }],
    preference: { type, showAverage: false, legend: {} }
  }).series;
}

function expectedSeries({ id }: Indicator) {
  return [{ id: 'year-2026', itemStyle: { color: yearColor(2026, id) } }];
}

describe('图表配色', () => {
  it('每个分类的卡片都按 1 2 3 循环取组', () => {
    for (const { indicators } of CATEGORIES) {
      indicators.forEach((indicator, index) => {
        expect(colorsOf(indicator.id)).toEqual(colorsOf(indicators[index % 3].id));
      });
    }
  });

  it('同屏相邻的三张卡片不共用颜色，也不用均值线的颜色', () => {
    for (const { indicators } of CATEGORIES) {
      for (let first = 0; first + 3 <= indicators.length; first++) {
        const colors = indicators.slice(first, first + 3).flatMap(({ id }) => colorsOf(id));
        expect(new Set([...colors, AVERAGE_COLOR]).size).toBe(colors.length + 1);
      }
    }
  });

  it('每组从最新年份排起，第一组保持海蓝', () => {
    const { id } = CATEGORIES[0].indicators[0];
    expect(yearColor(2026, id)).toBe('#1849A9');
    expect(yearColor(2025, id)).toBe('#3288F5');
    expect(yearColor(2021, id)).toBe('#249374');
  });

  it('图表按指标取色，切换柱状和折线不变色', () => {
    const [first, second] = CATEGORIES[0].indicators;
    expect(seriesOf(first, 'bar')).toMatchObject(expectedSeries(first));
    expect(seriesOf(first, 'line')).toMatchObject(expectedSeries(first));
    expect(seriesOf(second, 'bar')).toMatchObject(expectedSeries(second));
    expect(yearColor(2026, second.id)).not.toBe(yearColor(2026, first.id));
  });
});
