import { init, use } from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { LabelLayout, LegacyGridContainLabel } from 'echarts/features';

// 只注册驾驶舱当前需要的图形；入口由组件所在的懒加载页面引入
// LegacyGridContainLabel 让 grid.containLabel 沿用 ECharts 5 的排版，否则 6 按新算法收缩网格，绘图区会移动几像素
use([
  BarChart,
  LineChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  LabelLayout,
  LegacyGridContainLabel,
  CanvasRenderer
]);

export const createChart = init;
