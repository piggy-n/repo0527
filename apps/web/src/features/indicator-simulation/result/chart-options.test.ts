// @vitest-environment node
import type { BarSeriesOption, LineSeriesOption } from 'echarts/charts';
import { describe, expect, it } from 'vitest';
import type { CityResult } from '../model/calculator';
import { simulationIndicator } from '../model/indicators';
import { citiesOption, type SimulationChartOption, sensitivityOption, yearsOption } from './chart-options';

const coverage = simulationIndicator('B-65');
const perCapita = simulationIndicator('A-39');
const city = (code: string, name: string, value: number, pass: boolean): CityResult => ({ code, name, value, pass, near: false });

const isLine = (value: unknown): value is LineSeriesOption =>
  typeof value === 'object' && value !== null && 'type' in value && value.type === 'line';
const isBar = (value: unknown): value is BarSeriesOption =>
  typeof value === 'object' && value !== null && 'type' in value && value.type === 'bar';

// 选项里的系列：按位置取，类型不对时报出是哪一个
function seriesAt<T>(option: SimulationChartOption, index: number, guard: (value: unknown) => value is T): T {
  const found: unknown = Array.isArray(option.series) ? option.series[index] : undefined;
  if (!guard(found)) {
    throw new Error(`第 ${index} 个系列不是要找的类型`);
  }
  return found;
}

describe('yearsOption', () => {
  it('对比的一方是虚线；正在看的年度点放大；目标是横线', () => {
    const option = yearsOption(coverage, [2025, 2026], { label: 'v2', values: [66, 70] }, { label: 'v1', values: [63, 64] }, 2025, 70, true);

    const compare = seriesAt(option, 0, isLine);
    const view = seriesAt(option, 1, isLine);
    expect([compare.name, compare.lineStyle?.type, compare.data]).toEqual(['v1', 'dashed', [63, 64]]);
    expect(view.data).toEqual([
      { value: 66, symbolSize: 12 },
      { value: 70, symbolSize: 8 }
    ]);
    expect(view.markLine?.data).toEqual([{ yAxis: 70 }]);
    expect(option.animation).toBe(true);
  });
});

describe('citiesOption', () => {
  const cities = [city('3201', '南京市', 62, false), city('3202', '无锡市', 75, true), city('3203', '徐州市', 58, false)];
  const base = new Map([
    ['3201', 60],
    ['3202', 71]
  ]);

  it('城市从低到高，名称去掉"市"；对比的一方没有值时是 0；未达标的柱子是红色；目标是竖线', () => {
    const option = citiesOption(coverage, cities, base, { view: 'v2', compare: '默认参数' }, 70, false);

    expect(option.yAxis).toMatchObject({ data: ['徐州', '南京', '无锡'] });
    expect(option.xAxis).toMatchObject({ max: 100 });
    expect(seriesAt(option, 0, isBar).data).toEqual([0, 60, 71]);
    const view = seriesAt(option, 1, isBar);
    expect(view.data).toEqual([
      { value: 58, itemStyle: { color: '#e5675c' } },
      { value: 62, itemStyle: { color: '#e5675c' } },
      { value: 75, itemStyle: { color: '#597ef7' } }
    ]);
    expect(view.markLine?.data).toEqual([{ xAxis: 70 }]);
    expect(option.animation).toBe(false);
  });

  it('人均类的横轴不设上限', () => {
    expect(citiesOption(perCapita, cities, base, { view: 'v1', compare: '默认参数' }, 15, true).xAxis).toMatchObject({ max: undefined });
  });
});

describe('sensitivityOption', () => {
  const points = [
    [40, 55],
    [60, 64.6],
    [80, 72]
  ] as const;

  it('曲线覆盖取值范围；当前取值单独画一个点', () => {
    const option = sensitivityOption(coverage, { key: 'walkSpeed', points, current: 60 }, 70, true);

    expect(option.xAxis).toMatchObject({ min: 40, max: 80, name: '米/分钟' });
    expect(seriesAt(option, 0, isLine).data).toEqual([
      [40, 55],
      [60, 64.6],
      [80, 72]
    ]);
    expect(seriesAt(option, 1, isLine).data).toEqual([[60, 64.6]]);
  });

  it('当前取值不在曲线上时不画点；规划新增的单位是百分比', () => {
    const option = sensitivityOption(perCapita, { key: 'newFacilities', points, current: 0 }, 15, true);

    expect(option.xAxis).toMatchObject({ name: '%' });
    expect(seriesAt(option, 1, isLine).data).toEqual([]);
  });
});
