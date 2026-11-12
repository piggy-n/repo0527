// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { requireIndicator } from '@/shared/city-indicators/catalog';
import { CITIES } from '../catalog';
import { compareIndicator } from '../calculations';
import { createMockData } from '../data/mock-data';
import { createChartOption } from './options';

describe('演示分支的图表配置', () => {
  it('卡片和详情的横轴不显示城市名、不设提示框，柱和数据照旧', () => {
    const indicator = requireIndicator('A-32');
    const comparison = compareIndicator(createMockData(2026), indicator, [2025, 2026], CITIES);
    const preference = { type: 'bar', showAverage: true, legend: {} } as const;
    for (const detail of [false, true]) {
      const option = createChartOption({ indicator, cities: CITIES, comparison, preference, detail });
      expect(option.tooltip).toBeUndefined();
      expect(option.xAxis).toMatchObject({ axisLabel: { show: false } });
      const series = Array.isArray(option.series) ? option.series : [];
      expect(series.map(item => item.type)).toEqual(['bar', 'bar', 'line']);
      expect(series[1]?.data).toHaveLength(13);
    }
  });
});
