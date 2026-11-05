import { formatValue } from '../calculations';
import type { DashboardMapSnapshot } from '../map/types';
import type { Indicator } from '../model';

/** 将 DOM 城市标签绘入已冻结的地图像素，简化地图已自带标签 */
export function drawMapLabels(snapshot: DashboardMapSnapshot, indicator: Indicator): void {
  const context = snapshot.canvas.getContext('2d');
  if (!context) {
    throw new Error('地图导出画布不可用');
  }
  if (snapshot.simple) {
    return;
  }
  context.save();
  context.scale(2, 2);
  context.textAlign = 'center';
  snapshot.labels.forEach(label => {
    // 窄屏避让后的引线一同导出，文字描边保证深色城市上可读
    if (label.connected) {
      context.beginPath();
      context.moveTo(label.anchorX, label.anchorY);
      context.lineTo(label.x, label.y);
      context.strokeStyle = '#FFFFFF';
      context.lineWidth = 0.8;
      context.stroke();
    }
    context.font = `600 ${Math.max(14, 20 * snapshot.labelScale)}px "Alibaba PuHuiTi"`;
    context.fillStyle = '#0E4894';
    context.strokeStyle = '#FFFFFF';
    context.lineWidth = 1.5;
    context.strokeText(label.name, label.x, label.y - 12);
    context.fillText(label.name, label.x, label.y - 12);
    context.font = `600 ${Math.max(12, 14 * snapshot.labelScale)}px "Alibaba PuHuiTi"`;
    context.fillStyle = '#8B6500';
    const value = snapshot.values[label.code];
    if (value !== null) {
      const text = formatValue(value, indicator, indicator.unit.length <= 3);
      context.strokeText(text, label.x, label.y + 7);
      context.fillText(text, label.x, label.y + 7);
    }
  });
  context.restore();
}
