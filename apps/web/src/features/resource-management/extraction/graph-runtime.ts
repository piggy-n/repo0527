import { GraphChart } from 'echarts/charts';
import { TooltipComponent } from 'echarts/components';
import { init, use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';

// 知识图谱的运行时：ECharts、d3-force 和配置的推导都在这一块里，打开自助取数的第二步时才动态导入
use([GraphChart, TooltipComponent, CanvasRenderer]);

export const createChart = init;
export { createGraphDisplay, GRAPH_SERIES_ID } from './graph-chart';
export { layoutGraph } from './graph-layout';
