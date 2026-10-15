import type { Resource } from './catalog';
import { classItems, legacyItem, OTHER_ITEM } from './classification';
import {
  LANDUSE_GROUPS,
  LANDUSE_LEGACY_NAME_COLORS,
  LANDUSE_MEANINGS,
  LANDUSE_STATUS_GROUPS,
  type LanduseClass,
  type LanduseGroup
} from './landuse';
import type { ResourceLayersState } from './resource-layers';
import { noSymbolOverride, type ResourceSymbolOverride, type SymbolMode, type SymbolOverrideOf } from './resource-symbols';
import { classSymbol, resourceStyle, symbolModeOf, uniformSymbol } from './style-registry';
import type { FillPattern } from './fill-patterns';
import { isFillPattern, type ResourceSymbol } from './symbols';

// 图例的推导（ADR 0043）：输入是显示状态、样式登记表和符号覆盖，不读地图；
// 预览取自分组推导用的同一份符号（uniformSymbol、classSymbol，ADR 0044 第 4 节）

/** 一个符号的预览：面是填充加描边（有花纹时叠上花纹），线是一段线，点是带描边的圆点 */
export type LegendSwatch =
  | {
      readonly geometry: 'fill';
      readonly fill: string;
      readonly outline: string;
      readonly pattern?: { readonly name: FillPattern; readonly color: string };
    }
  | { readonly geometry: 'line'; readonly color: string }
  | { readonly geometry: 'circle'; readonly fill: string; readonly stroke: string };

/** 按取值配色的一个取值；key 是分类样式里取值的键 */
export interface LegendValue {
  readonly key: string;
  readonly label: string;
  readonly swatch: LegendSwatch;
}

/**
 * 图例的一条：统一符号；按取值配色；地类（按编码或按名称配色，内容是完整的地类图例）。
 * 按属性配色的条目带样式方式，swatch 是统一样式的预览
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
      readonly values: readonly LegendValue[];
    }
  | {
      readonly kind: 'landuse';
      readonly code: string;
      readonly name: string;
      readonly year: number;
      readonly mode: SymbolMode;
      readonly swatch: LegendSwatch;
      readonly match: 'code' | 'name';
      /** 各取值的预览，按取值的键 */
      readonly swatches: ReadonlyMap<string, LegendSwatch>;
    };

/** 符号的预览 */
export function swatchOf(symbol: ResourceSymbol): LegendSwatch {
  if (symbol.geometry === 'fill') {
    // 描边宽度和线型的预览在 5D
    const fill = symbol.fillStyle === 'none' ? 'rgba(0, 0, 0, 0)' : symbol.fillColor;
    const { fillStyle, patternColor } = symbol;
    const pattern = isFillPattern(fillStyle) ? { pattern: { name: fillStyle, color: patternColor } } : {};
    return { geometry: 'fill', fill, outline: symbol.outlineColor, ...pattern };
  }
  if (symbol.geometry === 'line') {
    return { geometry: 'line', color: symbol.color };
  }
  return { geometry: 'circle', fill: symbol.fillColor, stroke: symbol.strokeColor };
}

// 年份只用来显示（ADR 0052 第 3 节）：条目的身份、名称和符号仍按 code
function legendEntry(resource: Resource, year: number, override: ResourceSymbolOverride | undefined): LegendEntry {
  const { code, name } = resource;
  const style = resourceStyle(code);
  const rule = style.color;
  const swatch = swatchOf(uniformSymbol(resource, override));
  if (!rule) {
    return { kind: 'symbol', code, name, year, swatch };
  }
  const mode = symbolModeOf(style, override);
  const values = classItems(rule).map(item => ({
    key: item.key,
    label: item.label,
    swatch: swatchOf(classSymbol(resource, item, override))
  }));
  if (rule.kind === 'landuse-code' || rule.kind === 'landuse-name') {
    const swatches = new Map(values.map(value => [value.key, value.swatch]));
    const match = rule.kind === 'landuse-code' ? 'code' : 'name';
    return { kind: 'landuse', code, name, year, mode, swatch, match, swatches };
  }
  return { kind: 'values', code, name, year, mode, swatch, values };
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
    if (!resource || !display?.checked || invalid.has(code)) {
      return [];
    }
    return [legendEntry(resource, display.year, overrideOf(code))];
  });
}

/** 条目的集合：只看有哪些资源，不看顺序；集合变化后只剩一条时自动展开这一条 */
export function legendEntrySet(entries: readonly LegendEntry[]): string {
  return entries
    .map(entry => entry.code)
    .toSorted()
    .join('|');
}

/** 地类图例的三种展示：表 A.1 现状分类、表 A.2 工作分类、全部平铺 */
export type LanduseLegendView = 'status' | 'work' | 'all';

export interface LanduseLegendItem {
  /** 分类样式里取值的键，预览按它取 */
  readonly key: string;
  /** 历史地类和未匹配的地类没有编码 */
  readonly code: string | null;
  readonly name: string;
  readonly meaning: string;
  readonly adjustable: boolean;
}

export interface LanduseLegendSection {
  readonly key: string;
  /** 一级类的编码；平铺、历史地类、未匹配时为 null */
  readonly code: string | null;
  readonly name: string;
  readonly items: readonly LanduseLegendItem[];
}

function itemOf({ code, name, adjustable }: LanduseClass): LanduseLegendItem {
  return { key: code, code, name, meaning: LANDUSE_MEANINGS[code] ?? '', adjustable: adjustable === true };
}

// 表 A.2 之外：历史地类按名称配色（编码没命中时，或城镇村按名称），都没命中时是兜底色（ADR 0041 第 2 节）
const LEGACY_SECTION: LanduseLegendSection = {
  key: 'legacy',
  code: null,
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
  key: 'unmatched',
  code: null,
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

function sectionsOf(view: LanduseLegendView): LanduseLegendSection[] {
  if (view === 'all') {
    const items = LANDUSE_GROUPS.flatMap(group => group.classes.map(itemOf));
    return [{ key: 'all', code: null, name: '全部地类', items }];
  }
  const groups: readonly LanduseGroup[] = view === 'status' ? LANDUSE_STATUS_GROUPS : LANDUSE_GROUPS;
  return groups.map(({ code, name, classes }) => ({ key: code, code, name, items: classes.map(itemOf) }));
}

/**
 * 地类图例（ADR 0043 第 2 节）：按所选的展示分组，最后是历史地类和未匹配的地类。
 * 有关键字时（不区分大小写）留下编码或名称命中的地类；分组的编码或名称命中时留下整组；没有地类的分组不显示
 */
export function landuseLegend(view: LanduseLegendView, keyword = ''): LanduseLegendSection[] {
  const needle = keyword.trim().toLowerCase();
  const matches = (text: string | null) => text !== null && text.toLowerCase().includes(needle);
  return [...sectionsOf(view), LEGACY_SECTION, UNMATCHED_SECTION].flatMap(section => {
    if (needle === '' || matches(section.code) || matches(section.name)) {
      return [section];
    }
    const items = section.items.filter(item => matches(item.code) || matches(item.name));
    return items.length > 0 ? [{ ...section, items }] : [];
  });
}
