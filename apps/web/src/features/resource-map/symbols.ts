import {
  type CircleLayerSpecification,
  Color,
  type ExpressionSpecification,
  type FillLayerSpecification,
  type LineLayerSpecification
} from '@maplibre/maplibre-gl-style-spec';
import type { ResourceGeometry } from './catalog';

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

/** M 档的曲线 */
const BASE_CURVES: Readonly<Record<'circle' | 'line', ExpressionSpecification>> = {
  circle: ['interpolate', ['linear'], ['zoom'], 6, 2, 12, 4, 16, 6],
  line: ['interpolate', ['linear'], ['zoom'], 6, 0.6, 10, 1, 14, 1.8, 17, 3]
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

/** 按大小缩放 M 档曲线的输出值，缩放断点不动 */
export function sizeCurve(geometry: 'circle' | 'line', size: SymbolSize): ExpressionSpecification {
  const base = BASE_CURVES[geometry];
  const factor = typeof size === 'number' ? size / SIZE_REFERENCES[geometry].basePx : SIZE_FACTORS[size];
  if (factor === 1) {
    return base;
  }
  // ['interpolate', ['linear'], ['zoom'], 缩放, 输出, 缩放, 输出, ...]：从下标 4 起的偶数位是输出；map 丢了元组类型，结构不变
  return base.map((token, index) =>
    index >= 4 && index % 2 === 0 && typeof token === 'number' ? Number((token * factor).toFixed(3)) : token
  ) as ExpressionSpecification;
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
