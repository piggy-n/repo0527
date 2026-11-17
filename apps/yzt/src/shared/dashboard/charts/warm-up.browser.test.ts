import { describe, expect, it } from 'vitest';
import { requireIndicator } from '../../city-indicators/catalog';
import { indicatorValue } from '../../city-indicators/indicator-value';
import { DASHBOARD_CITIES } from '../cities';
import { createChartOption } from './options';
import { warmUpChart } from './warm-up';

describe('warmUpChart', () => {
  it('画完立即销毁，不在页面留下节点或画布', () => {
    const indicator = requireIndicator('A-15');
    const option = createChartOption({
      indicator,
      cities: DASHBOARD_CITIES,
      comparison: [2025, 2026].map(year => ({
        year,
        values: DASHBOARD_CITIES.map(city => indicatorValue(city.code, indicator, year)),
        average: null
      })),
      preference: { type: 'bar', showAverage: true, legend: {} },
      color: () => '#1849A9'
    });
    const children = document.body.childElementCount;
    warmUpChart(option, 420, 240);
    expect(document.body.childElementCount).toBe(children);
    expect(document.querySelectorAll('canvas')).toHaveLength(0);
  });
});
