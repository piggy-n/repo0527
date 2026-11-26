import type { MapSnapshot } from '@mx/map-core';
import {
  LEGEND_METRICS,
  type LegendFont,
  type LegendItem,
  type LegendLayout,
  layoutPrintLegend,
  type PrintLegendBlock
} from './print-legend';

/** 图例放在哪里（ADR 0174）：地图右边另起一栏、叠在地图右下角、不带 */
export type LegendPlacement = 'side' | 'corner' | 'none';

/** 标题放在哪里（用户 2026-11-25）：整张图上面另起一栏、叠在地图上方居中 */
export type TitlePlacement = 'header' | 'map';

/** 导出图片的标题：文字已去掉首尾空白、不为空 */
export interface PrintTitle {
  readonly text: string;
  readonly placement: TitlePlacement;
}

/**
 * 标题的尺寸（CSS 像素）：顶部一栏高 56、字 22 号，两边至少留 24；地图上的标题 20 号，白底框离地图上边 16、
 * 左右内边距 16、上下 9，最宽占地图的 80%；放不下时字号逐步缩到 14，再放不下用省略号
 */
export const TITLE_METRICS = {
  headerHeight: 56,
  headerSize: 22,
  headerInset: 24,
  mapSize: 20,
  mapMargin: 16,
  mapPaddingX: 16,
  mapPaddingY: 9,
  mapMaxShare: 0.8,
  minSize: 14
} as const;

/** 标题按字号量出的宽度 */
export type TitleMeasure = (text: string, size: number) => number;

/** 标题在一行里放下（纯函数）：从 maxSize 往下缩到 minSize，还放不下时截掉末尾、加省略号 */
export function fitTitle(
  text: string,
  maxSize: number,
  maxWidth: number,
  measure: TitleMeasure
): { readonly text: string; readonly size: number } {
  for (let size = maxSize; size >= TITLE_METRICS.minSize; size -= 1) {
    if (measure(text, size) <= maxWidth) {
      return { text, size };
    }
  }
  const size = TITLE_METRICS.minSize;
  // 按字截，不把一个字（含组合的表情）截成两半
  const graphemes = new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(text);
  const characters = Array.from(graphemes, part => part.segment);
  while (characters.length > 1 && measure(`${characters.join('')}…`, size) > maxWidth) {
    characters.pop();
  }
  return { text: `${characters.join('')}…`, size };
}

/** 叠在右下角时图例最高占地图的 60%、最宽占 45%，超出时改放在右边一栏 */
export const CORNER_LIMITS = { height: 0.6, width: 0.45 } as const;

// 右下角的图例离地图边缘的距离
const CORNER_MARGIN = 16;

/** 整张图的排法，CSS 像素：上面是 top 高的顶部一栏（没有时 0），地图在它下面靠左，legend 是图例的位置 */
export interface PrintArrangement {
  /** 实际的位置：右下角放不下时是 side，没有图例条目时是 none */
  readonly placement: LegendPlacement;
  readonly width: number;
  readonly height: number;
  /** 地图的上边：顶部一栏的高度 */
  readonly top: number;
  readonly legend: { readonly x: number; readonly y: number; readonly layout: LegendLayout } | null;
}

/** 图例按给定的最高高度排出来的样子 */
export type LegendLayoutOf = (maxHeight: number) => LegendLayout;

/**
 * 按地图的 CSS 尺寸和想要的位置排整张图（纯函数）：右侧一栏和地图一样高，按高度分列；右下角放不下时改到右侧。
 * top 是顶部一栏（标题）的高度，地图和右侧一栏都往下让出这一段
 */
export function arrangePrint(
  map: { readonly width: number; readonly height: number },
  placement: LegendPlacement,
  hasLegend: boolean,
  layoutOf: LegendLayoutOf,
  top = 0
): PrintArrangement {
  if (placement === 'none' || !hasLegend) {
    return { placement: 'none', width: map.width, height: top + map.height, top, legend: null };
  }
  if (placement === 'corner') {
    const layout = layoutOf(map.height * CORNER_LIMITS.height);
    if (layout.width <= map.width * CORNER_LIMITS.width && layout.height <= map.height * CORNER_LIMITS.height) {
      const x = map.width - layout.width - CORNER_MARGIN;
      const y = top + map.height - layout.height - CORNER_MARGIN;
      return { placement, width: map.width, height: top + map.height, top, legend: { x, y, layout } };
    }
  }
  const layout = layoutOf(map.height);
  return {
    placement: 'side',
    width: map.width + layout.width,
    height: top + Math.max(map.height, layout.height),
    top,
    legend: { x: map.width, y: top, layout }
  };
}

// 图片里的颜色和字体：图片是导出的数据，不随页面主题变化；取值同设计令牌（text-title、text-strong、text-regular、divider、border）
const COLORS = {
  background: '#ffffff',
  title: '#1f2937',
  header: '#2f3a4f',
  label: '#4b5563',
  divider: '#e2e5ec',
  box: 'rgba(255, 255, 255, 0.94)',
  boxBorder: '#e6ebf3'
} as const;

const FAMILY = '"Alibaba PuHuiTi", sans-serif';

/** 图例文字的字体（canvas 的 font） */
export const LEGEND_FONTS: Readonly<Record<LegendFont, string>> = {
  title: `600 16px ${FAMILY}`,
  header: `600 14px ${FAMILY}`,
  strong: `600 14px ${FAMILY}`,
  label: `400 12px ${FAMILY}`
};

const TEXT_COLORS: Readonly<Record<LegendFont, string>> = {
  title: COLORS.title,
  header: COLORS.header,
  strong: COLORS.header,
  label: COLORS.label
};

// 各项第一行的高度：文字在这一行里垂直居中，多出的行按行高往下排
const FIRST_LINE: Readonly<Record<LegendItem['kind'], number>> = {
  title: LEGEND_METRICS.titleHeight,
  header: LEGEND_METRICS.headerHeight,
  row: LEGEND_METRICS.rowHeight
};

/** 按 canvas 量文字的宽度 */
export function canvasMeasure(context: CanvasRenderingContext2D): (text: string, font: LegendFont) => number {
  return (text, font) => {
    context.font = LEGEND_FONTS[font];
    return context.measureText(text).width;
  };
}

function drawLegend(context: CanvasRenderingContext2D, x: number, y: number, layout: LegendLayout, boxed: boolean) {
  const { columnWidth, padding, lineHeight, swatchWidth, swatchHeight, swatchGap } = LEGEND_METRICS;
  context.save();
  if (boxed) {
    context.fillStyle = COLORS.box;
    context.strokeStyle = COLORS.boxBorder;
    context.lineWidth = 1;
    context.beginPath();
    context.roundRect(x + 0.5, y + 0.5, layout.width - 1, layout.height - 1, 4);
    context.fill();
    context.stroke();
  }
  context.textBaseline = 'middle';
  for (const item of layout.items) {
    const left = x + item.column * columnWidth + padding;
    const top = y + item.y;
    if (item.kind === 'row') {
      context.save();
      item.row.drawSwatch(context, {
        x: left,
        y: top + (Math.min(item.height, LEGEND_METRICS.rowHeight) - swatchHeight) / 2,
        width: swatchWidth,
        height: swatchHeight
      });
      context.restore();
    }
    const font = item.kind === 'row' ? item.font : item.kind;
    const textLeft = item.kind === 'row' ? left + swatchWidth + swatchGap : left;
    context.font = LEGEND_FONTS[font];
    context.fillStyle = TEXT_COLORS[font];
    item.lines.forEach((line, index) =>
      context.fillText(line, textLeft, top + FIRST_LINE[item.kind] / 2 + index * lineHeight)
    );
  }
  context.restore();
}

// 标题的字体：中粗，和图例的标题同一个字体文件，fontsReady 加载图例的字体时已经加载
const titleFont = (size: number) => `600 ${size}px ${FAMILY}`;

// 顶部一栏：整张图上面的白底，标题在整张图的宽度里居中，下面一条分隔线
function drawHeaderTitle(context: CanvasRenderingContext2D, text: string, width: number) {
  const { headerHeight, headerSize, headerInset } = TITLE_METRICS;
  const fitted = fitTitle(text, headerSize, width - headerInset * 2, measureTitle(context));
  context.save();
  context.font = titleFont(fitted.size);
  context.fillStyle = COLORS.title;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(fitted.text, width / 2, headerHeight / 2);
  context.fillStyle = COLORS.divider;
  context.fillRect(0, headerHeight - 1, width, 1);
  context.restore();
}

// 地图上：地图上方居中的白底框，样式同右下角的图例（半透明白底、细边框、小圆角）
function drawMapTitle(context: CanvasRenderingContext2D, text: string, mapWidth: number, top: number) {
  const { mapSize, mapMargin, mapPaddingX, mapPaddingY, mapMaxShare } = TITLE_METRICS;
  const fitted = fitTitle(text, mapSize, mapWidth * mapMaxShare - mapPaddingX * 2, measureTitle(context));
  context.save();
  context.font = titleFont(fitted.size);
  const boxWidth = context.measureText(fitted.text).width + mapPaddingX * 2;
  const boxHeight = fitted.size + mapPaddingY * 2;
  const x = (mapWidth - boxWidth) / 2;
  const y = top + mapMargin;
  context.fillStyle = COLORS.box;
  context.strokeStyle = COLORS.boxBorder;
  context.lineWidth = 1;
  context.beginPath();
  context.roundRect(x + 0.5, y + 0.5, boxWidth - 1, boxHeight - 1, 4);
  context.fill();
  context.stroke();
  context.fillStyle = COLORS.title;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(fitted.text, mapWidth / 2, y + boxHeight / 2);
  context.restore();
}

// 按 canvas 量标题的宽度
const measureTitle =
  (context: CanvasRenderingContext2D): TitleMeasure =>
  (text, size) => {
    context.font = titleFont(size);
    return context.measureText(text).width;
  };

/** 合成的图片和图例实际的位置 */
export interface PrintImage {
  readonly canvas: HTMLCanvasElement;
  readonly placement: LegendPlacement;
  /** 整张图的 CSS 尺寸（地图加上右侧一栏的图例），乘上像素比是图片的像素 */
  readonly width: number;
  readonly height: number;
  /** 其中地图的 CSS 尺寸 */
  readonly map: { readonly width: number; readonly height: number };
}

// MapLibre 默认的画布上限（maxCanvasSize），页面没有改：地图的像素比超出它时被收小
const MAX_CANVAS_SIZE = 4096;

/** 二维按这个像素比截图时导出的图片多大（ADR 0174）：地图的像素比和 MapLibre 一样受画布上限约束 */
export function scaledPixels(
  image: Pick<PrintImage, 'width' | 'height' | 'map'>,
  pixelRatio: number
): [number, number] {
  const ratio = Math.min(pixelRatio, MAX_CANVAS_SIZE / image.map.width, MAX_CANVAS_SIZE / image.map.height);
  return [Math.round(image.width * ratio), Math.round(image.height * ratio)];
}

/**
 * 地图、图例和标题合成一张图（ADR 0174）：像素比同截图（图片的像素 ÷ 地图的 CSS 尺寸），地图原样放在左上角，
 * 有顶部一栏的标题时往下让出这一栏；右侧一栏的图例和地图之间有一条分隔线，右下角的图例有半透明的底和边框
 */
export function composePrintImage(
  snapshot: MapSnapshot,
  blocks: readonly PrintLegendBlock[],
  placement: LegendPlacement,
  title: PrintTitle | null = null
): PrintImage {
  const { image, width, height } = snapshot;
  const ratio = width > 0 ? image.width / width : 1;
  const canvas = image.ownerDocument.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('无法创建导出的画布');
  }
  const measure = canvasMeasure(context);
  const top = title?.placement === 'header' ? TITLE_METRICS.headerHeight : 0;
  const arrangement = arrangePrint(
    { width, height },
    placement,
    blocks.length > 0,
    maxHeight => layoutPrintLegend(blocks, maxHeight, measure),
    top
  );
  canvas.width = Math.round(arrangement.width * ratio);
  canvas.height = Math.round(arrangement.height * ratio);
  context.scale(ratio, ratio);
  context.fillStyle = COLORS.background;
  context.fillRect(0, 0, arrangement.width, arrangement.height);
  context.drawImage(image, 0, top, width, height);
  const { legend } = arrangement;
  if (legend) {
    const side = arrangement.placement === 'side';
    if (side) {
      context.fillStyle = COLORS.divider;
      context.fillRect(legend.x, top, 1, arrangement.height - top);
    }
    drawLegend(context, legend.x, legend.y, legend.layout, !side);
  }
  if (title?.placement === 'header') {
    drawHeaderTitle(context, title.text, arrangement.width);
  } else if (title) {
    drawMapTitle(context, title.text, width, top);
  }
  return {
    canvas,
    placement: arrangement.placement,
    width: arrangement.width,
    height: arrangement.height,
    map: { width, height }
  };
}
