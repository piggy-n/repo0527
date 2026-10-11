import {
  type CircleLayerSpecification,
  Color,
  type ExpressionSpecification,
  type FillLayerSpecification,
  type LineLayerSpecification
} from '@maplibre/maplibre-gl-style-spec';
import type { ResourceGeometry } from './catalog';
import type { ClassItem, SymbolClasses } from './classification';
import type { MatchOutput } from './match-expression';

// 符号模型（ADR 0044 第 1 节）：点、线、面各自能调整的字段，以及符号到 paint 的转换；数值沿用旧项目的 layerSymbolModel.js

/** 大小的四档，作用于整条随缩放插值的曲线 */
export const SIZE_LEVELS = ['S', 'M', 'L', 'XL'] as const;
export type SizeLevel = (typeof SIZE_LEVELS)[number];

const SIZE_FACTORS: Readonly<Record<SizeLevel, number>> = { S: 0.6, M: 1, L: 1.6, XL: 2.4 };

/** 四档之一，或参考级别下的自定义像素 */
export type SymbolSize = SizeLevel | number;

export interface SizeReference {
  /** 自定义像素以这一级为准 */
  readonly zoom: number;
  /** M 档在这一级的像素 */
  readonly basePx: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

/** 点的半径看市级视角（12 级），线宽看区县视角（14 级） */
export const SIZE_REFERENCES: Readonly<Record<'circle' | 'line', SizeReference>> = {
  circle: { zoom: 12, basePx: 4, min: 1, max: 20, step: 0.5 },
  line: { zoom: 14, basePx: 1.8, min: 0.5, max: 12, step: 0.1 }
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

/** 面的描边宽度、线型和纹理在 5C.5c 加入 */
export interface FillFields {
  readonly fillColor: string;
  readonly outlineColor: string;
}

export type ResourceSymbol =
  | ({ readonly geometry: 'circle' } & PointFields)
  | ({ readonly geometry: 'line' } & LineFields)
  | ({ readonly geometry: 'fill' } & FillFields);

/** 符号的覆盖：只记和默认不同的字段（ADR 0044 第 3 节）；不属于资源几何的字段不参与推导 */
export type SymbolOverride = Partial<PointFields & LineFields & FillFields>;

export type SymbolField = keyof SymbolOverride;

/** 各几何能调整的字段 */
export const SYMBOL_FIELDS: Readonly<Record<ResourceGeometry, readonly SymbolField[]>> = {
  circle: ['size', 'fillColor', 'strokeColor', 'strokeWidth'],
  line: ['color', 'width', 'dash'],
  fill: ['fillColor', 'outlineColor']
};

/** 颜色字段：比较差异、保存都用规范化后的值，拖动取色时可以预览 */
export const COLOR_FIELDS = ['fillColor', 'strokeColor', 'color', 'outlineColor'] as const satisfies readonly SymbolField[];
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

/** 自定义大小按步长取整；越界、不是有限数时为 null */
export function normalizeSize(geometry: 'circle' | 'line', size: SymbolSize): SymbolSize | null {
  if (typeof size === 'string') {
    return size;
  }
  const { min, max, step } = SIZE_REFERENCES[geometry];
  if (!Number.isFinite(size)) {
    return null;
  }
  const rounded = Number((Math.round(size / step) * step).toFixed(1));
  return rounded >= min && rounded <= max ? rounded : null;
}

/** 输入框里的自定义大小：按步长取整；空、不是数、越界时为 null */
export function parseSize(geometry: 'circle' | 'line', text: string): number | null {
  // Number 会去掉首尾空格；空字符串是 0，小于下限
  const size = normalizeSize(geometry, Number(text));
  return typeof size === 'number' ? size : null;
}

/** 某档在参考级别下的像素，给自定义输入做初始值 */
export function sizePixels(geometry: 'circle' | 'line', size: SymbolSize): number {
  const { basePx } = SIZE_REFERENCES[geometry];
  return typeof size === 'number' ? size : Number((basePx * SIZE_FACTORS[size]).toFixed(2));
}

/** 按大小缩放 M 档曲线的像素，缩放断点不动 */
export function sizeStops(geometry: 'circle' | 'line', size: SymbolSize): SizeStops {
  const factor = typeof size === 'number' ? size / SIZE_REFERENCES[geometry].basePx : SIZE_FACTORS[size];
  return BASE_STOPS[geometry].map(([zoom, pixels]) => [zoom, Number((pixels * factor).toFixed(3))]);
}

// 断点的输出可以是数，也可以是按取值的 match（分类样式）
function interpolateZoom(stops: readonly (readonly [number, number | ExpressionSpecification])[]): ExpressionSpecification {
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
    outlineColor: override.outlineColor ?? defaults.outlineColor
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

/** 资源图层的类型和样式，不含透明度：透明度是显示状态，推导时再乘上 */
export type ResourceLayerStyle =
  | { readonly type: 'fill'; readonly paint: NonNullable<FillLayerSpecification['paint']> }
  | {
      readonly type: 'line';
      readonly layout: NonNullable<LineLayerSpecification['layout']>;
      readonly paint: NonNullable<LineLayerSpecification['paint']>;
    }
  | { readonly type: 'circle'; readonly paint: NonNullable<CircleLayerSpecification['paint']> };

export const LINE_LAYOUT: NonNullable<LineLayerSpecification['layout']> = { 'line-join': 'round', 'line-cap': 'round' };

/** 统一符号的 paint：面是填充加 1 像素描边，线带线型，点带描边 */
export function symbolPaint(symbol: ResourceSymbol): ResourceLayerStyle {
  if (symbol.geometry === 'fill') {
    return { type: 'fill', paint: { 'fill-color': symbol.fillColor, 'fill-outline-color': symbol.outlineColor } };
  }
  if (symbol.geometry === 'line') {
    const { dasharray } = LINE_DASHES[symbol.dash];
    return {
      type: 'line',
      layout: LINE_LAYOUT,
      paint: {
        'line-color': symbol.color,
        'line-width': sizeCurve('line', symbol.width),
        ...(dasharray ? { 'line-dasharray': [...dasharray] } : {})
      }
    };
  }
  return {
    type: 'circle',
    paint: {
      'circle-color': symbol.fillColor,
      'circle-radius': sizeCurve('circle', symbol.size),
      'circle-stroke-color': symbol.strokeColor,
      'circle-stroke-width': symbol.strokeWidth
    }
  };
}

// 实线在分类的 match 里也要有值：间隔为 0 的虚线（同旧项目）
const SOLID_DASHARRAY = [1, 0];

function hasGeometry<G extends ResourceGeometry>(
  symbol: ResourceSymbol,
  geometry: G
): symbol is Extract<ResourceSymbol, { geometry: G }> {
  return symbol.geometry === geometry;
}

const same = (values: readonly unknown[]) => values.every(value => JSON.stringify(value) === JSON.stringify(values[0]));

/**
 * 分类样式的 paint（ADR 0044 第 4 节）：每个取值一个符号，按属性组合成 match；所有取值相同的属性直接用这个值。
 * 随缩放的大小保留外层的缩放插值，在各断点的输出里做 match；线型在 match 里用 literal 包起来；
 * 面的描边和填充同色时不设描边（MapLibre 默认用填充色描边）
 */
export function classifiedPaint(classes: SymbolClasses, symbolOf: (item: ClassItem) => ResourceSymbol): ResourceLayerStyle {
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
  const symbolAt = <G extends ResourceGeometry>(geometry: G) => (item: ClassItem) => {
    const symbol = symbols.get(item.key);
    if (!symbol || !hasGeometry(symbol, geometry)) {
      throw new Error(`取值 ${item.key} 的符号不是 ${geometry}`);
    }
    return symbol;
  };

  if (firstSymbol.geometry === 'fill') {
    const fill = symbolAt('fill');
    const outlined = items.some(item => normalizeColor(fill(item).outlineColor) !== normalizeColor(fill(item).fillColor));
    const paint = {
      'fill-color': value(item => fill(item).fillColor),
      ...(outlined ? { 'fill-outline-color': value(item => fill(item).outlineColor) } : {})
    };
    return { type: 'fill', paint };
  }
  if (firstSymbol.geometry === 'line') {
    const line = symbolAt('line');
    const dashes = items.map(item => LINE_DASHES[line(item).dash].dasharray);
    const dashed = dashes.some(dash => dash !== null);
    const dasharray = (item: ClassItem): ExpressionSpecification => [
      'literal',
      [...(LINE_DASHES[line(item).dash].dasharray ?? SOLID_DASHARRAY)]
    ];
    const paint = {
      'line-color': value(item => line(item).color),
      'line-width': curve(item => sizeStops('line', line(item).width)),
      ...(dashed ? { 'line-dasharray': same(dashes) ? [...(dashes[0] ?? [])] : combine(dasharray) } : {})
    };
    return { type: 'line', layout: LINE_LAYOUT, paint };
  }
  const circle = symbolAt('circle');
  return {
    type: 'circle',
    paint: {
      'circle-color': value(item => circle(item).fillColor),
      'circle-radius': curve(item => sizeStops('circle', circle(item).size)),
      'circle-stroke-color': value(item => circle(item).strokeColor),
      'circle-stroke-width': value(item => circle(item).strokeWidth)
    }
  };
}
