import {
  type CircleLayerSpecification,
  Color,
  type ExpressionSpecification,
  type FillLayerSpecification,
  type LineLayerSpecification
} from '@maplibre/maplibre-gl-style-spec';
import type { StyleImages } from '@yzt/map-core';
import type { ResourceGeometry } from './catalog';
import type { ClassItem, SymbolClasses } from './classification';
import {
  BLANK_PATTERN_IMAGE_ID,
  FILL_PATTERNS,
  type FillPattern,
  PATTERN_ZOOM_STOPS,
  patternImageId,
  patternImages
} from './fill-patterns';
import type { MatchOutput } from './match-expression';

// 符号模型（ADR 0044 第 1 节、ADR 0045 第 1 节）：点、线、面各自能调整的字段，以及符号到图层的转换；
// 数值沿用旧项目的 layerSymbolModel.js

/** 大小的四档，作用于整条随缩放插值的曲线（面的描边不随缩放） */
export const SIZE_LEVELS = ['S', 'M', 'L', 'XL'] as const;
export type SizeLevel = (typeof SIZE_LEVELS)[number];

const SIZE_FACTORS: Readonly<Record<SizeLevel, number>> = { S: 0.6, M: 1, L: 1.6, XL: 2.4 };

/** 四档之一，或参考级别下的自定义像素 */
export type SymbolSize = SizeLevel | number;

/** 有大小的三种东西：点的半径、线宽、面的描边宽度 */
export type SizeKind = 'circle' | 'line' | 'outline';

export interface SizeReference {
  /** 自定义像素以这一级为准；面的描边不随缩放，没有参考级别 */
  readonly zoom?: number;
  /** M 档在参考级别的像素 */
  readonly basePx: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

/** 点的半径看市级视角（12 级），线宽看区县视角（14 级）；面的描边是固定像素，0 表示无描边 */
export const SIZE_REFERENCES: Readonly<Record<SizeKind, SizeReference>> = {
  circle: { zoom: 12, basePx: 4, min: 1, max: 20, step: 0.5 },
  line: { zoom: 14, basePx: 1.8, min: 0.5, max: 12, step: 0.1 },
  outline: { basePx: 1, min: 0, max: 8, step: 0.1 }
};

/** 随缩放插值的断点：缩放级别和像素 */
export type SizeStops = readonly (readonly [zoom: number, pixels: number])[];

/** M 档的曲线 */
const BASE_STOPS: Readonly<Record<'circle' | 'line', SizeStops>> = {
  circle: [
    [6, 2],
    [12, 4],
    [16, 6]
  ],
  line: [
    [6, 0.6],
    [10, 1],
    [14, 1.8],
    [17, 3]
  ]
};

/** 点的描边宽度（像素，不随缩放） */
export const POINT_STROKE_WIDTHS = [0, 1, 2, 3] as const;

/** 线型；实线不设 line-dasharray */
export const LINE_DASHES = {
  solid: { label: '实线', dasharray: null },
  dashed: { label: '虚线', dasharray: [3, 2] },
  dotted: { label: '点线', dasharray: [1, 2] },
  dashDot: { label: '点划线', dasharray: [4, 2, 1, 2] }
} as const satisfies Record<string, { readonly label: string; readonly dasharray: readonly number[] | null }>;

export type LineDash = keyof typeof LINE_DASHES;

export const LINE_DASH_NAMES = Object.keys(LINE_DASHES) as [LineDash, ...LineDash[]];

/** 面的填充方式：无填充只有描边，均匀填充只有填充色，花纹叠在填充色上（ADR 0045 第 1 节） */
export const FILL_STYLES = {
  none: '无填充',
  solid: '均匀填充',
  horizontal: '水平',
  vertical: '垂直',
  cross: '十字',
  diagonal: '斜线',
  backDiagonal: '反斜线',
  xCross: 'X 斜线',
  dense: '紧凑',
  dot: '点阵'
} as const satisfies Record<'none' | 'solid' | FillPattern, string>;

export type FillStyle = keyof typeof FILL_STYLES;

export const FILL_STYLE_NAMES = Object.keys(FILL_STYLES) as [FillStyle, ...FillStyle[]];

const fillPatterns: readonly string[] = FILL_PATTERNS;

/** 填充方式是不是一种花纹 */
export function isFillPattern(style: FillStyle): style is FillPattern {
  return fillPatterns.includes(style);
}

export interface PointFields {
  readonly size: SymbolSize;
  readonly fillColor: string;
  readonly strokeColor: string;
  readonly strokeWidth: number;
}

export interface LineFields {
  readonly color: string;
  readonly width: SymbolSize;
  readonly dash: LineDash;
}

export interface FillFields {
  readonly fillColor: string;
  readonly fillStyle: FillStyle;
  /** 花纹的颜色 */
  readonly patternColor: string;
  readonly outlineColor: string;
  readonly outlineWidth: SymbolSize;
  readonly outlineDash: LineDash;
}

export type ResourceSymbol =
  | ({ readonly geometry: 'circle' } & PointFields)
  | ({ readonly geometry: 'line' } & LineFields)
  | ({ readonly geometry: 'fill' } & FillFields);

type FillSymbol = Extract<ResourceSymbol, { geometry: 'fill' }>;

/** 符号的覆盖：只记和默认不同的字段（ADR 0044 第 3 节）；不属于资源几何的字段不参与推导 */
export type SymbolOverride = Partial<PointFields & LineFields & FillFields>;

export type SymbolField = keyof SymbolOverride;

/** 各几何能调整的字段 */
export const SYMBOL_FIELDS: Readonly<Record<ResourceGeometry, readonly SymbolField[]>> = {
  circle: ['size', 'fillColor', 'strokeColor', 'strokeWidth'],
  line: ['color', 'width', 'dash'],
  fill: ['fillColor', 'fillStyle', 'patternColor', 'outlineColor', 'outlineWidth', 'outlineDash']
};

/** 颜色字段：比较差异、保存都用规范化后的值，拖动取色时可以预览 */
export const COLOR_FIELDS = [
  'fillColor',
  'strokeColor',
  'color',
  'outlineColor',
  'patternColor'
] as const satisfies readonly SymbolField[];
export type ColorField = (typeof COLOR_FIELDS)[number];

const colorFields: readonly SymbolField[] = COLOR_FIELDS;

export function isColorField(field: SymbolField): field is ColorField {
  return colorFields.includes(field);
}

// 0～1 的颜色分量换成 0～255 的整数
const channel = (component: number) => Math.round(component * 255);

/** 颜色规范化成 rgba(r, g, b, a)：r、g、b 是 0～255 的整数，a 保留两位小数；解析不了时为 null */
export function normalizeColor(value: string): string | null {
  const parsed = Color.parse(value);
  if (!parsed) {
    return null;
  }
  const [r, g, b, a] = parsed.rgb;
  return `rgba(${channel(r)}, ${channel(g)}, ${channel(b)}, ${Math.round(a * 100) / 100})`;
}

/** 颜色改成给定的透明度 */
export function withAlpha(color: string, alpha: number): string {
  const [r, g, b] = (Color.parse(color) ?? Color.black).rgb;
  return new Color(r, g, b, alpha, false).toString();
}

/** 颜色在 Lab 空间往黑色插值 amount（0～1）：感知上均匀，各种色相加深的程度一致；透明度不变 */
export function darkenColor(color: string, amount: number): string {
  const parsed = Color.parse(color) ?? Color.black;
  // 插值连透明度一起插：终点用同透明度的黑色
  return Color.interpolate(parsed, new Color(0, 0, 0, parsed.a), amount, 'lab').toString();
}

/** 自定义大小按步长取整；越界、不是有限数时为 null */
export function normalizeSize(kind: SizeKind, size: SymbolSize): SymbolSize | null {
  if (typeof size === 'string') {
    return size;
  }
  const { min, max, step } = SIZE_REFERENCES[kind];
  if (!Number.isFinite(size)) {
    return null;
  }
  const rounded = Number((Math.round(size / step) * step).toFixed(1));
  return rounded >= min && rounded <= max ? rounded : null;
}

/** 输入框里的自定义大小：按步长取整；空、不是数、越界时为 null */
export function parseSize(kind: SizeKind, text: string): number | null {
  // 空字符串转成数是 0，面的描边会被当成"无描边"
  if (text.trim() === '') {
    return null;
  }
  // Number 会去掉首尾空格
  const size = normalizeSize(kind, Number(text));
  return typeof size === 'number' ? size : null;
}

/** 某档在参考级别下的像素，给自定义输入做初始值；面的描边就是它的宽度 */
export function sizePixels(kind: SizeKind, size: SymbolSize): number {
  const { basePx } = SIZE_REFERENCES[kind];
  return typeof size === 'number' ? size : Number((basePx * SIZE_FACTORS[size]).toFixed(2));
}

/** 按大小缩放 M 档曲线的像素，缩放断点不动 */
export function sizeStops(geometry: 'circle' | 'line', size: SymbolSize): SizeStops {
  const factor = typeof size === 'number' ? size / SIZE_REFERENCES[geometry].basePx : SIZE_FACTORS[size];
  return BASE_STOPS[geometry].map(([zoom, pixels]) => [zoom, Number((pixels * factor).toFixed(3))]);
}

// 断点的输出可以是数、颜色，也可以是按取值的 match（分类样式）
function interpolateZoom(
  stops: readonly (readonly [number, number | string | ExpressionSpecification])[]
): ExpressionSpecification {
  return ['interpolate', ['linear'], ['zoom'], ...stops.flat()];
}

/** 随缩放插值的大小 */
export function sizeCurve(geometry: 'circle' | 'line', size: SymbolSize): ExpressionSpecification {
  return interpolateZoom(sizeStops(geometry, size));
}

// 同一字段的两个值是否相同：颜色比较规范化后的值
function sameValue(field: SymbolField, a: unknown, b: unknown): boolean {
  if (isColorField(field) && typeof a === 'string' && typeof b === 'string') {
    return normalizeColor(a) === normalizeColor(b);
  }
  return a === b;
}

/** 符号某个颜色字段的值；这个几何没有该字段时为 undefined */
export function colorOf(symbol: ResourceSymbol, field: ColorField): string | undefined {
  const fields: Partial<Record<SymbolField, unknown>> = symbol;
  const value = fields[field];
  return typeof value === 'string' ? value : undefined;
}

/** 叠加后的符号：默认符号加上属于这个几何的覆盖字段 */
export function resolveSymbol(defaults: ResourceSymbol, override: SymbolOverride | undefined): ResourceSymbol {
  if (!override) {
    return defaults;
  }
  if (defaults.geometry === 'circle') {
    return {
      geometry: 'circle',
      size: override.size ?? defaults.size,
      fillColor: override.fillColor ?? defaults.fillColor,
      strokeColor: override.strokeColor ?? defaults.strokeColor,
      strokeWidth: override.strokeWidth ?? defaults.strokeWidth
    };
  }
  if (defaults.geometry === 'line') {
    return {
      geometry: 'line',
      color: override.color ?? defaults.color,
      width: override.width ?? defaults.width,
      dash: override.dash ?? defaults.dash
    };
  }
  return {
    geometry: 'fill',
    fillColor: override.fillColor ?? defaults.fillColor,
    fillStyle: override.fillStyle ?? defaults.fillStyle,
    patternColor: override.patternColor ?? defaults.patternColor,
    outlineColor: override.outlineColor ?? defaults.outlineColor,
    outlineWidth: override.outlineWidth ?? defaults.outlineWidth,
    outlineDash: override.outlineDash ?? defaults.outlineDash
  };
}

/** 新的覆盖：在原有覆盖上改动这些字段（值为 undefined 的不算改动），规范化后和默认相同的字段不记（ADR 0044 第 1、3 节） */
export function nextOverride(
  defaults: ResourceSymbol,
  override: SymbolOverride | undefined,
  patch: SymbolOverride
): SymbolOverride {
  const base: Partial<Record<SymbolField, unknown>> = defaults;
  const entries = SYMBOL_FIELDS[defaults.geometry].flatMap(field => {
    const value = patch[field] ?? override?.[field];
    if (value === undefined || sameValue(field, value, base[field])) {
      return [];
    }
    return [[field, isColorField(field) && typeof value === 'string' ? normalizeColor(value) : value]];
  });
  // 字段和值都来自 SymbolOverride 自己，只是经过了 entries 的往返
  return Object.fromEntries(entries) as SymbolOverride;
}

/** 资源一个图层的类型和样式，不含透明度：透明度是显示状态，推导时再乘上 */
export type ResourceLayerStyle =
  | { readonly type: 'fill'; readonly paint: NonNullable<FillLayerSpecification['paint']> }
  | {
      readonly type: 'line';
      readonly layout: NonNullable<LineLayerSpecification['layout']>;
      readonly paint: NonNullable<LineLayerSpecification['paint']>;
    }
  | { readonly type: 'circle'; readonly paint: NonNullable<CircleLayerSpecification['paint']> };

/** 资源的一个图层：主图层没有后缀，纹理图层、描边图层的 ID 加上后缀（ADR 0045 第 2 节） */
export type ResourceLayerPart = ResourceLayerStyle & { readonly suffix?: 'pattern' | 'outline' };

/** 资源的图层（从下到上）和它们用到的样式图片 */
export interface ResourceStyleLayers {
  readonly parts: readonly ResourceLayerPart[];
  readonly images: StyleImages;
}

export const LINE_LAYOUT: NonNullable<LineLayerSpecification['layout']> = { 'line-join': 'round', 'line-cap': 'round' };

const TRANSPARENT = 'rgba(0, 0, 0, 0)';

// 实线在分类的 match 里也要有值：间隔为 0 的虚线（同旧项目）
const SOLID_DASHARRAY = [1, 0];

/** 面的描边宽度（像素） */
export function outlinePixels(symbol: FillSymbol): number {
  return sizePixels('outline', symbol.outlineWidth);
}

/** 复杂描边：宽度不为 0，又不是 1 像素实线，要描边图层来画（ADR 0045 第 2 节） */
export function isComplexOutline(symbol: FillSymbol): boolean {
  const pixels = outlinePixels(symbol);
  return pixels !== 0 && (pixels !== 1 || symbol.outlineDash !== 'solid');
}

// 描边颜色随缩放的两个级别（同旧项目）
const OUTLINE_FADE_ZOOMS = [10, 14] as const;

const rgbOf = (color: Color) => color.rgb.slice(0, 3).map(channel).join(',');

// 描边颜色在两个级别的值：描边和填充的 RGB 不同时，10 级用填充色的 RGB 配描边的透明度，概览时小图斑看到的是主色；
// 无填充时没有主色可看
function outlineColorStops(symbol: FillSymbol): readonly [string, string] {
  const fill = Color.parse(symbol.fillColor);
  const outline = Color.parse(symbol.outlineColor);
  if (symbol.fillStyle === 'none' || !fill || !outline || rgbOf(fill) === rgbOf(outline)) {
    return [symbol.outlineColor, symbol.outlineColor];
  }
  return [withAlpha(symbol.fillColor, outline.a), symbol.outlineColor];
}

function hasGeometry<G extends ResourceGeometry>(
  symbol: ResourceSymbol,
  geometry: G
): symbol is Extract<ResourceSymbol, { geometry: G }> {
  return symbol.geometry === geometry;
}

const same = (values: readonly unknown[]) => values.every(value => JSON.stringify(value) === JSON.stringify(values[0]));

const NO_IMAGES: StyleImages = {};

/**
 * 资源的图层（ADR 0044 第 4 节、ADR 0045 第 2 节）：每个取值一个符号，按属性组合成 match，所有取值相同的属性直接用这个值；
 * 随缩放的大小、描边颜色保留外层的缩放插值，在各断点的输出里做 match；线型在 match 里用 literal 包起来。
 * 面按需拆成主图层、纹理图层（有取值用了花纹）、描边图层（有取值是复杂描边）
 */
export function classifiedLayers(
  classes: SymbolClasses,
  symbolOf: (item: ClassItem) => ResourceSymbol
): ResourceStyleLayers {
  const { items, combine } = classes;
  // 按键找符号：combine 交回来的取值不一定是同一个对象
  const symbols = new Map(items.map(item => [item.key, symbolOf(item)]));
  const [first] = items;
  const firstSymbol = first && symbols.get(first.key);
  if (!firstSymbol) {
    throw new Error('分类样式至少要有一个取值');
  }
  // 一个属性：各取值相同时直接用这个值，否则按匹配结构组合
  const value = <T extends MatchOutput>(output: (item: ClassItem) => T): T | ExpressionSpecification => {
    const values = items.map(output);
    return same(values) ? values[0] : combine(output);
  };
  // 随缩放的大小：各取值的断点相同（sizeStops 只缩放像素），外层是缩放插值，逐个断点组合像素
  const curve = (stopsOf: (item: ClassItem) => SizeStops): ExpressionSpecification =>
    interpolateZoom(stopsOf(first).map(([zoom], index) => [zoom, value(item => stopsOf(item)[index][1])]));
  // 线型：都是实线时不设，都相同时直接用数组，有的不同时按取值匹配
  const dashPaint = (dashOf: (item: ClassItem) => LineDash) => {
    const dashes = items.map(item => LINE_DASHES[dashOf(item)].dasharray);
    if (dashes.every(dash => dash === null)) {
      return {};
    }
    const literal = (item: ClassItem): ExpressionSpecification => [
      'literal',
      [...(LINE_DASHES[dashOf(item)].dasharray ?? SOLID_DASHARRAY)]
    ];
    return { 'line-dasharray': same(dashes) ? [...(dashes[0] ?? [])] : combine(literal) };
  };
  const symbolAt =
    <G extends ResourceGeometry>(geometry: G) =>
    (item: ClassItem) => {
      const symbol = symbols.get(item.key);
      if (!symbol || !hasGeometry(symbol, geometry)) {
        throw new Error(`取值 ${item.key} 的符号不是 ${geometry}`);
      }
      return symbol;
    };

  if (firstSymbol.geometry === 'fill') {
    return fillLayers(items, symbolAt('fill'), value, dashPaint);
  }
  if (firstSymbol.geometry === 'line') {
    const line = symbolAt('line');
    const paint = {
      'line-color': value(item => line(item).color),
      'line-width': curve(item => sizeStops('line', line(item).width)),
      ...dashPaint(item => line(item).dash)
    };
    return { parts: [{ type: 'line', layout: LINE_LAYOUT, paint }], images: NO_IMAGES };
  }
  const circle = symbolAt('circle');
  const paint = {
    'circle-color': value(item => circle(item).fillColor),
    'circle-radius': curve(item => sizeStops('circle', circle(item).size)),
    'circle-stroke-color': value(item => circle(item).strokeColor),
    'circle-stroke-width': value(item => circle(item).strokeWidth)
  };
  return { parts: [{ type: 'circle', paint }], images: NO_IMAGES };
}

type ValueOf = <T extends MatchOutput>(output: (item: ClassItem) => T) => T | ExpressionSpecification;

type DashPaint = (dashOf: (item: ClassItem) => LineDash) => {
  readonly 'line-dasharray'?: number[] | ExpressionSpecification;
};

// 面的三个图层（ADR 0045 第 2 节）
function fillLayers(
  items: readonly ClassItem[],
  fill: (item: ClassItem) => FillSymbol,
  value: ValueOf,
  dashPaint: DashPaint
): ResourceStyleLayers {
  const fillColorOf = (item: ClassItem) => (fill(item).fillStyle === 'none' ? TRANSPARENT : fill(item).fillColor);
  const complex = items.some(item => isComplexOutline(fill(item)));
  // 描边颜色：每个取值两个级别的值都相同时是一个值，否则外层按缩放插值
  const outlineColor = (stopsOf: (item: ClassItem) => readonly [string, string]) => {
    if (items.every(item => stopsOf(item)[0] === stopsOf(item)[1])) {
      return value(item => stopsOf(item)[1]);
    }
    return interpolateZoom(OUTLINE_FADE_ZOOMS.map((zoom, index) => [zoom, value(item => stopsOf(item)[index])]));
  };
  // 主图层的描边：有描边图层时都交给它；0 像素透明，1 像素实线用描边色
  const mainOutline = (item: ClassItem): readonly [string, string] =>
    complex || outlinePixels(fill(item)) === 0 ? [TRANSPARENT, TRANSPARENT] : outlineColorStops(fill(item));
  // MapLibre 不设 fill-outline-color 时用填充色描边：都是和填充同色的 1 像素实线时省掉（和原来一样）
  const sameAsFill = (item: ClassItem) =>
    outlinePixels(fill(item)) === 1 && normalizeColor(fill(item).outlineColor) === normalizeColor(fillColorOf(item));
  const outlineIsFill = !complex && items.every(sameAsFill);
  const parts: ResourceLayerPart[] = [
    {
      type: 'fill',
      paint: {
        'fill-color': value(fillColorOf),
        ...(outlineIsFill ? {} : { 'fill-outline-color': outlineColor(mainOutline) })
      }
    }
  ];

  const patternOf = (item: ClassItem): FillPattern | null => {
    const style = fill(item).fillStyle;
    return isFillPattern(style) ? style : null;
  };
  const used = new Set(items.flatMap(item => patternOf(item) ?? []));
  let images = NO_IMAGES;
  if (used.size > 0) {
    // 没有花纹的取值用透明图片：同一图层不能混用 SDF 和普通图片
    const imageAt = (band: 0 | 1 | 2) => (item: ClassItem) => {
      const pattern = patternOf(item);
      return pattern ? patternImageId(pattern, band) : BLANK_PATTERN_IMAGE_ID;
    };
    const [medium, high] = PATTERN_ZOOM_STOPS;
    parts.push({
      suffix: 'pattern',
      type: 'fill',
      paint: {
        'fill-pattern': ['step', ['zoom'], value(imageAt(0)), medium, value(imageAt(1)), high, value(imageAt(2))],
        'fill-color': value(item => (patternOf(item) ? fill(item).patternColor : TRANSPARENT)),
        // 纹理图层不画边线：默认的边线会盖住主图层的 1 像素描边（ADR 0045 审阅时实测）
        'fill-antialias': false
      }
    });
    images = patternImages(used, items.some(item => !patternOf(item)));
  }

  if (complex) {
    // 线宽是固定像素，内收半个线宽，描边只画在图斑里面（MVT 的外环顺时针，正偏移朝内）
    parts.push({
      suffix: 'outline',
      type: 'line',
      layout: {},
      paint: {
        'line-color': outlineColor(item => outlineColorStops(fill(item))),
        'line-width': value(item => outlinePixels(fill(item))),
        'line-offset': value(item => outlinePixels(fill(item)) / 2),
        ...dashPaint(item => fill(item).outlineDash)
      }
    });
  }
  return { parts, images };
}

// 统一样式只有一个符号，所有属性都直接用它的值
const UNIFORM: SymbolClasses = {
  items: [{ key: '$uniform', label: '', color: '' }],
  combine: () => {
    throw new Error('统一样式只有一个符号，不按取值组合');
  }
};

/** 统一样式的图层：同分类样式的规则，只有一个取值 */
export function symbolLayers(symbol: ResourceSymbol): ResourceStyleLayers {
  return classifiedLayers(UNIFORM, () => symbol);
}
