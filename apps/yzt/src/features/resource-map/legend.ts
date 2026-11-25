import { Color } from '@maplibre/maplibre-gl-style-spec';
import type { Resource, ResourceGeometry } from './catalog';
import { type ClassItem, classItems, legacyItem, OTHER_ITEM } from './classification';
import { type FeatureFilter, NO_FILTER } from './feature-filter';
import { CLASS_FIELD } from './filter-fields';
import { LANDUSE_GROUPS, LANDUSE_LEGACY_NAME_COLORS, LANDUSE_MEANINGS, type LanduseClass } from './landuse';
import { isDrawn, type ResourceLayersState } from './resource-layers';
import {
  noSymbolOverride,
  type ResourceSymbolOverride,
  type SymbolMode,
  type SymbolOverrideOf
} from './resource-symbols';
import { classSymbol, type ResourceStyle, resourceStyle, symbolModeOf, uniformSymbol } from './style-registry';
import type { FillPattern } from './fill-patterns';
import type { PointShape } from './point-shapes';
import { isFillPattern, LINE_DASHES, type LineDash, type ResourceSymbol, sizePixels } from './symbols';

// 图例的推导（ADR 0043）：输入是显示状态、样式登记表和符号覆盖，不读地图；
// 预览取自分组推导用的同一份符号（uniformSymbol、classSymbol，ADR 0044 第 4 节）

/**
 * 一个符号的预览：面是填充加描边（有花纹时叠上花纹），线是一段线，点是带描边的形状。
 * 宽度和半径是参考级别下的实际像素，画的时候按预览框的高度限制（LegendSwatchIcon，ADR 0159）；
 * 线型以线宽为单位，同 MapLibre 的 line-dasharray
 */
export type LegendSwatch =
  | {
      readonly geometry: 'fill';
      readonly fill: string;
      readonly outline: string;
      /** 0 是没有描边 */
      readonly outlineWidth: number;
      readonly outlineDash: readonly number[] | null;
      readonly pattern?: { readonly name: FillPattern; readonly color: string };
    }
  | {
      readonly geometry: 'line';
      readonly color: string;
      readonly width: number;
      readonly dash: readonly number[] | null;
    }
  | {
      readonly geometry: 'circle';
      readonly shape: PointShape;
      readonly fill: string;
      readonly stroke: string;
      /** 不含描边的半径；描边画在它外面，同 MapLibre 的 circle-stroke-width */
      readonly radius: number;
      readonly strokeWidth: number;
    };


// 无填充的面：预览里填充透明
const TRANSPARENT = 'rgba(0, 0, 0, 0)';

/** 按属性配色的摘要最多画几个代表取值（ADR 0159）：面拼成 2 × 2 的色块，线是三段折线，点排成三角 */
export const SUMMARY_LIMITS: Readonly<Record<ResourceGeometry, number>> = { fill: 4, line: 3, circle: 3 };

// 兜底和历史地类不当代表
const isRepresentable = ({ key }: ClassItem) => key !== OTHER_ITEM && !key.startsWith(legacyItem(''));

/**
 * 摘要画的代表取值（ADR 0159）：登记了的按登记的先后，只留资源实际有的取值；没登记、或者登记的一个都没有时，
 * 取前几个取值。兜底、历史地类不算
 */
export function summaryItems(
  items: readonly ClassItem[],
  style: ResourceStyle,
  geometry: ResourceGeometry
): readonly ClassItem[] {
  const candidates = items.filter(isRepresentable);
  const registered = (style.summary ?? []).flatMap(key => candidates.filter(item => item.key === key));
  return (registered.length > 0 ? registered : candidates).slice(0, SUMMARY_LIMITS[geometry]);
}

/**
 * 按取值配色的一个取值；key 是分类样式里取值的键。excluded 是按分类过滤掉了（ADR 0173）：图例里照样列出、淡显，
 * 地图上不画（用户 2026-11-24，取代"只列勾着的类别"和名称下面写条件）
 */
export interface LegendValue {
  readonly key: string;
  readonly label: string;
  readonly swatch: LegendSwatch;
  readonly excluded: boolean;
}

/**
 * 图例的一条：统一符号；按取值配色；地类（按编码或按名称配色，内容是完整的地类图例）。
 * 按属性配色的条目带样式方式，swatch 是统一样式的预览；按分类过滤时列出全部类别、标出过滤掉的，摘要只用画的（ADR 0173）
 */
export type LegendEntry =
  | {
      readonly kind: 'symbol';
      readonly code: string;
      readonly name: string;
      readonly year: number;
      readonly swatch: LegendSwatch;
    }
  | {
      readonly kind: 'values';
      readonly code: string;
      readonly name: string;
      readonly year: number;
      readonly mode: SymbolMode;
      readonly swatch: LegendSwatch;
      /** 摘要：代表取值的预览，按几何画（ADR 0159） */
      readonly summary: readonly LegendSwatch[];
      readonly values: readonly LegendValue[];
    }
  | {
      readonly kind: 'landuse';
      readonly code: string;
      readonly name: string;
      readonly year: number;
      readonly mode: SymbolMode;
      readonly swatch: LegendSwatch;
      /** 摘要：代表取值的预览，按几何画（ADR 0159） */
      readonly summary: readonly LegendSwatch[];
      readonly match: 'code' | 'name';
      /** 各取值的预览，按取值的键 */
      readonly swatches: ReadonlyMap<string, LegendSwatch>;
      /** 按分类过滤掉的取值的键：照样列出、淡显 */
      readonly excluded: ReadonlySet<string>;
    };

const dashOf = (dash: LineDash): readonly number[] | null => LINE_DASHES[dash].dasharray;

/** 符号的预览：线宽、点的半径按参考级别（线 14 级、点 12 级）的像素，面的描边按它自己的像素；预览框放不下的由画的组件限制 */
export function swatchOf(symbol: ResourceSymbol): LegendSwatch {
  if (symbol.geometry === 'fill') {
    const fill = symbol.fillStyle === 'none' ? TRANSPARENT : symbol.fillColor;
    const { fillStyle, patternColor } = symbol;
    const pattern = isFillPattern(fillStyle) ? { pattern: { name: fillStyle, color: patternColor } } : {};
    return {
      geometry: 'fill',
      fill,
      outline: symbol.outlineColor,
      outlineWidth: sizePixels('outline', symbol.outlineWidth),
      outlineDash: dashOf(symbol.outlineDash),
      ...pattern
    };
  }
  if (symbol.geometry === 'line') {
    const width = sizePixels('line', symbol.width);
    return { geometry: 'line', color: symbol.color, width, dash: dashOf(symbol.dash) };
  }
  const { shape, fillColor: fill, strokeColor: stroke, strokeWidth } = symbol;
  return { geometry: 'circle', shape, fill, stroke, radius: sizePixels('circle', symbol.size), strokeWidth };
}

// 一个预览的填充有多不透明：只看面，花纹画在填充上面、不算
const fillAlpha = (swatch: LegendSwatch) => (swatch.geometry === 'fill' ? (Color.parse(swatch.fill)?.a ?? 0) : 0);

/** 按分类过滤到一类都不剩（ADR 0173、0175）：地图上这个资源什么也不画，统一配色时也一样 */
export function allClassesExcluded(entry: LegendEntry): boolean {
  if (entry.kind === 'symbol') {
    return false;
  }
  return entry.kind === 'values'
    ? entry.values.every(value => value.excluded)
    : entry.swatches.size > 0 && entry.excluded.size === entry.swatches.size;
}

/**
 * 面画在地图上的填充色里最大的不透明度（0～1，不含图层透明度）：统一符号看统一的填充，按属性配色看各个取值；线、点为 0。
 * 当前图层判断不透明的面会不会把模型盖住（ADR 0161）
 */
export function fillOpacityOf(entry: LegendEntry): number {
  if (allClassesExcluded(entry)) {
    return 0;
  }
  if (entry.kind === 'symbol' || entry.mode === 'uniform') {
    return fillAlpha(entry.swatch);
  }
  // 过滤掉的类别不画在地图上，不算（ADR 0173）
  const swatches =
    entry.kind === 'values'
      ? entry.values.filter(value => !value.excluded).map(value => value.swatch)
      : [...entry.swatches].filter(([key]) => !entry.excluded.has(key)).map(([, swatch]) => swatch);
  return Math.max(0, ...swatches.map(fillAlpha));
}

/**
 * 一个资源的图例条目，不管是否画在地图上（当前图层的行、浮层用）；年份只用来显示（ADR 0052 第 3 节），条目的身份、名称和符号仍按 code。
 * 按分类过滤时列出全部类别、标出过滤掉的（图例里淡显），摘要只用画在地图上的（ADR 0173）
 */
export function legendEntry(
  resource: Resource,
  year: number,
  override: ResourceSymbolOverride | undefined,
  filter: FeatureFilter = NO_FILTER
): LegendEntry {
  const { code, name } = resource;
  const style = resourceStyle(code);
  const rule = style.color;
  const swatch = swatchOf(uniformSymbol(resource, override, style));
  if (!rule) {
    return { kind: 'symbol', code, name, year, swatch };
  }
  const mode = symbolModeOf(style, override);
  const kept = filter[CLASS_FIELD];
  const items = classItems(rule);
  const isKept = (item: ClassItem) => kept === undefined || kept.includes(item.key);
  const values = items.map(item => ({
    key: item.key,
    label: item.label,
    swatch: swatchOf(classSymbol(resource, item, override, style)),
    excluded: !isKept(item)
  }));
  const swatches = new Map(values.map(value => [value.key, value.swatch]));
  const summary = summaryItems(items.filter(isKept), style, resource.geometry).flatMap(
    item => swatches.get(item.key) ?? []
  );
  if (rule.kind === 'landuse-code' || rule.kind === 'landuse-name') {
    const match = rule.kind === 'landuse-code' ? 'code' : 'name';
    const excluded = new Set(values.filter(value => value.excluded).map(value => value.key));
    return { kind: 'landuse', code, name, year, mode, swatch, summary, match, swatches, excluded };
  }
  return { kind: 'values', code, name, year, mode, swatch, summary, values };
}

/** 图例的条目：勾选且配置合法的资源，按叠放顺序从上到下（ADR 0043 第 1 节） */
export function legendEntries(
  state: ResourceLayersState,
  invalid: ReadonlyMap<string, unknown>,
  overrideOf: SymbolOverrideOf = noSymbolOverride
): LegendEntry[] {
  return state.order.flatMap(code => {
    const resource = state.catalog?.resources.get(code);
    const display = state.displays.get(code);
    if (!resource || !display || !isDrawn(display) || invalid.has(code)) {
      return [];
    }
    return [legendEntry(resource, display.year, overrideOf(code), display.filter)];
  });
}

export interface LanduseLegendItem {
  /** 分类样式里取值的键，预览按它取 */
  readonly key: string;
  /** 历史地类和未匹配的地类没有编码 */
  readonly code: string | null;
  readonly name: string;
  readonly meaning: string;
  readonly adjustable: boolean;
}

// 搜索时分组名命中就留下整组：搜"历史地类"列出全部历史地类
interface LanduseLegendSection {
  readonly name: string;
  readonly items: readonly LanduseLegendItem[];
}

/** 地类的编码加名称，如"0101 水田"；历史地类和未匹配的地类没有编码，只写名称 */
export function landuseItemLabel({ code, name }: LanduseLegendItem): string {
  return code === null ? name : `${code} ${name}`;
}

function itemOf({ code, name, adjustable }: LanduseClass): LanduseLegendItem {
  return { key: code, code, name, meaning: LANDUSE_MEANINGS[code] ?? '', adjustable: adjustable === true };
}

// 表 A.2 之外：历史地类按名称配色（编码没命中时，或城镇村按名称），都没命中时是兜底色（ADR 0041 第 2 节）
const LEGACY_SECTION: LanduseLegendSection = {
  name: '历史地类',
  items: Object.keys(LANDUSE_LEGACY_NAME_COLORS).map(name => ({
    key: legacyItem(name),
    code: null,
    name,
    meaning: '表 A.2 之外的历史地类名称，编码没有对应的地类时按名称配色',
    adjustable: false
  }))
};

const UNMATCHED_SECTION: LanduseLegendSection = {
  name: '未匹配的地类',
  items: [
    {
      key: OTHER_ITEM,
      code: null,
      name: '未匹配的地类',
      meaning: '编码和名称都没有对应的地类',
      adjustable: false
    }
  ]
};

// 表 A.2 的 69 个地类平铺（ADR 0074 不再按现状分类、工作分类分组），后面是历史地类和未匹配的地类
const LANDUSE_SECTIONS: readonly LanduseLegendSection[] = [
  { name: '全部地类', items: LANDUSE_GROUPS.flatMap(group => group.classes.map(itemOf)) },
  LEGACY_SECTION,
  UNMATCHED_SECTION
];

/**
 * 地类图例的条目（ADR 0043 第 2 节、ADR 0074）：表 A.2 的地类、历史地类、未匹配的地类依次平铺
 * 有关键字时（不区分大小写，去掉首尾空格）留下编码或名称命中的地类；分组名命中时留下整组。
 * available 是资源实际有的取值（按键，ADR 0124），只列这些；不给时是全表
 */
export function landuseLegendItems(
  keyword = '',
  available?: ReadonlyMap<string, unknown>
): LanduseLegendItem[] {
  const needle = keyword.trim().toLowerCase();
  const matches = (text: string | null) => text !== null && text.toLowerCase().includes(needle);
  const items = LANDUSE_SECTIONS.flatMap(section => {
    if (needle === '' || matches(section.name)) {
      return section.items;
    }
    return section.items.filter(item => matches(item.code) || matches(item.name));
  });
  return available ? items.filter(item => available.has(item.key)) : items;
}
