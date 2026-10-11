import type { ExpressionSpecification } from '@maplibre/maplibre-gl-style-spec';
import {
  LANDUSE_CLASSES,
  LANDUSE_FALLBACK_COLOR,
  LANDUSE_LEGACY_NAME_COLORS,
  URBAN_VILLAGE_CODE_NAMES
} from './landuse';
import { matchExpression, type MatchOutput } from './match-expression';
import { paletteColor } from './palette';

// 按属性配色的规则（ADR 0041 第 2 节）与分类样式的取值（ADR 0044 第 2～4 节）：每条规则有一组取值，各自有键、名称和默认主色；
// 地图上按规则的匹配结构把各取值的输出组合成一个表达式。地图样式里的颜色是数据，不走 CSS 令牌

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

/** 按取值配色的对照 */
export function valueColors(rule: ValueColorRule | OrderedColorRule): readonly (readonly [string, string])[] {
  return rule.kind === 'values' ? rule.colors : rule.values.map((value, index) => [value, paletteColor(index)]);
}

/** 兜底的键：按取值配色的"其他"、地类的"未匹配的地类" */
export const OTHER_ITEM = '$other';

/** 历史地类的键：历史地类按名称匹配，没有编码 */
export function legacyItem(name: string): string {
  return `legacy:${name}`;
}

/** 分类样式的一个取值 */
export interface ClassItem {
  /** 覆盖的键（ADR 0044 第 3 节）：按取值配色是取值本身，地类是编码，历史地类是 legacy:名称，兜底是 $other */
  readonly key: string;
  readonly label: string;
  /** 默认主色 */
  readonly color: string;
}

const LANDUSE_CODE_ITEMS: readonly ClassItem[] = LANDUSE_CLASSES.map(({ code, name, color }) => ({
  key: code,
  label: name,
  color
}));

const LANDUSE_LEGACY_ITEMS: readonly ClassItem[] = Object.entries(LANDUSE_LEGACY_NAME_COLORS).map(([name, color]) => ({
  key: legacyItem(name),
  label: name,
  color
}));

const LANDUSE_OTHER: ClassItem = { key: OTHER_ITEM, label: '未匹配的地类', color: LANDUSE_FALLBACK_COLOR };

const LANDUSE_ITEMS: readonly ClassItem[] = [...LANDUSE_CODE_ITEMS, ...LANDUSE_LEGACY_ITEMS, LANDUSE_OTHER];

// 瓦片里没有名称时（城镇村瓦片只有编码，5C.1b 实测）把编码换成名称
const NAME_FROM_CODE = matchExpression(
  ['get', 'dlbm'],
  [...LANDUSE_CLASSES.map(({ code, name }) => [code, name] as const), ...Object.entries(URBAN_VILLAGE_CODE_NAMES)],
  ''
);

function otherItem(rule: ValueColorRule | OrderedColorRule): ClassItem {
  return { key: OTHER_ITEM, label: '其他', color: rule.fallback };
}

function valueItems(rule: ValueColorRule | OrderedColorRule): ClassItem[] {
  return valueColors(rule).map(([value, color]) => ({ key: value, label: value, color }));
}

/** 规则的全部取值，最后一项是兜底；地类是 69 个地类、6 个历史地类和"未匹配的地类" */
export function classItems(rule: ColorRule): readonly ClassItem[] {
  if (rule.kind === 'landuse-code' || rule.kind === 'landuse-name') {
    return LANDUSE_ITEMS;
  }
  return [...valueItems(rule), otherItem(rule)];
}

/** 分类样式的取值和匹配结构：combine 按配色规则把各取值的输出组合成表达式 */
export interface SymbolClasses {
  readonly items: readonly ClassItem[];
  readonly combine: <T extends MatchOutput>(
    output: (item: ClassItem) => T | ExpressionSpecification
  ) => T | ExpressionSpecification;
}

/**
 * 按规则的匹配结构把各取值的输出组合成表达式：按取值配色匹配属性；地类图斑先按编码（`dlbm`），没命中再按名称（`dlmc`）
 * 查历史地类；城镇村按名称（没有名称时由编码换成名称）匹配编码表和历史地类
 */
export function classExpression<T extends MatchOutput>(
  rule: ColorRule,
  output: (item: ClassItem) => T | ExpressionSpecification
): T | ExpressionSpecification {
  const byLabel = (item: ClassItem) => [item.label, output(item)] as const;
  if (rule.kind === 'landuse-code') {
    const byLegacyName = matchExpression(['get', 'dlmc'], LANDUSE_LEGACY_ITEMS.map(byLabel), output(LANDUSE_OTHER));
    return matchExpression(
      ['get', 'dlbm'],
      LANDUSE_CODE_ITEMS.map(item => [item.key, output(item)] as const),
      byLegacyName
    );
  }
  if (rule.kind === 'landuse-name') {
    return matchExpression(
      ['coalesce', ['get', 'dlmc'], NAME_FROM_CODE],
      [...LANDUSE_CODE_ITEMS, ...LANDUSE_LEGACY_ITEMS].map(byLabel),
      output(LANDUSE_OTHER)
    );
  }
  return matchExpression(
    ['get', rule.property],
    valueItems(rule).map(item => [item.key, output(item)] as const),
    output(otherItem(rule))
  );
}

/** 规则的取值和匹配结构，交给 classifiedPaint */
export function symbolClasses(rule: ColorRule): SymbolClasses {
  return { items: classItems(rule), combine: output => classExpression(rule, output) };
}
