import type { StyleImage, StyleImages } from '@yzt/map-core';

// 面的花纹（ADR 0045 第 3 节）：形状是一份数据，按距离场生成 SDF 图片，颜色由图层的 fill-color 给出；
// 图片只和形状有关，同一个 ID 始终是同一个对象（会话按引用比较图片）

/** 8 种花纹（迁移自旧项目的 FILL_PATTERNS，不含"无填充""均匀填充"） */
export const FILL_PATTERNS = [
  'horizontal',
  'vertical',
  'cross',
  'diagonal',
  'backDiagonal',
  'xCross',
  'dense',
  'dot'
] as const;
export type FillPattern = (typeof FILL_PATTERNS)[number];

/** 线的方向：斜线从左上到右下，反斜线从左下到右上（同旧项目） */
export type PatternLine = 'horizontal' | 'vertical' | 'diagonal' | 'backDiagonal';

/** 花纹的形状：线或点阵，一个图块里分几格（线距、点距是图块边长 ÷ 格数）；图例的预览按同一份数据画 */
export interface PatternShape {
  readonly lines: readonly PatternLine[];
  readonly dots: boolean;
  readonly divisions: number;
}

export const PATTERN_SHAPES: Readonly<Record<FillPattern, PatternShape>> = {
  horizontal: { lines: ['horizontal'], dots: false, divisions: 2 },
  vertical: { lines: ['vertical'], dots: false, divisions: 2 },
  cross: { lines: ['horizontal', 'vertical'], dots: false, divisions: 2 },
  diagonal: { lines: ['diagonal'], dots: false, divisions: 2 },
  backDiagonal: { lines: ['backDiagonal'], dots: false, divisions: 2 },
  xCross: { lines: ['diagonal', 'backDiagonal'], dots: false, divisions: 2 },
  dense: { lines: ['horizontal', 'vertical'], dots: false, divisions: 4 },
  dot: { lines: [], dots: true, divisions: 2 }
};

/** 一档疏密：图块边长、线宽、点的半径，都是 CSS 像素（数值同旧项目的 MAP_PATTERN_PROFILES） */
interface Density {
  readonly tile: number;
  readonly lineWidth: number;
  readonly dotRadius: number;
}

const LOW: Density = { tile: 8, lineWidth: 0.8, dotRadius: 0.9 };
const MEDIUM: Density = { tile: 16, lineWidth: 1, dotRadius: 1.2 };
const HIGH: Density = { tile: 32, lineWidth: 1, dotRadius: 1.4 };

/** 疏密按缩放切换的级别：低于 10 级用疏档，10～14 级中档，14 级起密档 */
export const PATTERN_ZOOM_STOPS = [10, 14] as const;

// 紧凑网格在 8 像素的疏档里线距只有 2 像素，糊成实心（2026-10-12 实测），疏档也用中档
const DENSITIES: Readonly<Record<FillPattern, readonly [Density, Density, Density]>> = {
  horizontal: [LOW, MEDIUM, HIGH],
  vertical: [LOW, MEDIUM, HIGH],
  cross: [LOW, MEDIUM, HIGH],
  diagonal: [LOW, MEDIUM, HIGH],
  backDiagonal: [LOW, MEDIUM, HIGH],
  xCross: [LOW, MEDIUM, HIGH],
  dense: [MEDIUM, MEDIUM, HIGH],
  dot: [LOW, MEDIUM, HIGH]
};

/** 图片的像素比：按 2 倍生成，高分屏上斜线不起锯齿 */
export const PATTERN_PIXEL_RATIO = 2;

// 距离场：边缘在 0.75（MapLibre 的 SDF 约定），向外每 FIELD_RADIUS 个设备像素降 0.25
const SDF_EDGE = 0.75;
const FIELD_RADIUS = 2;

// ID 以分组名为前缀（ADR 0027、0045），resources 分组的推导用到
const PREFIX = 'resources-pattern-';

/** 没有花纹的取值在纹理图层里用的透明图片：同一图层不能混用 SDF 和普通图片 */
export const BLANK_PATTERN_IMAGE_ID = `${PREFIX}none`;

/** 花纹在某一档疏密下的图片 ID */
export function patternImageId(pattern: FillPattern, band: 0 | 1 | 2): string {
  return `${PREFIX}${pattern}-${DENSITIES[pattern][band].tile}`;
}

// 到最近的一条等距线的距离：value 到 step 整数倍的距离
function toNearest(value: number, step: number): number {
  const offset = ((value % step) + step) % step;
  return Math.min(offset, step - offset);
}

// 某个像素中心到花纹的有符号距离（设备像素）：在线或点里面为正
function signedDistance(shape: PatternShape, size: number, density: Density, x: number, y: number): number {
  const step = size / shape.divisions;
  if (shape.dots) {
    const radius = density.dotRadius * PATTERN_PIXEL_RATIO;
    return radius - Math.hypot(toNearest(x - step / 2, step), toNearest(y - step / 2, step));
  }
  const half = (density.lineWidth * PATTERN_PIXEL_RATIO) / 2;
  const distances: Record<PatternLine, () => number> = {
    horizontal: () => toNearest(y - step / 2, step),
    vertical: () => toNearest(x - step / 2, step),
    // 斜线 x - y 为常数，反斜线 x + y 为常数；沿坐标轴的间隔是 step，垂直距离要除以 √2
    diagonal: () => toNearest(x - y, step) / Math.SQRT2,
    backDiagonal: () => toNearest(x + y, step) / Math.SQRT2
  };
  return half - Math.min(...shape.lines.map(line => distances[line]()));
}

function sdfImage(shape: PatternShape, density: Density): StyleImage {
  const size = density.tile * PATTERN_PIXEL_RATIO;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const signed = signedDistance(shape, size, density, x + 0.5, y + 0.5);
      const alpha = Math.min(1, Math.max(0, SDF_EDGE + (signed * (1 - SDF_EDGE)) / FIELD_RADIUS));
      // 颜色通道不用，只有透明度通道是距离场
      data.set([255, 255, 255, Math.round(alpha * 255)], (y * size + x) * 4);
    }
  }
  return { width: size, height: size, data, pixelRatio: PATTERN_PIXEL_RATIO, sdf: true };
}

const BLANK_IMAGE: StyleImage = {
  width: 2,
  height: 2,
  data: new Uint8Array(16),
  pixelRatio: PATTERN_PIXEL_RATIO,
  sdf: true
};

// 生成过的图片：同一个 ID 始终返回同一个对象
const generated = new Map<string, StyleImage>([[BLANK_PATTERN_IMAGE_ID, BLANK_IMAGE]]);

function imageOf(pattern: FillPattern, band: 0 | 1 | 2): StyleImage {
  const id = patternImageId(pattern, band);
  let image = generated.get(id);
  if (!image) {
    image = sdfImage(PATTERN_SHAPES[pattern], DENSITIES[pattern][band]);
    generated.set(id, image);
  }
  return image;
}

// 图例预览的图块边长（CSS 像素）：比地图上密，小色块里也看得出花纹；紧凑网格 12（同旧项目的 LEGEND_PATTERN_TILE_SIZE）
const PREVIEW_TILES: Readonly<Record<FillPattern, number>> = {
  horizontal: 8,
  vertical: 8,
  cross: 8,
  diagonal: 8,
  backDiagonal: 8,
  xCross: 8,
  dense: 12,
  dot: 8
};

/** 图例里的花纹预览：一个图块的 SVG 和它的边长，按同一份形状数据画（ADR 0045 第 3 节），平铺成背景 */
export function patternPreviewSvg(
  pattern: FillPattern,
  color: string
): { readonly svg: string; readonly size: number } {
  const shape = PATTERN_SHAPES[pattern];
  const size = PREVIEW_TILES[pattern];
  const step = size / shape.divisions;
  const centers = Array.from({ length: shape.divisions }, (_, index) => (index + 0.5) * step);
  // 斜线要从图块外面画进来，平铺后接缝处才不断开
  const offsets = Array.from({ length: shape.divisions * 3 + 1 }, (_, index) => index * step - size);
  const paths: Record<PatternLine, () => string[]> = {
    horizontal: () => centers.map(y => `M0 ${y}H${size}`),
    vertical: () => centers.map(x => `M${x} 0V${size}`),
    diagonal: () => offsets.map(c => `M${c} 0L${c + size} ${size}`),
    backDiagonal: () => offsets.map(c => `M${c + size} 0L${c} ${size}`)
  };
  const lines = shape.lines.flatMap(line => paths[line]());
  const dots = shape.dots ? centers.flatMap(x => centers.map(y => `<circle cx="${x}" cy="${y}" r="0.8"/>`)) : [];
  const path = lines.length > 0 ? `<path d="${lines.join('')}"/>` : '';
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" ` +
    `stroke="${color}" stroke-width="0.8" fill="${color}">${path}${dots.join('')}</svg>`;
  return { svg, size };
}

/** 这些花纹三档疏密的图片，按 ID；withBlank 时加上透明图片 */
export function patternImages(patterns: Iterable<FillPattern>, withBlank: boolean): StyleImages {
  const images: Record<string, StyleImage> = withBlank ? { [BLANK_PATTERN_IMAGE_ID]: BLANK_IMAGE } : {};
  for (const pattern of patterns) {
    for (const band of [0, 1, 2] as const) {
      images[patternImageId(pattern, band)] = imageOf(pattern, band);
    }
  }
  return images;
}
