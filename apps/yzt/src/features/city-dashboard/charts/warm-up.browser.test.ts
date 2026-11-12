import { describe, expect, it } from 'vitest';
import { required } from '@/shared/testing/required';
import { useDashboard } from '../composables/useDashboard';
import { createMockData } from '../data/mock-data';
import { createChartOption } from './options';
import { warmUpChart } from './warm-up';

describe('warmUpChart', () => {
  it('画完立即销毁，不在页面留下节点或画布', () => {
    const model = useDashboard(createMockData(2026));
    const indicator = required(model.category.value.indicators[0], '第一个指标');
    const option = createChartOption({
      indicator,
      cities: model.cities.value,
      comparison: model.comparisons.value.get(indicator.id) ?? [],
      preference: model.preference(indicator)
    });
    const children = document.body.childElementCount;
    warmUpChart(option, 420, 240);
    expect(document.body.childElementCount).toBe(children);
    expect(document.querySelectorAll('canvas')).toHaveLength(0);
  });
});
