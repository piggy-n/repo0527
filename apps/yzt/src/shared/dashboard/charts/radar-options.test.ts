// @vitest-environment node
import type { RadarSeriesOption } from 'echarts/charts';
import type { RadarComponentOption, TooltipComponentOption } from 'echarts/components';
import { describe, expect, it } from 'vitest';
import { DASHBOARD_CITIES } from '../cities';
import type { ChartPreference, ChartType, Comparison, IndicatorMeta } from '../model';
import { required } from '../../testing/required';
import { createValueAxisScale } from './axis-scale';
import { AVERAGE_COLOR } from './palette';
import { createRadarOption, type RadarInput } from './radar-options';

const indicator: IndicatorMeta = { id: 'I02', name: '教育便利性指数', unit: '', precision: 2 };
const cities = DASHBOARD_CITIES;
const values = cities.map((_, index) => (index === 4 ? null : 60 + index * 2.5));
const comparison: Comparison[] = [{ year: 2025, values, average: 75.12 }];
const preference: ChartPreference<ChartType> = { type: 'radar', showAverage: false, legend: {} };

function radar(overrides: Partial<RadarInput> = {}) {
  const option = createRadarOption({
    indicator,
    color: year => (year === 2025 ? '#1849A9' : '#3288F5'),
    cities,
    comparison,
    preference,
    ...overrides
  });
  const series = (option.series ?? []) as RadarSeriesOption[];
  const coordinate = option.radar as RadarComponentOption;
  const tooltip = option.tooltip as TooltipComponentOption;
  return { option, series, coordinate, tooltip };
}

// 提示框的格式化函数按系列名取这一圈的值
function tooltipText(tooltip: TooltipComponentOption, name: string): string {
  const formatter = tooltip.formatter;
  if (typeof formatter !== 'function') {
    throw new Error('提示框缺少格式化函数');
  }
  const text = formatter({ name } as never, '');
  if (typeof text !== 'string') {
    throw new Error('提示框应返回 HTML 字符串');
  }
  return text;
}

describe('createRadarOption', () => {
  it('以所选城市为轴，城市名去掉"市"，上界与柱图的纵轴算法一致', () => {
    const { coordinate } = radar();
    const axis = createValueAxisScale([...values, 75.12], { includeZero: true, integer: false });
    expect(coordinate.indicator?.map(item => item.name)).toEqual(cities.map(city => city.name.replace(/市$/, '')));
    expect(coordinate.indicator?.every(item => item.max === axis.max && item.min === axis.min)).toBe(true);
    expect(coordinate.splitNumber).toBe(Math.round((axis.max - axis.min) / axis.interval));
  });

  it('每个年份一个半透明的面，颜色取 color(year)，缺失值原样交给引擎', () => {
    const { series, option } = radar({
      comparison: [{ year: 2024, values, average: 70 }, ...comparison]
    });
    expect(series.map(item => item.name)).toEqual(['2024', '2025']);
    const latest = required(series.at(-1), '2025 年的系列');
    expect(latest.itemStyle?.color).toBe('#1849A9');
    expect(latest.areaStyle?.opacity).toBeGreaterThan(0);
    expect(latest.areaStyle?.opacity).toBeLessThan(1);
    expect(latest.data).toEqual([{ name: '2025', value: values }]);
    expect(option.legend).toMatchObject({ data: ['2024', '2025'] });
  });

  it('均值开关加一圈所有轴都等于最新年均值的虚线', () => {
    const { series, option, tooltip } = radar({ preference: { ...preference, showAverage: true } });
    const average = required(series.find(item => item.id === 'average'), '均值系列');
    expect(average.name).toBe('2025均值');
    expect(average.lineStyle).toMatchObject({ color: AVERAGE_COLOR, type: [3, 3] });
    expect(average.data).toEqual([{ name: '2025均值', value: cities.map(() => 75.12) }]);
    expect(option.legend).toMatchObject({ data: ['2025', '2025均值'] });
    expect(tooltipText(tooltip, '2025均值')).toContain('75.12');
  });

  it('提示框按项触发，列出每个城市的值，缺失写破折号', () => {
    const { tooltip } = radar({ preference: { ...preference, legend: { 2025: false } } });
    expect(tooltip.trigger).toBe('item');
    const text = tooltipText(tooltip, '2025');
    expect(text).toContain('2025年');
    expect(text).toContain('<span>南京</span><b>60</b>');
    expect(text).toContain(`<span>${cities[4].name.replace(/市$/, '')}</span><b>—</b>`);
    expect(tooltipText(tooltip, '2023')).toBe('');
  });

  it('图例的选中状态沿用偏好，详情里聚焦的城市名高亮', () => {
    const { option, coordinate } = radar({
      preference: { ...preference, legend: { 2025: false } },
      detail: true,
      focusedCity: '320200'
    });
    expect(option.legend).toMatchObject({ selected: { 2025: false } });
    const formatter = coordinate.axisName?.formatter;
    if (typeof formatter !== 'function') {
      throw new Error('轴名缺少格式化函数');
    }
    expect(formatter('无锡')).toBe('{focused|无锡}');
    expect(formatter('南京')).toBe('南京');
  });
});
