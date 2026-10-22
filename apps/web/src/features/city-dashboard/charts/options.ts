import type { BarSeriesOption, LineSeriesOption } from 'echarts/charts';
import type { GridComponentOption, LegendComponentOption, TooltipComponentOption } from 'echarts/components';
import type { ComposeOption } from 'echarts/core';
import type { ChartPreference, City, Comparison, Indicator } from '../model';
import { formatValue, isValue } from '../calculations';
import { createValueAxisScale } from './axis-scale';
import { AVERAGE_COLOR, yearColor } from './colors';
import { createDetailLabelPlan } from './detail-labels';

export type DashboardChartOption = ComposeOption<
  BarSeriesOption | LineSeriesOption | GridComponentOption | LegendComponentOption | TooltipComponentOption
>;

export interface ChartInput {
  readonly indicator: Indicator;
  readonly cities: readonly City[];
  readonly comparison: readonly Comparison[];
  readonly preference: ChartPreference;
  readonly detail?: boolean;
  readonly focusedCity?: string | null;
  readonly reducedMotion?: boolean;
  readonly density?: number;
  readonly activeYear?: number | null;
  readonly size?: { width: number; height: number };
}

/** 多于三年保留旧版按城市堆叠，不把年度值累计解释为覆盖率 */
export function isStacked(input: Pick<ChartInput, 'comparison' | 'preference'>): boolean {
  return input.preference.type === 'bar' && input.comparison.length > 3;
}

/** 图表配置只依赖快照；均值始终取最新比较年，与地图时间轴无关 */
export function createChartOption(input: ChartInput): DashboardChartOption {
  const { indicator, cities, comparison, preference, detail = false, focusedCity } = input;
  const density = detail ? 1 : input.density ?? 1;
  const fontSize = detail ? 16 : Math.max(12, 13 * density);
  const stacked = isStacked(input);
  const latest = comparison.reduce<Comparison | undefined>((result, item) =>
    !result || item.year > result.year ? item : result, undefined);
  const values = stacked ? cities.flatMap((_, index) => {
    const valid = comparison.map(item => item.values[index]).filter(isValue);
    return valid.length ? [
      valid.reduce((sum, value) => sum + Math.max(0, value), 0),
      valid.reduce((sum, value) => sum + Math.min(0, value), 0)
    ] : [];
  }) : comparison.flatMap(item => [...item.values, item.average]);
  const percentage = indicator.unit === '%' && !stacked;
  const axis = createValueAxisScale(values, {
    includeZero: preference.type === 'bar', integer: indicator.precision === 0,
    lowerBound: percentage ? 0 : undefined, upperBound: percentage ? 100 : undefined
  });
  const cityIndex = cities.findIndex(city => city.code === focusedCity);
  const plan = detail && cityIndex >= 0 ? createDetailLabelPlan({
    comparison: comparison.filter(item => preference.legend[String(item.year)] ?? true),
    cityIndex, cityCount: cities.length, activeYear: input.activeYear ?? null, chartType: preference.type,
    stacked, axis, size: input.size ?? { width: 0, height: 0 }, formatValue: value => formatValue(value, indicator, false)
  }) : {};
  const series: (BarSeriesOption | LineSeriesOption)[] = comparison.map((item, seriesIndex) => {
    const color = yearColor(item.year, preference.type);
    const data = item.values.map((value, index) => ({
      value,
      symbolSize: index === cityIndex ? 11 : detail ? 8 : 6 * density,
      label: { show: index === cityIndex && (plan[item.year]?.show ?? false),
        position: plan[item.year]?.position ?? 'top', distance: 10,
        color: stacked ? '#FFF' : '#0E4894', fontWeight: 600, fontSize: 15, lineHeight: 22,
        backgroundColor: stacked ? 'rgba(14,72,148,.92)' : 'rgba(243,250,255,.94)', borderRadius: 3, padding: [2, 4],
        formatter: `${plan[item.year]?.compact || preference.type === 'line' ? `${item.year}年${stacked ? '\n' : ' '}` : ''}${formatValue(value, indicator, false)}` },
      itemStyle: focusedCity ? {
        opacity: cities[index]?.code === focusedCity ? 1 : .38,
        borderColor: cities[index]?.code === focusedCity ? '#C88E00' : undefined,
        borderWidth: cities[index]?.code === focusedCity ? 2 : 0
      } : undefined
    }));
    const base = { id: `year-${item.year}`, name: String(item.year), data, itemStyle: { color },
      labelLayout: { hideOverlap: true, dy: plan[item.year]?.offset[1] ?? 0 } };
    return preference.type === 'bar'
      ? { ...base, type: 'bar', stack: stacked ? 'annual-comparison' : undefined, barMaxWidth: detail ? 32 : 18 * density, barGap: '15%' }
      : { ...base, type: 'line', symbol: ['emptyCircle', 'emptyRect', 'emptyTriangle', 'emptyDiamond'][seriesIndex % 4], symbolSize: detail ? 8 : 6 * density, lineStyle: { color, width: 2.5 * density } };
  });
  const showAverage = preference.showAverage && !stacked && latest;
  if (showAverage) {
    series.push({
      id: 'average', name: `${latest.year}均值`, type: 'line', data: cities.map(() => latest.average),
      symbol: 'none', z: 6, itemStyle: { color: AVERAGE_COLOR },
      lineStyle: { color: AVERAGE_COLOR, type: [3, 3], width: 1.6 * density, opacity: .92 }
    });
  }
  return {
    animation: !input.reducedMotion,
    animationDuration: 750,
    animationDurationUpdate: 550,
    animationEasing: 'cubicOut',
    textStyle: { fontFamily: 'Alibaba PuHuiTi, Microsoft YaHei, sans-serif', color: '#0F4FA6' },
    grid: { left: detail ? 18 : 8 * density, right: detail ? 30 : 12 * density,
      top: detail ? (stacked ? 64 : 46) : (stacked ? 52 : 36) * density, bottom: detail ? 20 : 12 * density, containLabel: true },
    legend: {
      type: 'scroll', top: 2, left: 'center', right: 12, itemWidth: 16 * density, itemHeight: 9 * density, itemGap: 10 * density,
      textStyle: { fontSize, color: '#0F4FA6' },
      selected: { ...preference.legend },
      data: [...comparison.map(item => String(item.year)), ...(showAverage ? [`${latest.year}均值`] : [])],
      pageIconColor: '#438EFB'
    },
    // 唯一 DOM 表格由组件呈现，ECharts 只计算指示线与城市索引
    tooltip: { trigger: 'axis', showContent: false, axisPointer: { type: preference.type === 'bar' ? 'shadow' : 'line', shadowStyle: { color: 'rgba(67,142,251,.08)' }, lineStyle: { color: '#89BFFF', type: 'dashed' } } },
    xAxis: {
      type: 'category', data: cities.map(city => city.name.replace(/市$/, '')),
      axisLine: { lineStyle: { color: '#B5D1E8' } }, axisTick: { show: false },
      axisLabel: { interval: 0, rotate: !detail && cities.length > 8 ? 38 : 0, margin: 10, fontSize,
        formatter: (name: string, index: number) => detail && index === cityIndex ? `{focused|${name}}` : name,
        rich: { focused: { color: '#0E4894', fontWeight: 600, fontSize, backgroundColor: '#CFE9FE', borderRadius: 4, padding: [4, 7] } } }
    },
    yAxis: {
      type: 'value', min: axis.min, max: axis.max, interval: axis.interval,
      name: stacked ? (indicator.unit === '1:X' ? '年度 X 值累计' : `年度值累计（${indicator.unit}）`) : '',
      nameGap: 10, nameTextStyle: { align: 'left', fontSize: Math.max(11, 12 * density) },
      axisLabel: { fontSize, hideOverlap: true, showMinLabel: true, showMaxLabel: true,
        formatter: (value: number) => formatValue(value, indicator, false, axis.precision) },
      axisLine: { show: false }, axisTick: { show: false },
      splitLine: { lineStyle: { type: 'dashed', color: '#D3E7FF' } }
    },
    series
  };
}
