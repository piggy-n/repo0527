import type { RadarSeriesOption } from 'echarts/charts';
import type { ChartPreference, ChartType, Comparison } from '../model';
import { formatValue } from '../calculations';
import { createValueAxisScale } from './axis-scale';
import { AVERAGE_COLOR } from './palette';
import { CHART_FONT_FAMILY, chartLegend, type ChartInput, type DashboardChartOption } from './options';

/** 雷达图至少要 3 根轴；城市更少时由调用方显示空态 */
export const RADAR_MIN_CITIES = 3;

/** 与柱、折线的输入同义；size、activeYear 只有柱和折线的标签排布用到，雷达不读 */
export interface RadarInput extends Omit<ChartInput, 'preference'> {
  readonly preference: ChartPreference<ChartType>;
}

// 横轴、雷达轴上的城市名去掉末尾的"市"，与柱图一致
function axisName(name: string): string {
  return name.replace(/市$/, '');
}

/** 以所选城市为轴的雷达：每个年份一个面，均值是一圈虚线；提示框列出每个城市的值 */
export function createRadarOption(input: RadarInput): DashboardChartOption {
  const { indicator, cities, comparison, preference, detail = false, focusedCity } = input;
  const density = detail ? 1 : input.density ?? 1;
  const fontSize = detail ? 16 : Math.max(12, 13 * density);
  const latest = comparison.reduce<Comparison | undefined>(
    (result, item) => (!result || item.year > result.year ? item : result),
    undefined
  );
  const percentage = indicator.unit === '%';
  const axis = createValueAxisScale(comparison.flatMap(item => [...item.values, item.average]), {
    includeZero: true,
    integer: indicator.precision === 0,
    lowerBound: percentage ? 0 : undefined,
    upperBound: percentage ? 100 : undefined
  });
  const focusedName = cities.find(city => city.code === focusedCity)?.name;
  // 提示框按系列名找到这一圈的值；表头只写年份，单元格只有城市名（固定目录）和数字
  const rows = new Map<string, { label: string; values: readonly (number | null)[] }>();
  const series: RadarSeriesOption[] = comparison.map(item => {
    const name = String(item.year);
    const color = input.color(item.year);
    rows.set(name, { label: `${item.year}年`, values: item.values });
    return {
      id: `year-${item.year}`,
      name,
      type: 'radar',
      symbol: 'circle',
      symbolSize: detail ? 6 : 4 * density,
      itemStyle: { color },
      lineStyle: { color, width: (detail ? 2 : 1.6) * density },
      areaStyle: { color, opacity: 0.18 },
      data: [{ name, value: [...item.values] }]
    };
  });
  const showAverage = preference.showAverage && latest;
  if (showAverage) {
    const name = `${latest.year}均值`;
    const values = cities.map(() => latest.average);
    rows.set(name, { label: name, values });
    series.push({
      id: 'average',
      name,
      type: 'radar',
      symbol: 'none',
      z: 6,
      itemStyle: { color: AVERAGE_COLOR },
      lineStyle: { color: AVERAGE_COLOR, type: [3, 3], width: 1.6 * density, opacity: 0.92 },
      data: [{ name, value: values }]
    });
  }
  return {
    animation: !input.reducedMotion,
    animationDuration: 750,
    animationDurationUpdate: 550,
    animationEasing: 'cubicOut',
    textStyle: { fontFamily: CHART_FONT_FAMILY, color: '#0F4FA6' },
    legend: chartLegend(density, fontSize, preference.legend, [...rows.keys()]),
    tooltip: {
      trigger: 'item',
      confine: true,
      backgroundColor: 'rgba(255,255,255,0.96)',
      borderColor: '#CFE9FE',
      padding: [8, 10],
      textStyle: { color: '#0E4894', fontSize: 13, fontFamily: CHART_FONT_FAMILY },
      extraCssText: 'box-shadow:0 3px 14px rgba(14,72,148,0.16);',
      formatter: (params: unknown) => {
        const name = typeof params === 'object' && params !== null && 'name' in params ? params.name : undefined;
        const row = typeof name === 'string' ? rows.get(name) : undefined;
        if (!row) {
          return '';
        }
        const cells = cities.map((city, index) => (
          `<span>${axisName(city.name)}</span><b>${formatValue(row.values[index], indicator, false)}</b>`
        ));
        return `<div style="font-weight:600;margin-bottom:4px">${row.label}</div>`
          + `<div style="display:grid;grid-template-columns:repeat(2,auto auto);gap:2px 10px">${cells.join('')}</div>`;
      }
    },
    radar: {
      center: ['50%', detail ? '54%' : '57%'],
      radius: detail ? '70%' : '62%',
      // 从正上方顺时针按城市目录的顺序排
      startAngle: 90,
      clockwise: true,
      shape: 'polygon',
      splitNumber: Math.max(1, Math.round((axis.max - axis.min) / axis.interval)),
      indicator: cities.map(city => ({ name: axisName(city.name), min: axis.min, max: axis.max })),
      axisNameGap: detail ? 10 : 5 * density,
      axisName: {
        color: '#0F4FA6',
        fontSize,
        formatter: (name?: string) => {
          const text = name ?? '';
          return focusedName && text === axisName(focusedName) ? `{focused|${text}}` : text;
        },
        rich: {
          focused: {
            color: '#0E4894',
            fontWeight: 600,
            fontSize,
            backgroundColor: '#CFE9FE',
            borderRadius: 4,
            padding: [4, 7]
          }
        }
      },
      axisLine: { lineStyle: { color: '#B5D1E8' } },
      splitLine: { lineStyle: { color: '#D3E7FF', type: 'dashed' } },
      splitArea: { areaStyle: { color: ['rgba(236,246,254,0.55)', 'rgba(255,255,255,0.25)'] } }
    },
    series
  };
}
