import { GraphChart } from 'echarts/charts';
import { LegendComponent, TooltipComponent } from 'echarts/components';
import { init, use } from 'echarts/core';
import { LabelLayout } from 'echarts/features';
import { CanvasRenderer } from 'echarts/renderers';

// 关系图的运行时：ECharts、d3-force 和配置的推导都在这一块里，打开自助取数的第二步时才动态导入
use([GraphChart, LegendComponent, TooltipComponent, LabelLayout, CanvasRenderer]);

export const createChart = init;
export { knowledgeChartOption } from './graph-chart';
