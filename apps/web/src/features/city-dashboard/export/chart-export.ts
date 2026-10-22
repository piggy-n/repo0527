import { createChart } from '../charts/runtime';
import type { DashboardChartOption } from '../charts/options';

/** 独立导出实例读取固定选项，不依赖可能已滚出屏幕或切换的实时画布 */
export function renderChartImage(option: DashboardChartOption, width: number, height: number): HTMLCanvasElement {
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-100000px;top:0;width:${width}px;height:${height}px;pointer-events:none;`;
  document.body.appendChild(host);
  let chart: ReturnType<typeof createChart> | undefined;
  try {
    chart = createChart(host, undefined, { devicePixelRatio: 2 });
    chart.setOption({ ...option, animation: false });
    const image = chart.renderToCanvas({ pixelRatio: 2, backgroundColor: '#ECF6FE' });
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('图表导出画布不可用');
    }
    context.drawImage(image, 0, 0);
    return canvas;
  } finally {
    chart?.dispose();
    host.remove();
  }
}
