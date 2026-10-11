import {
  type CircleLayerSpecification,
  Color,
  type ExpressionSpecification,
  type FillLayerSpecification,
  type LineLayerSpecification
} from '@maplibre/maplibre-gl-style-spec';
import type { Resource } from './catalog';
import { LANDUSE_COLOR_BY_CODE, LANDUSE_COLOR_BY_NAME, LANDUSE_FALLBACK_COLOR } from './landuse';
import { matchExpression } from './match-expression';

// 样式登记表（ADR 0041 第 2 节）：接口只给 code、名称、几何类型和年份，渲染细节按 code 登记在这里；
// 只登记和默认值不同的部分。地图样式里的颜色是数据，不走 CSS 令牌

/**
 * 默认配色板，按资源在目录里的顺序循环取（迁移自旧项目的 LAYER_COLOR_PALETTE）：
 * 浅色底图上都压得住，环形相邻的色相至少差 109°，相邻资源不会撞色
 */
export const RESOURCE_PALETTE: readonly string[] = [
  '#D9433F',
  '#16B3B3',
  '#C74F9B',
  '#77A82E',
  '#B03A6B',
  '#2278BE',
  '#C79212',
  '#7A4FC0',
  '#E07B39',
  '#2FA663'
];

export function paletteColor(index: number): string {
  return RESOURCE_PALETTE[index % RESOURCE_PALETTE.length] ?? '';
}

/** 按取值对照颜色 */
export interface ValueColorRule {
  readonly kind: 'values';
  readonly property: string;
  readonly colors: readonly (readonly [value: string, color: string])[];
  readonly fallback: string;
}

/** 按取值的顺序从配色板取色：每次一样，图例能列出实际颜色 */
export interface OrderedColorRule {
  readonly kind: 'ordered';
  readonly property: string;
  readonly values: readonly string[];
  readonly fallback: string;
}

/** 按属性配色；地类的两种按 landuse.ts 的编码表和历史名称表 */
export type ColorRule =
  | ValueColorRule
  | OrderedColorRule
  | { readonly kind: 'landuse-code' }
  | { readonly kind: 'landuse-name' };

/** 按取值配色的对照，图例（5C.4）列出同样的颜色 */
export function valueColors(rule: ValueColorRule | OrderedColorRule): readonly (readonly [string, string])[] {
  return rule.kind === 'values' ? rule.colors : rule.values.map((value, index) => [value, paletteColor(index)]);
}

export function colorExpression(rule: ColorRule): string | ExpressionSpecification {
  if (rule.kind === 'landuse-code') {
    return LANDUSE_COLOR_BY_CODE;
  }
  if (rule.kind === 'landuse-name') {
    return LANDUSE_COLOR_BY_NAME;
  }
  return matchExpression(['get', rule.property], valueColors(rule), rule.fallback);
}

export interface ResourceStyle {
  /** 最小显示级别：数据源和图层共用，更低的级别不请求瓦片（ADR 0041 第 3 节） */
  readonly minzoom?: number;
  readonly color?: ColorRule;
  /** 用这个属性作要素 ID，跨瓦片稳定，点选高亮用 */
  readonly promoteId?: string;
  readonly checked?: boolean;
}

// 最小显示级别：取南京、苏州两处单张瓦片小于约 2 MB、首次生成少于约 2 s 的最低级别（5C.1b、5C.1d 实测，docs/migration.md）
const RESOURCE_STYLES = new Map<string, ResourceStyle>([
  ['bgdc_dltb', { color: { kind: 'landuse-code' }, promoteId: 'bsm', checked: true }],
  ['bgdc_dltb_czc', { color: { kind: 'landuse-name' } }],
  [
    'bgdc_czcdyd',
    {
      color: {
        kind: 'ordered',
        property: 'czclx',
        values: ['201', '201A', '202', '202A', '203', '203A', '204', '205'],
        fallback: LANDUSE_FALLBACK_COLOR
      }
    }
  ],
  [
    'csxhjctb_hydl',
    {
      color: {
        kind: 'values',
        property: 'ccn',
        colors: [
          ['河流', '#1E88E5'],
          ['水渠', '#4FC3F7']
        ],
        fallback: '#2F80ED'
      }
    }
  ],
  [
    'csxhjctb_lvll',
    {
      color: {
        kind: 'values',
        property: 'type',
        colors: [
          ['农村硬化道路', '#E67E22'],
          ['机耕路', '#C49A6C'],
          ['乡村路', '#8D6E63']
        ],
        fallback: '#A1887F'
      }
    }
  ],
  ['csxhjctb_hyda', { minzoom: 10 }],
  ['csxhjctb_lrdl', { minzoom: 9 }],
  ['csxhjctb_lctl', { minzoom: 9 }],
  ['bgdc_yjjbnttb', { minzoom: 9 }],
  ['bgdc_lmfw', { minzoom: 9 }],
  ['bgdc_cjdcq', { minzoom: 9 }],
  ['bgdc_cjdcqjx', { minzoom: 8 }],
  ['bgdc_ttq', { minzoom: 8 }],
  ['bgdc_xzq', { minzoom: 8 }]
]);

const NO_STYLE: ResourceStyle = {};

export function resourceStyle(code: string): ResourceStyle {
  return RESOURCE_STYLES.get(code) ?? NO_STYLE;
}

/** 新出现的资源的透明度（同旧项目） */
export const DEFAULT_OPACITY = 0.9;

/** 数据源的最大级别：更高的级别由 MapLibre 放大，不再向后端请求 */
export const SOURCE_MAXZOOM = 15;

/** 瓦片集名，也是瓦片地址的一段 */
export function tilesetOf(code: string, year: number): string {
  return `${code}_${year}`;
}

// 瓦片里的图层名默认等于瓦片集名，这两个例外（5C.1b 实测）
const SOURCE_LAYER_EXCEPTIONS = new Map([
  ['bgdc_czcdyd_2022', 'czcdyd'],
  ['bgdc_dltb_czc_2021', 'dltb_czc_2021']
]);

export function sourceLayerOf(code: string, year: number): string {
  const tileset = tilesetOf(code, year);
  return SOURCE_LAYER_EXCEPTIONS.get(tileset) ?? tileset;
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

// 默认样式的数值沿用旧项目的默认符号（layerSymbolModel.js 的 M 档）
const FILL_ALPHA = 0.35;
const LINE_WIDTH: ExpressionSpecification = ['interpolate', ['linear'], ['zoom'], 6, 0.6, 10, 1, 14, 1.8, 17, 3];
const CIRCLE_RADIUS: ExpressionSpecification = ['interpolate', ['linear'], ['zoom'], 6, 2, 12, 4, 16, 6];

function withAlpha(color: string, alpha: number): string {
  const parsed = Color.parse(color) ?? Color.black;
  return new Color(parsed.r, parsed.g, parsed.b, alpha, false).toString();
}

/** 默认样式按几何类型：面是半透明填充加同色描边（按属性配色的面用实色），线是实色，点是实色加白描边 */
export function resourceLayerStyle(resource: Resource): ResourceLayerStyle {
  const rule = resourceStyle(resource.code).color;
  const color = paletteColor(resource.index);
  const mainColor = rule ? colorExpression(rule) : color;
  if (resource.geometry === 'fill' && rule) {
    return { type: 'fill', paint: { 'fill-color': mainColor } };
  }
  if (resource.geometry === 'fill') {
    return { type: 'fill', paint: { 'fill-color': withAlpha(color, FILL_ALPHA), 'fill-outline-color': color } };
  }
  if (resource.geometry === 'line') {
    return {
      type: 'line',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': mainColor, 'line-width': LINE_WIDTH }
    };
  }
  return {
    type: 'circle',
    paint: {
      'circle-color': mainColor,
      'circle-radius': CIRCLE_RADIUS,
      'circle-stroke-color': '#FFFFFF',
      'circle-stroke-width': 1
    }
  };
}
