import { init, use } from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { LabelLayout } from 'echarts/features';

// 只注册驾驶舱当前需要的图形；入口由组件所在的懒加载页面引入
use([BarChart, LineChart, GridComponent, LegendComponent, TooltipComponent, LabelLayout, CanvasRenderer]);

export const createChart = init;
