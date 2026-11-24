import type { PrintLegendBlock, SwatchBox } from '../print/print-legend';
import { BOUNDARY_OPTIONS, type BoundarySwatchLine, type BoundaryState, boundarySwatch } from './boundary-style';

/** 在 canvas 上画一级边界的线型（ADR 0174）：同面板的示意，几条线从下到上叠在框的中线上，透明度乘上状态里的透明度 */
export function drawBoundarySwatch(
  context: CanvasRenderingContext2D,
  lines: readonly BoundarySwatchLine[],
  { x, y, width, height }: SwatchBox,
  opacity = 1
): void {
  const middle = y + height / 2;
  context.save();
  context.lineCap = 'round';
  for (const line of lines) {
    context.globalAlpha = line.opacity * opacity;
    context.strokeStyle = line.color;
    context.lineWidth = line.width;
    context.setLineDash(line.dasharray?.map(value => value * line.width) ?? []);
    context.beginPath();
    context.moveTo(x + line.width / 2, middle);
    context.lineTo(x + width - line.width / 2, middle);
    context.stroke();
  }
  context.restore();
}

/** 导出图片里行政区边界的一组（ADR 0174，用户 2026-11-24）：打开的级别各一行；都没开、透明度为 0 时没有 */
export function boundaryPrintBlock({ visible, opacity }: BoundaryState): PrintLegendBlock | null {
  const levels = BOUNDARY_OPTIONS.filter(({ id }) => visible[id]);
  if (levels.length === 0 || opacity === 0) {
    return null;
  }
  return {
    title: '行政区边界',
    rows: levels.map(({ id, label }) => ({
      label,
      drawSwatch: (context, box) => drawBoundarySwatch(context, boundarySwatch(id), box, opacity)
    }))
  };
}
