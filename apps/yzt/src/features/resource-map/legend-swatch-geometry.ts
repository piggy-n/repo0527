import { Color } from '@maplibre/maplibre-gl-style-spec';
import type { LegendSwatch } from './legend';
import { withAlpha } from './symbols';

// 图例符号的几何（ADR 0159）：页面上的 SVG（LegendSwatchIcon）和导出图片里的 canvas（legend-canvas，ADR 0174）按同一套数值画

/** 三种尺寸：摘要 28 × 20（图例浮层的标题），子图例 22 × 16（也用在导出的图例里），图层列表的行首和右侧图例的行 20 × 14 */
export type SwatchSize = 'summary' | 'item' | 'small';

export const SWATCH_SIZES: Readonly<Record<SwatchSize, readonly [width: number, height: number]>> = {
  summary: [28, 20],
  item: [22, 16],
  small: [20, 14]
};

export type Point = readonly [x: number, y: number];
export type FillSwatch = Extract<LegendSwatch, { geometry: 'fill' }>;
export type LineSwatch = Extract<LegendSwatch, { geometry: 'line' }>;
export type CircleSwatch = Extract<LegendSwatch, { geometry: 'circle' }>;

export const round = (value: number) => Number(value.toFixed(2));

/** 线宽按预览框的高度限制，太细看不见 */
export function lineWidthOf(swatch: LineSwatch, height: number): number {
  const max = height <= 14 ? 2.4 : height <= 16 ? 2.6 : 3;
  return Math.max(1.2, Math.min(swatch.width, max));
}

/** 面的描边宽度按预览框的高度限制（28 × 20 里最多 4） */
export function outlineWidthOf(swatch: FillSwatch, height: number): number {
  return Math.min(swatch.outlineWidth, height / 5);
}

/** 线型以线宽为单位（同 MapLibre 的 line-dasharray），换成像素 */
export function dashPixels(dash: readonly number[] | null, width: number): number[] | undefined {
  return dash?.map(value => round(value * width));
}

/**
 * 折线一段上的线型（像素）：两端都落在实的部分（整数个周期再加第一段），折线的拐角不断开；
 * 单位不超过线宽（同地图上的比例），短的线段里线型按比例缩小，至少一个周期
 */
export function fittedDashPixels(dash: readonly number[] | null, width: number, length: number): number[] | undefined {
  if (!dash) {
    return undefined;
  }
  const period = dash.reduce((sum, value) => sum + value, 0);
  const first = dash[0] ?? 0;
  let count = 1;
  let unit = length / (period + first);
  while (unit > width) {
    count += 1;
    unit = length / (count * period + first);
  }
  return dashPixels(dash, unit);
}

/** 三段的折线（∧∨），两端留出线帽的位置 */
export function zigzag(width: number, height: number): Point[] {
  const margin = 2.5;
  return [
    [margin, height * 0.72],
    [width * 0.37, height * 0.3],
    [width * 0.63, height * 0.7],
    [width - margin, height * 0.28]
  ];
}

/** 颜色拆成不透明的颜色和透明度：半透明的线整组设透明度，线段、拐角和圆头重叠的地方不会叠出更深的斑点 */
export function splitAlpha(color: string): readonly [opaque: string, alpha: number] {
  const alpha = Color.parse(color)?.a ?? 1;
  return alpha < 1 ? [withAlpha(color, 1), round(alpha)] : [color, 1];
}

/** 形状离中心最远 1.2 个半径（定位针、五角星），加上描边和浅灰的一圈要放得进预览框 */
const SHAPE_EXTENT = 1.2;

/** 单个点的半径：按符号的半径换算到预览框（28 × 20 时不变），不小于 2.5 */
export function singleRadius(swatch: CircleSwatch, height: number): number {
  const fits = (height / 2 - swatch.strokeWidth - 0.75) / SHAPE_EXTENT;
  return Math.max(2.5, Math.min((swatch.radius * height) / 20, fits));
}

/** 点最外一圈浅灰的线宽：描边两侧加 1.5，白色描边在浅色底上也看得出边界 */
export function haloWidthOf(strokeWidth: number): number {
  return round(strokeWidth * 2 + 1.5);
}
