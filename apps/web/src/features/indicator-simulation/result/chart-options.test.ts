// @vitest-environment node
import type { BarSeriesOption, LineSeriesOption } from 'echarts/charts';
import { describe, expect, it } from 'vitest';
import type { CityResult } from '../model/calculator';
import { simulationIndicator } from '../model/indicators';
import { citiesOption, comboLabel, type SimulationChartOption, sensitivityOption, yearsOption } from './chart-options';

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
    expect(citiesOption(perCapita, cities, base, { view: 'v1', compare: '标准口径' }, 15, true).xAxis).toMatchObject({ max: undefined });
  });
});

describe('sensitivityOption', () => {
  const points = [
    [-20, 15.2],
    [0, 12.2],
    [20, 10.1]
  ] as const;

  it('人均类：曲线覆盖人口变化的范围；当前取值单独画一个点', () => {
    const option = sensitivityOption(perCapita, { kind: 'curve', points, current: 0 }, 15, true);

    expect(option.xAxis).toMatchObject({ min: -20, max: 20, name: '人口 %' });
    expect(seriesAt(option, 0, isLine).data).toEqual([
      [-20, 15.2],
      [0, 12.2],
      [20, 10.1]
    ]);
    expect(seriesAt(option, 1, isLine).data).toEqual([[0, 12.2]]);
  });

  it('当前取值不在曲线上时不画点', () => {
    const option = sensitivityOption(perCapita, { kind: 'curve', points, current: 5 }, 15, true);

    expect(seriesAt(option, 1, isLine).data).toEqual([]);
  });

  it('覆盖率：每种组合一根柱子，从 0 画到 100%，当前的一根用主色并标"当前"', () => {
    const options = [
      { label: '标准口径', value: 66.6, current: false, standard: true },
      { label: '相交即算', value: 73.1, current: true, standard: false }
    ];
    const option = sensitivityOption(coverage, { kind: 'options', keys: ['recognition'], options }, 70, true);

    expect(option.xAxis).toMatchObject({ type: 'category', data: ['标准口径', '相交即算'] });
    // 柱子从 0 画起：不按数据缩放坐标轴，否则最低的一根看不见
    expect(option.yAxis).toMatchObject({ max: 100 });
    expect(option.yAxis).not.toHaveProperty('scale');
    // 四种组合时一格很窄：每个标签都显示，组合拆成两行
    const axisLabel = Array.isArray(option.xAxis) ? undefined : option.xAxis?.axisLabel;
    expect(axisLabel).toMatchObject({ interval: 0, formatter: comboLabel });
    expect(comboLabel('旧规程 + 相交即算')).toBe('旧规程\n相交即算');
    expect(seriesAt(option, 0, isBar).data).toMatchObject([
      { value: 66.6, label: { show: false } },
      { value: 73.1, label: { show: true } }
    ]);
  });
});
