import { BarChart, LineChart, PieChart } from 'echarts/charts';
import { DataZoomComponent, GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { init, use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';

// 只注册回答里会出现的图形；由懒加载的 AI 对话页引入
use([
  BarChart,
  LineChart,
  PieChart,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer
]);

export const createChart = init;
