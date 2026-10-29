import type { BarSeriesOption, LineSeriesOption } from 'echarts/charts';
import type {
  GridComponentOption,
  LegendComponentOption,
  MarkLineComponentOption,
  TooltipComponentOption
} from 'echarts/components';
import type { ComposeOption } from 'echarts/core';
import { formatValue } from '../format';
import type { Sensitivity, SensitivityOption } from '../model/analysis';
import type { CityResult } from '../model/calculator';
import type { SimulationIndicator } from '../model/indicators';

export type SimulationChartOption = ComposeOption<
  | BarSeriesOption
  | LineSeriesOption
  | GridComponentOption
  | LegendComponentOption
  | TooltipComponentOption
  | MarkLineComponentOption
>;

// 图表的颜色是数据：主色、主色边框、目标线的琥珀色、未达标红、文字与分隔线（取对应令牌的值）
const PRIMARY = '#597ef7';
const PRIMARY_LIGHT = '#c9d4fb';
const PRIMARY_DEEP = '#2f54eb';
const TARGET = '#f0a020';
const TARGET_TEXT = '#b46b00';
const FAIL = '#e5675c';
const AXIS = { color: '#8a94a6', fontSize: 12 };
const SPLIT = { lineStyle: { color: '#edf1f7' } };
const LEGEND: LegendComponentOption = {
  top: 0,
  itemWidth: 10,
  itemHeight: 8,
  textStyle: { fontSize: 12, color: '#4b5563' }
};

const targetLine = (axis: 'xAxis' | 'yAxis', target: number, label: boolean): MarkLineComponentOption => ({
  symbol: 'none',
  label: label ? { formatter: `目标 ${target}`, fontSize: 12, color: TARGET_TEXT, position: 'end', distance: 2 } : { show: false },
  lineStyle: { color: TARGET, type: 'dashed' },
  data: [axis === 'xAxis' ? { xAxis: target } : { yAxis: target }]
});

/** 多年度对比：全省值，对比的一方虚线，正在看的年度点放大 */
export function yearsOption(
  indicator: SimulationIndicator,
  years: readonly number[],
  view: { readonly label: string; readonly values: readonly number[] },
  compare: { readonly label: string; readonly values: readonly number[] },
  year: number,
  target: number,
  animation: boolean
): SimulationChartOption {
  return {
    animation,
    grid: { left: 44, right: 12, top: 28, bottom: 24 },
    legend: { ...LEGEND, right: 0 },
    tooltip: { trigger: 'axis', valueFormatter: value => formatValue(Number(value), indicator) },
    xAxis: {
      type: 'category',
      data: years.map(String),
      axisLabel: AXIS,
      axisTick: { show: false },
      axisLine: { lineStyle: { color: '#e2e5ec' } }
    },
    yAxis: { type: 'value', scale: true, axisLabel: AXIS, splitLine: SPLIT },
    series: [
      {
        name: compare.label,
        type: 'line',
        symbolSize: 6,
        lineStyle: { color: PRIMARY_LIGHT, type: 'dashed' },
        itemStyle: { color: PRIMARY_LIGHT },
        data: [...compare.values]
      },
      {
        name: view.label,
        type: 'line',
        lineStyle: { color: PRIMARY, width: 2 },
        itemStyle: { color: PRIMARY },
        data: view.values.map((value, index) => ({ value, symbolSize: years[index] === year ? 12 : 8 })),
        markLine: targetLine('yAxis', target, false)
      }
    ]
  };
}

/** 城市对比：从低到高，正在看的一版按达标着色，对比的一方浅色，竖线是目标 */
export function citiesOption(
  indicator: SimulationIndicator,
  cities: readonly CityResult[],
  base: ReadonlyMap<string, number>,
  labels: { readonly view: string; readonly compare: string },
  target: number,
  animation: boolean
): SimulationChartOption {
  const sorted = cities.toSorted((a, b) => a.value - b.value);
  return {
    animation,
    grid: { left: 52, right: 12, top: 30, bottom: 20 },
    // 目标线的标签在上端，图例放左边避开它
    legend: { ...LEGEND, left: 0, data: [labels.compare, labels.view] },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: value => formatValue(Number(value), indicator) },
    xAxis: { type: 'value', axisLabel: AXIS, splitLine: SPLIT, max: indicator.unit === '%' ? 100 : undefined },
    yAxis: {
      type: 'category',
      data: sorted.map(city => city.name.replace(/市$/, '')),
      axisLabel: AXIS,
      axisTick: { show: false },
      axisLine: { lineStyle: { color: '#e2e5ec' } }
    },
    series: [
      {
        name: labels.compare,
        type: 'bar',
        barWidth: 6,
        barGap: '30%',
        itemStyle: { color: PRIMARY_LIGHT, borderRadius: 3 },
        data: sorted.map(city => base.get(city.code) ?? 0)
      },
      {
        name: labels.view,
        type: 'bar',
        barWidth: 6,
        itemStyle: { color: PRIMARY, borderRadius: 3 },
        data: sorted.map(city => ({ value: city.value, itemStyle: { color: city.pass ? PRIMARY : FAIL } })),
        markLine: targetLine('xAxis', target, true)
      }
    ]
  };
}

/** 参数敏感性：人均类是全省值随常住人口变化的曲线，覆盖率是各种规程、认定组合的柱子；都标出当前取值 */
export function sensitivityOption(
  indicator: SimulationIndicator,
  sensitivity: Sensitivity,
  target: number,
  animation: boolean
): SimulationChartOption {
  if (sensitivity.kind === 'options') {
    return optionsChart(indicator, sensitivity.options, target, animation);
  }
  const curve = sensitivity;
  const found = curve.points.find(([x]) => x === curve.current);
  // 当前取值：只有一个点的线，显示圆点和"当前"
  const marker: LineSeriesOption = {
    type: 'line',
    symbol: 'circle',
    symbolSize: 10,
    itemStyle: { color: PRIMARY, borderColor: '#ffffff', borderWidth: 2 },
    label: { show: true, position: 'top', fontSize: 12, color: PRIMARY_DEEP, formatter: '当前' },
    tooltip: { show: false },
    data: found ? [[found[0], found[1]]] : []
  };
  return {
    animation,
    grid: { left: 44, right: 16, top: 16, bottom: 28 },
    tooltip: {
      trigger: 'axis',
      valueFormatter: value => formatValue(Number(value), indicator)
    },
    xAxis: {
      type: 'value',
      min: curve.points[0]?.[0],
      max: curve.points.at(-1)?.[0],
      axisLabel: { ...AXIS, formatter: (value: number) => `${value > 0 ? '+' : ''}${value}` },
      name: '人口 %',
      nameTextStyle: { fontSize: 12, color: '#8a94a6' },
      nameGap: 4,
      splitLine: { show: false }
    },
    yAxis: { type: 'value', scale: true, axisLabel: AXIS, splitLine: SPLIT },
    series: [
      {
        type: 'line',
        smooth: true,
        symbol: 'none',
        lineStyle: { color: PRIMARY, width: 2 },
        areaStyle: { color: 'rgba(89, 126, 247, 0.08)' },
        data: curve.points.map(([x, y]) => [x, y]),
        markLine: targetLine('yAxis', target, false)
      },
      marker
    ]
  };
}

// 规程、认定的各种组合：当前的一根用主色并标"当前"，其余浅色；目标值画成横线
/** 参数组合的横轴标签：组合拆成两行（"旧规程 + 相交即算"） */
export const comboLabel = (label: string): string => label.replace(' + ', '\n');

function optionsChart(
  indicator: SimulationIndicator,
  options: readonly SensitivityOption[],
  target: number,
  animation: boolean
): SimulationChartOption {
  return {
    animation,
    grid: { left: 44, right: 16, top: 20, bottom: 40 },
    tooltip: { trigger: 'axis', valueFormatter: value => formatValue(Number(value), indicator) },
    xAxis: {
      type: 'category',
      data: options.map(option => option.label),
      // 四种组合时一格只有约 60 宽：每个标签都显示，组合拆成两行
      axisLabel: { ...AXIS, interval: 0, lineHeight: 14, formatter: comboLabel },
      axisTick: { show: false },
      axisLine: { lineStyle: { color: '#e2e5ec' } }
    },
    // 柱子从 0 画起，和城市对比一样到 100%，目标线也在图里
    yAxis: { type: 'value', axisLabel: AXIS, splitLine: SPLIT, max: indicator.unit === '%' ? 100 : undefined },
    series: [
      {
        type: 'bar',
        barWidth: 18,
        data: options.map(option => ({
          value: option.value,
          itemStyle: { color: option.current ? PRIMARY : PRIMARY_LIGHT, borderRadius: [3, 3, 0, 0] },
          label: option.current
            ? { show: true, position: 'top', fontSize: 12, color: PRIMARY_DEEP, formatter: '当前' }
            : { show: false }
        })),
        markLine: targetLine('yAxis', target, false)
      }
    ]
  };
}
