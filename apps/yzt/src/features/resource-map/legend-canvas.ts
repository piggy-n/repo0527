import type { SwatchBox } from '@/shared/map/print/print-legend';
import { patternPreviewTile, PREVIEW_STROKE } from './fill-patterns';
import type { LegendSwatch } from './legend';
import {
  type CircleSwatch,
  dashPixels,
  type FillSwatch,
  fittedDashPixels,
  haloWidthOf,
  type LineSwatch,
  lineWidthOf,
  outlineWidthOf,
  type Point,
  singleRadius,
  splitAlpha,
  zigzag
} from './legend-swatch-geometry';
import { shapeSvgPath } from './point-shapes';

// 导出图片里的图例符号（ADR 0174）：画法和数值同页面上的 LegendSwatchIcon（ADR 0159），几何来自 legend-swatch-geometry；
// 点最外一圈的颜色同它的 halo（--color-border），图片是导出的数据，用固定的颜色
const HALO = '#e6ebf3';

// 面的预览框：描边画在矩形边上，往里收半个线宽才不被裁掉；圆角 2 同 SVG
function fillPath(context: CanvasRenderingContext2D, width: number, height: number, outline: number): void {
  const inset = outline / 2;
  context.beginPath();
  context.roundRect(inset, inset, width - outline, height - outline, 2);
}

// 花纹：同 patternPreviewSvg 的图块，从左上角平铺，裁在面的范围里
function drawPattern(context: CanvasRenderingContext2D, swatch: FillSwatch, width: number, height: number): void {
  if (!swatch.pattern) {
    return;
  }
  const { size, path, dots } = patternPreviewTile(swatch.pattern.name);
  const lines = path === '' ? null : new Path2D(path);
  context.save();
  context.clip();
  context.strokeStyle = swatch.pattern.color;
  context.fillStyle = swatch.pattern.color;
  context.lineWidth = PREVIEW_STROKE;
  for (let x = 0; x < width; x += size) {
    for (let y = 0; y < height; y += size) {
      context.save();
      context.translate(x, y);
      if (lines) {
        context.stroke(lines);
      }
      for (const [cx, cy] of dots) {
        context.beginPath();
        context.arc(cx, cy, PREVIEW_STROKE, 0, Math.PI * 2);
        context.fill();
      }
      context.restore();
    }
  }
  context.restore();
}

function drawFill(context: CanvasRenderingContext2D, swatch: FillSwatch, width: number, height: number): void {
  const outline = outlineWidthOf(swatch, height);
  fillPath(context, width, height, outline);
  context.fillStyle = swatch.fill;
  context.fill();
  drawPattern(context, swatch, width, height);
  if (outline > 0) {
    fillPath(context, width, height, outline);
    context.strokeStyle = swatch.outline;
    context.lineWidth = outline;
    context.setLineDash(dashPixels(swatch.outlineDash, outline) ?? []);
    context.stroke();
  }
}

// 半透明的线整组设透明度：先在不透明的一层上画完，再按透明度叠上去，线段、拐角和圆头重叠的地方不会叠出更深的斑点
function inLayer(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  alpha: number,
  draw: (target: CanvasRenderingContext2D) => void
): void {
  if (alpha >= 1) {
    draw(context);
    return;
  }
  const scale = Math.max(1, context.getTransform().a);
  const layer = context.canvas.ownerDocument.createElement('canvas');
  layer.width = Math.ceil(width * scale);
  layer.height = Math.ceil(height * scale);
  const target = layer.getContext('2d');
  if (!target) {
    return;
  }
  target.scale(scale, scale);
  draw(target);
  context.globalAlpha *= alpha;
  context.drawImage(layer, 0, 0, width, height);
}

// 一种线：实线是一条折线（圆线帽、圆拐角，同地图）；有线型时每段各自缩放线型，两端补上圆头
function drawLine(context: CanvasRenderingContext2D, swatch: LineSwatch, width: number, height: number): void {
  const points = zigzag(width, height);
  const [color, alpha] = splitAlpha(swatch.color);
  const lineWidth = lineWidthOf(swatch, height);
  inLayer(context, width, height, alpha, target => {
    target.strokeStyle = color;
    target.fillStyle = color;
    target.lineWidth = lineWidth;
    target.lineJoin = 'round';
    if (!swatch.dash) {
      target.lineCap = 'round';
      target.beginPath();
      points.forEach(([x, y], index) => (index === 0 ? target.moveTo(x, y) : target.lineTo(x, y)));
      target.stroke();
      return;
    }
    target.lineCap = 'butt';
    points.slice(1).forEach((to, index) => {
      const from = points[index] ?? to;
      drawSegment(target, from, to, swatch.dash, lineWidth);
    });
  });
}

function drawSegment(
  context: CanvasRenderingContext2D,
  from: Point,
  to: Point,
  dash: readonly number[] | null,
  width: number
): void {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  context.setLineDash(fittedDashPixels(dash, width, length) ?? []);
  context.beginPath();
  context.moveTo(...from);
  context.lineTo(...to);
  context.stroke();
  for (const [x, y] of [from, to]) {
    context.beginPath();
    context.arc(x, y, width / 2, 0, Math.PI * 2);
    context.fill();
  }
}

// 点：最外一圈浅灰，再画描边、填充；描边在形状外面（同地图的 icon-halo）
function drawPoint(context: CanvasRenderingContext2D, swatch: CircleSwatch, width: number, height: number): void {
  const radius = singleRadius(swatch, height);
  const path = new Path2D(shapeSvgPath(swatch.shape, width / 2, height / 2, radius));
  context.lineJoin = 'round';
  context.strokeStyle = HALO;
  context.lineWidth = haloWidthOf(swatch.strokeWidth);
  context.stroke(path);
  if (swatch.strokeWidth > 0) {
    context.fillStyle = swatch.stroke;
    context.strokeStyle = swatch.stroke;
    context.lineWidth = swatch.strokeWidth * 2;
    // oxlint-disable-next-line unicorn/no-array-fill-with-reference-type -- 这是 canvas 按路径填充，不是数组的 fill
    context.fill(path);
    context.stroke(path);
  }
  context.fillStyle = swatch.fill;
  // oxlint-disable-next-line unicorn/no-array-fill-with-reference-type -- 这是 canvas 按路径填充，不是数组的 fill
  context.fill(path, 'evenodd');
}

/** 在 canvas 上画一个图例符号（ADR 0174）：box 一般是子图例的 22 × 16；opacity 是图层的透明度，同右侧图例变淡 */
export function drawLegendSwatch(
  context: CanvasRenderingContext2D,
  swatch: LegendSwatch,
  box: SwatchBox,
  opacity = 1
): void {
  context.save();
  context.translate(box.x, box.y);
  context.globalAlpha *= opacity;
  if (swatch.geometry === 'fill') {
    drawFill(context, swatch, box.width, box.height);
  } else if (swatch.geometry === 'line') {
    drawLine(context, swatch, box.width, box.height);
  } else {
    drawPoint(context, swatch, box.width, box.height);
  }
  context.restore();
}
