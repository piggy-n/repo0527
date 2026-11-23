import { formatValue } from '../calculations';
import { drawTitle, EXPORT_RATIO, titleBand } from '../export/image-export';
import type { IndicatorMeta } from '../model';
import type { MapLegendLevel } from './config';
import type { ExportPart, ExportRoom, PlacedExportPart } from './export-parts';
import type { DashboardMapSnapshot } from './types';

/** 将 DOM 城市标签绘入已冻结的地图像素，简化地图已自带标签；不显示数值时名称画在标签中心 */
export function drawMapLabels(
  snapshot: DashboardMapSnapshot,
  indicator: Pick<IndicatorMeta, 'unit' | 'precision'>,
  showValues = true
): void {
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
  if (!showValues) {
    context.textBaseline = 'middle';
  }
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
    const nameY = showValues ? label.y - 12 : label.y;
    context.font = `600 ${Math.max(14, 20 * snapshot.labelScale)}px "Alibaba PuHuiTi"`;
    context.fillStyle = '#0E4894';
    context.strokeStyle = '#FFFFFF';
    context.lineWidth = 1.5;
    context.strokeText(label.name, label.x, nameY);
    context.fillText(label.name, label.x, nameY);
    if (!showValues) {
      return;
    }
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

const LEGEND_FONT = '400 14px "Alibaba PuHuiTi", sans-serif';
// 与 DashboardMap.module.scss 的 .legend 一致（--ui-scale 为 1）：内边距、每行高（14 像素 × 行高 1.65）、色块、色块和文字的间距
const LEGEND_PADDING = 10;
const LEGEND_ROW = 23.1;
const LEGEND_SWATCH = { width: 20, height: 13 };
const LEGEND_GAP = 8;

// 导出图片的边距、底栏上下的留白、指北针的边长、右下角比例尺至多的宽度（同页面上 --ui-scale 为 1 时）
const EDGE = 16;
const FOOTER_PADDING = 12;
const TOP_RIGHT_SIZE = 48;
const BOTTOM_RIGHT_WIDTH = 220;
const PART_GAP = 8;

/** 图例框的宽高（CSS 像素），没有档位时为 null */
export function legendSize(
  context: CanvasRenderingContext2D,
  levels: readonly MapLegendLevel[]
): { readonly width: number; readonly height: number } | null {
  if (!levels.length) {
    return null;
  }
  context.font = LEGEND_FONT;
  const text = Math.max(...levels.map(level => context.measureText(level.label).width));
  return {
    width: Math.ceil(2 + LEGEND_PADDING * 2 + LEGEND_SWATCH.width + LEGEND_GAP + text),
    height: Math.ceil(2 + LEGEND_PADDING * 2 + levels.length * LEGEND_ROW)
  };
}

/** 画图例框：半透明浅蓝底、白边、每档一行色块和文字，与页面上的图例一致 */
export function drawLegend(
  context: CanvasRenderingContext2D,
  levels: readonly MapLegendLevel[],
  box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
): void {
  context.save();
  context.beginPath();
  context.roundRect(box.x + 0.5, box.y + 0.5, box.width - 1, box.height - 1, 9);
  context.fillStyle = 'rgba(207, 233, 254, 0.78)';
  context.fill();
  context.strokeStyle = '#FFFFFF';
  context.lineWidth = 1;
  context.stroke();
  context.font = LEGEND_FONT;
  context.textAlign = 'left';
  context.textBaseline = 'middle';
  const left = box.x + 1 + LEGEND_PADDING;
  levels.forEach((level, index) => {
    const middle = box.y + 1 + LEGEND_PADDING + (index + 0.5) * LEGEND_ROW;
    context.beginPath();
    context.roundRect(left, middle - LEGEND_SWATCH.height / 2, LEGEND_SWATCH.width, LEGEND_SWATCH.height, 2);
    context.fillStyle = level.color;
    context.fill();
    context.fillStyle = '#0E4894';
    context.fillText(level.label, left + LEGEND_SWATCH.width + LEGEND_GAP, middle);
  });
  context.restore();
}

interface PlacedPart {
  readonly part: PlacedExportPart;
  readonly x: number;
  readonly y: number;
}

/** 导出地图图片的排版（CSS 像素），图片宽度等于地图宽度 */
export interface MapImageLayout {
  readonly width: number;
  readonly height: number;
  readonly title: { readonly lines: readonly string[]; readonly height: number };
  /** 地图像素画在标题栏下面，左上角的纵坐标 */
  readonly mapTop: number;
  readonly legend: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | null;
  readonly parts: readonly PlacedPart[];
}

export interface MapImageInput {
  /** 地图 CSS 尺寸 */
  readonly width: number;
  readonly height: number;
  readonly title: string;
  readonly legend: readonly MapLegendLevel[];
  /** 右上角的叠加元素（指北针），放在标题栏右侧 */
  readonly topRight: readonly ExportPart[];
  /** 右下角的叠加元素（比例尺），放在图例右侧 */
  readonly bottomRight: readonly ExportPart[];
}

// 一行叠加元素从右往左排，每个用剩下的宽度排版；放不下的跳过
function placeRow(
  context: CanvasRenderingContext2D,
  parts: readonly ExportPart[],
  room: ExportRoom
): { readonly placed: readonly PlacedExportPart[]; readonly width: number; readonly height: number } {
  const placed: PlacedExportPart[] = [];
  let width = 0;
  for (const part of parts) {
    const gap = placed.length ? PART_GAP : 0;
    const laid = part.layout(context, { width: room.width - width - gap, height: room.height });
    if (laid) {
      placed.push(laid);
      width += gap + laid.width;
    }
  }
  return { placed, width, height: Math.max(0, ...placed.map(part => part.height)) };
}

// 一行叠加元素的位置：right 是这一行的右边，y 是 middle 时的中线、bottom 时的底边
function rowPositions(
  row: ReturnType<typeof placeRow>,
  right: number,
  y: number,
  align: 'middle' | 'bottom'
): PlacedPart[] {
  let x = right;
  return row.placed.map(part => {
    x -= part.width;
    const placed = { part, x, y: align === 'middle' ? y - part.height / 2 : y - part.height };
    x -= PART_GAP;
    return placed;
  });
}

/**
 * 导出地图图片的排版：标题栏在上，指北针在标题栏右侧；地图下面是底栏，图例在左、比例尺在右，不压地图；
 * 没有图例也没有右下角元素时没有底栏（同原来的导出）
 */
export function layoutMapImage(context: CanvasRenderingContext2D, input: MapImageInput): MapImageLayout {
  const { width, height } = input;
  const top = placeRow(context, input.topRight, { width: TOP_RIGHT_SIZE, height: TOP_RIGHT_SIZE });
  // 标题在整幅宽度上居中，两侧都让出指北针的宽度
  const aside = top.placed.length ? top.width + EDGE + PART_GAP : 20;
  const title = titleBand(context, input.title, width - aside * 2);
  const legend = legendSize(context, input.legend);
  const bottomRoom = Math.min(BOTTOM_RIGHT_WIDTH, width - EDGE * 2 - (legend ? legend.width + EDGE : 0));
  const bottom = placeRow(context, input.bottomRight, { width: bottomRoom, height: Number.POSITIVE_INFINITY });
  const footerContent = Math.max(legend?.height ?? 0, bottom.height);
  // 取整到 CSS 像素：比例尺高 29.6，不取整时图片最下一行半透明、色带的边框发虚
  const footer = footerContent ? Math.ceil(footerContent) + FOOTER_PADDING * 2 : 0;
  const mapTop = title.height;
  const imageHeight = mapTop + height + footer;
  const footerBottom = imageHeight - FOOTER_PADDING;
  return {
    width,
    height: imageHeight,
    title,
    mapTop,
    legend: legend && { x: EDGE, y: footerBottom - legend.height, ...legend },
    parts: [
      ...rowPositions(top, width - EDGE, title.height / 2, 'middle'),
      ...rowPositions(bottom, width - EDGE, footerBottom, 'bottom')
    ]
  };
}

/** 把标题、地图像素、图例和角上的叠加元素合成一张导出图片 */
export function mapImage(
  map: HTMLCanvasElement,
  input: Omit<MapImageInput, 'width' | 'height'>,
  background = '#D3EFFD'
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context || !map.width || !map.height) {
    throw new Error('无法创建图片画布');
  }
  const width = map.width / EXPORT_RATIO;
  const height = map.height / EXPORT_RATIO;
  const layout = layoutMapImage(context, { ...input, width, height });
  canvas.width = map.width;
  canvas.height = Math.ceil(layout.height * EXPORT_RATIO);
  context.scale(EXPORT_RATIO, EXPORT_RATIO);
  context.fillStyle = background;
  context.fillRect(0, 0, width, canvas.height / EXPORT_RATIO);
  drawTitle(context, layout.title.lines, width / 2);
  context.drawImage(map, 0, layout.mapTop, width, height);
  if (layout.legend) {
    drawLegend(context, input.legend, layout.legend);
  }
  layout.parts.forEach(({ part, x, y }) => part.draw(context, x, y));
  return canvas;
}
