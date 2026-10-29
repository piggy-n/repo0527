import type { BarSeriesOption, LineSeriesOption, PieSeriesOption } from 'echarts/charts';
import type {
  DataZoomComponentOption,
  GridComponentOption,
  LegendComponentOption,
  TooltipComponentOption
} from 'echarts/components';
import type { ComposeOption } from 'echarts/core';
import { type ChatChart, formatNumber } from './chat-result';

export type ResultChartOption = ComposeOption<
  | BarSeriesOption
  | LineSeriesOption
  | PieSeriesOption
  | DataZoomComponentOption
  | GridComponentOption
  | LegendComponentOption
  | TooltipComponentOption
>;

// 图表的颜色和字体是数据，取 --color-primary 和 --font-family-base 的值
const PRIMARY = '#597ef7';
const FONT_FAMILY = "'Alibaba PuHuiTi', 'Microsoft YaHei', sans-serif";
// 分类多于 10 个时出现滑动条，多于 8 个时标签斜放（沿用旧项目）
const ZOOM_THRESHOLD = 10;
const ROTATE_THRESHOLD = 8;
// 斜放的标签限宽，过长的省略（提示框里有全名），不压到下方的滑动条
const ROTATED_LABEL_WIDTH = 72;

/** 提示框里的数值加千分位 */
export const tooltipValue = (value: unknown) => (typeof value === 'number' ? formatNumber(value) : String(value));

/** 坐标轴上的大数用"万" */
export function axisValue(value: number): string {
  return Math.abs(value) >= 10_000 ? `${(value / 10_000).toFixed(1)}万` : formatNumber(value);
}

/** 由回答的图表数据得出 ECharts 的配置：饼图用滚动图例，柱状图、折线图分类多时可以拖动查看 */
export function chartOption(chart: ChatChart): ResultChartOption {
  const name = chart.valueLabel || chart.title || '数值';
  const textStyle = { fontFamily: FONT_FAMILY };
  if (chart.type === 'pie') {
    return {
      textStyle,
      tooltip: { trigger: 'item', valueFormatter: tooltipValue },
      legend: { type: 'scroll', orient: 'vertical', right: 8, top: 24, bottom: 16 },
      series: [
        {
          name,
          type: 'pie',
          radius: ['36%', '68%'],
          center: ['40%', '52%'],
          data: chart.labels.map((label, index) => ({ name: label, value: chart.values[index] }))
        }
      ]
    };
  }

  const zoomed = chart.labels.length > ZOOM_THRESHOLD;
  const rotated = chart.labels.length > ROTATE_THRESHOLD;
  return {
    textStyle,
    color: [PRIMARY],
    tooltip: { trigger: 'axis', valueFormatter: tooltipValue },
    // 坐标轴的标签和名称都收在网格以内（outerBoundsMode: 'same'），底部只给滑动条留出位置
    grid: { top: 8, right: 16, bottom: zoomed ? 36 : 8, left: 8, outerBoundsMode: 'same' },
    dataZoom: zoomed
      ? [
          {
            type: 'slider',
            height: 18,
            bottom: 8,
            start: 0,
            end: Math.max(28, Math.round((ZOOM_THRESHOLD / chart.labels.length) * 100))
          },
          { type: 'inside' }
        ]
      : [],
    xAxis: {
      type: 'category',
      data: [...chart.labels],
      axisLabel: rotated
        ? { interval: 0, rotate: 35, width: ROTATED_LABEL_WIDTH, overflow: 'truncate' }
        : { interval: 0, rotate: 0 }
    },
    yAxis: { type: 'value', name: chart.valueLabel, axisLabel: { formatter: axisValue } },
    series: [
      chart.type === 'line'
        ? { name, type: 'line', data: [...chart.values], smooth: true }
        : { name, type: 'bar', data: [...chart.values], barMaxWidth: 28 }
    ]
  };
}
