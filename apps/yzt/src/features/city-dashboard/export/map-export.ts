import type { DashboardMapSnapshot } from '../map/types';

/** 将 DOM 城市标签绘入已冻结的地图像素，简化地图已自带标签 */
export function drawMapLabels(snapshot: DashboardMapSnapshot): void {
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
    // 演示分支：和页面一样只画城市名，居中在标签位置
    context.font = `600 ${Math.max(14, 20 * snapshot.labelScale)}px "Alibaba PuHuiTi"`;
    context.textBaseline = 'middle';
    context.fillStyle = '#0E4894';
    context.strokeStyle = '#FFFFFF';
    context.lineWidth = 1.5;
    context.strokeText(label.name, label.x, label.y);
    context.fillText(label.name, label.x, label.y);
  });
  context.restore();
}
