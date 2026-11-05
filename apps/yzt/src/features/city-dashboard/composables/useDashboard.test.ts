// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { CITIES } from '../catalog';
import { createMockData } from '../data/mock-data';
import { useDashboard } from './useDashboard';

const data = createMockData(2026);

describe('驾驶舱筛选与图表联动', () => {
  it('默认两年全部城市，清空年份后时间轴为空且不伪造均值', () => {
    const model = useDashboard(data);
    expect(model.state.value.years).toEqual([2026, 2025]);
    expect(model.cities.value).toHaveLength(13);
    model.setYears([]);
    expect(model.state.value.activeYear).toBeNull();
    expect(model.comparisons.value.get('A-15')).toEqual([]);
    expect(Object.values(model.mapValues.value).every(value => value === null)).toBe(true);
    model.setYears([2024, 2024, 2099, 2022]);
    expect(model.state.value.years).toEqual([2024, 2022]);
    expect(model.state.value.activeYear).toBe(2024);
  });

  it('时间轴只改当前年，不改变比较结果和最新年均值', () => {
    const model = useDashboard(data);
    const comparison = model.comparisons.value;
    model.setActiveYear(2025);
    expect(model.state.value.activeYear).toBe(2025);
    expect(model.comparisons.value).toBe(comparison);
    expect(model.comparisons.value.get('A-15')?.at(-1)?.year).toBe(2026);
    model.setActiveYear(2021);
    expect(model.state.value.activeYear).toBe(2025);
    model.setYears([2026]);
    expect(model.state.value.activeYear).toBe(2026);
  });

  it('城市过滤重算均值但不改变六年全市色阶', () => {
    const model = useDashboard(data);
    const classification = model.classification.value;
    expect(classification.sampleCount).toBe(6 * 13);
    model.setCities(['320100', '320100', 'unknown']);
    expect(model.cities.value).toEqual([CITIES[0]]);
    expect(model.comparisons.value.get('A-15')?.at(-1)?.average).toBe(data.value(2026, '320100', 'A-15'));
    expect(model.mapValues.value['320200']).toBeNull();
    model.setYears([2022, 2023, 2024, 2025, 2026]);
    expect(model.classification.value).toBe(classification);
    model.setCities([]);
    expect(model.comparisons.value.get('A-15')?.at(-1)?.average).toBeNull();
  });

  it('快速切类别回到首项并重置卡片偏好；单项选择不影响筛选', () => {
    const model = useDashboard(data);
    const initial = model.indicator.value;
    model.setPreference(initial, { type: 'line', showAverage: false });
    model.selectCategory('happiness');
    model.selectCategory('coordination');
    model.selectCategory('innovation');
    expect(model.state.value.indicatorId).toBe('B-57');
    model.selectCategory('resilience');
    expect(model.indicator.value).toBe(initial);
    expect(model.preference(initial)).toMatchObject({ type: 'bar', showAverage: true });
    model.selectIndicator('B-12');
    expect(model.indicator.value.id).toBe('B-12');
    expect(model.state.value.years).toEqual([2026, 2025]);
    model.selectIndicator('unknown');
    expect(model.indicator.value.id).toBe('B-12');
  });
});
