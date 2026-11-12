import type { DashboardChartOption } from './options';
import { createChart } from './runtime';

// 字体名和真实图表不同：zrender 按字体缓存文字宽度，字体还没加载完时量到的宽度不能留给真实图表
const WARM_UP_FONT = 'city-dashboard-warm-up, sans-serif';

/**
 * 在屏幕外画一张不显示的图表后立即销毁：ECharts 第一次绘制要编译和初始化，比之后每张慢几倍，
 * 提前做完，入场时揭示图表就不会卡住同一帧里的动画
 */
export function warmUpChart(option: DashboardChartOption, width: number, height: number): void {
  const host = document.createElement('div');
  Object.assign(host.style, {
    position: 'fixed',
    top: '0',
    left: `${-width - 100}px`,
    width: `${width}px`,
    height: `${height}px`,
    visibility: 'hidden',
    pointerEvents: 'none'
  });
  document.body.append(host);
  const chart = createChart(host, undefined, { devicePixelRatio: Math.min(devicePixelRatio || 1, 2) });
  try {
    // 只为编译和初始化，不显示，文字颜色等用默认值即可
    chart.setOption({ ...option, textStyle: { fontFamily: WARM_UP_FONT } });
  } finally {
    chart.dispose();
    host.remove();
  }
}
