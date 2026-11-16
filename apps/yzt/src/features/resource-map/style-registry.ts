import { createExpression, type StylePropertySpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Resource, ResourceGeometry } from './catalog';
import {
  BASIN_TYPES,
  BOUNDARY_TYPES,
  CITY_ROAD_TYPES,
  COMMERCE_TYPES,
  CULTIVATED_LANDUSE,
  CULTURE_VENUE_TYPES,
  DEVELOPMENT_ZONE_TYPES,
  FARMLAND_GRADES,
  FOREST_TYPES,
  FUNERAL_TYPES,
  GRASSLAND_LANDUSE,
  HIGHWAY_EXIT_TYPES,
  HIGHWAY_TYPES,
  HOUSING_TYPES,
  MEDICAL_TYPES,
  PARK_TYPES,
  PERMANENT_FARMLAND_TYPES,
  pickEntries,
  RAIL_STATION_TYPES,
  RAILWAY_TYPES,
  RAMP_TYPES,
  RED_LINE_TYPES,
  RESERVOIR_GRADES,
  RIVER_LEVELS,
  RURAL_ROAD_TYPES,
  SCHOOL_TYPES,
  SHELTER_TYPES,
  SOIL_TYPES,
  TRANSPORT_LAND_TYPES,
  TRANSPORT_STATION_TYPES,
  UNBUILT_LAND_TYPES,
  URBAN_RENEWAL_TYPES,
  URBAN_VILLAGE_TYPES,
  UTILITY_TYPES,
  WATER_TYPES,
  WELFARE_TYPES,
  WETLAND_LANDUSE
} from './class-dictionaries';
import {
  type ClassEntry,
  classExpression,
  type ClassItem,
  classItems,
  type ColorRule,
  OTHER_ITEM,
  symbolClasses
} from './classification';
import { codeDefaultLabel, type PointLook, type ResourceLabel, resolveLabel } from './labels';
import { LANDUSE_FALLBACK_COLOR } from './landuse';
import { paletteColor } from './palette';
import type { PointMark } from './point-shapes';
import shippedSymbols from './resource-symbol-defaults.json';
import {
  CODE_DEFAULT_MODE,
  fromStoredSymbols,
  layerMode,
  type ResourceSymbolOverride,
  storedSymbolsSchema,
  type SymbolMode
} from './resource-symbols';
import {
  classifiedLayers,
  darkenColor,
  pointIconSize,
  type ResourceLayerStyle,
  type ResourceStyleLayers,
  type ResourceSymbol,
  resolveSymbol,
  symbolLayers,
  withAlpha
} from './symbols';

// 样式登记表（ADR 0041 第 2 节）：接口只给 code、名称、几何类型和年份，渲染细节按 code 登记在这里；
// 只登记和默认值不同的部分。地图样式里的颜色是数据，不走 CSS 令牌

export interface ResourceStyle {
  readonly color?: ColorRule;
  /** 用这个属性作要素 ID，跨瓦片稳定，点选高亮用 */
  readonly promoteId?: string;
  readonly checked?: boolean;
  /**
   * 图例摘要画的代表取值（取值的键，ADR 0159）：按它们当前的符号画，用户改了颜色、形状会跟着变；
   * 不写时取前几个取值（不含兜底和历史地类）
   */
  readonly summary?: readonly string[];
  /** 发布的默认符号（ADR 0154）：叠加在算出的默认符号上，用户的覆盖再叠加在它上面 */
  readonly symbols?: ResourceSymbolOverride;
}

// 按取值配色的规则：字段加字典（ADR 0123）
function valueRule(property: string, entries: readonly ClassEntry[], fallback = LANDUSE_FALLBACK_COLOR): ColorRule {
  return { kind: 'values', property, entries, fallback };
}

// 水域的兜底色和类别同是蓝色系
const WATER_FALLBACK = '#2F80ED';

// 按属性配色：字段和取值来自探查（ADR 0123），点层比面层少的取值只列实际有的。
// 图例摘要的代表取值（summary，ADR 0159）：地类图斑由用户 2026-11-16 确定，其余按 2026-11-01 探查的抽样次数取最常见的、
// 各大类一个，待用户确认；没写的取前几个取值
const RESOURCE_STYLES = new Map<string, ResourceStyle>([
  [
    'bgdc_dltb',
    { color: { kind: 'landuse-code' }, promoteId: 'bsm', checked: true, summary: ['0101', '0301', '0701', '1101'] }
  ],
  ['bgdc_dltb_czc', { color: { kind: 'landuse-name' }, summary: ['0102', '0307', '0702', '1107'] }],
  ['bgdc_czcdyd', { color: valueRule('czclx', URBAN_VILLAGE_TYPES), summary: ['201', '202', '203'] }],
  ['lcsh_sltb', { color: valueRule('lin_zhong', FOREST_TYPES) }],
  ['lcsh_cdtb', { color: { kind: 'landuse-code', only: GRASSLAND_LANDUSE }, summary: ['0404', '0301', '0102'] }],
  ['lcsh_sdtb', { color: { kind: 'landuse-code', only: WETLAND_LANDUSE }, summary: ['1106', '1101', '0301'] }],
  ['lcsh_hmtb', { color: valueRule('tu_rang_lx', SOIL_TYPES) }],
  ['csxhjctb_xxa', { color: valueRule('cc', SCHOOL_TYPES) }],
  ['csxhjctb_xxp', { color: valueRule('cc', pickEntries(SCHOOL_TYPES, '08H212', '08H213', '08H214', '08H215')) }],
  ['csxhjctb_yljga', { color: valueRule('cc', MEDICAL_TYPES) }],
  ['csxhjctb_yljgp', { color: valueRule('cc', MEDICAL_TYPES) }],
  ['csxhjctb_fljga', { color: valueRule('cc', WELFARE_TYPES) }],
  ['csxhjctb_fljgp', { color: valueRule('cc', WELFARE_TYPES) }],
  ['csxhjctb_gyssa', { color: valueRule('cc', UTILITY_TYPES) }],
  ['csxhjctb_gyssp', { color: valueRule('cc', pickEntries(UTILITY_TYPES, '080901', '080905')) }],
  ['csxhjctb_gyylda', { color: valueRule('cc', PARK_TYPES) }],
  ['csxhjctb_jtfwcza', { color: valueRule('cc', TRANSPORT_STATION_TYPES) }],
  ['csxhjctb_jtysyda', { color: valueRule('cc', TRANSPORT_LAND_TYPES) }],
  ['csxhjctb_jtysydp', { color: valueRule('type', RAIL_STATION_TYPES) }],
  ['csxhjctb_syfwya', { color: valueRule('cc', COMMERCE_TYPES) }],
  ['csxhjctb_syfwyp', { color: valueRule('cc', COMMERCE_TYPES) }],
  ['csxhjctb_czzza', { color: valueRule('cc', HOUSING_TYPES) }],
  ['csxhjctb_xzcsgxgzyda', { color: valueRule('type', URBAN_RENEWAL_TYPES) }],
  ['csxhjctb_yjbna', { color: valueRule('type', SHELTER_TYPES) }],
  ['csxhjctb_hydl', { color: valueRule('ccn', pickEntries(WATER_TYPES, '河流', '水渠'), WATER_FALLBACK) }],
  ['csxhjctb_hyda', { color: valueRule('ccn', WATER_TYPES, WATER_FALLBACK) }],
  ['csxhjctb_lvll', { color: valueRule('type', RURAL_ROAD_TYPES, '#A1887F') }],
  ['csxhjctb_lrdl', { color: valueRule('type', HIGHWAY_TYPES) }],
  ['csxhjctb_lctl', { color: valueRule('type', CITY_ROAD_TYPES) }],
  ['csxhjctb_llkl', { color: valueRule('type', RAMP_TYPES) }],
  ['csxhjctb_llkp', { color: valueRule('type', HIGHWAY_EXIT_TYPES) }],
  ['csxhjctb_lrrl', { color: valueRule('type', RAILWAY_TYPES) }],
  ['gtkjgh_czkfbj', { color: valueRule('ghfqdm', DEVELOPMENT_ZONE_TYPES) }],
  ['gtkjgh_stbhhx', { color: valueRule('hxlx', RED_LINE_TYPES) }],
  ['gtkjgh_gdbhmb', { color: { kind: 'landuse-code', only: CULTIVATED_LANDUSE } }],
  ['gtkjgh_yjjbntbhtb', { color: { kind: 'landuse-code', only: CULTIVATED_LANDUSE } }],
  ['csxhjctb_wycga', { color: valueRule('type', CULTURE_VENUE_TYPES) }],
  ['csxhjctb_wycgp', { color: valueRule('type', CULTURE_VENUE_TYPES) }],
  ['csxhjctb_bzssa', { color: valueRule('type', FUNERAL_TYPES) }],
  ['szy_hl_fs', { color: valueRule('hldj', RIVER_LEVELS) }],
  ['szy_hl_ks', { color: valueRule('hldj', RIVER_LEVELS) }],
  ['szy_sk_fs', { color: valueRule('skdb', RESERVOIR_GRADES) }],
  ['szy_sk_ks', { color: valueRule('skdb', RESERVOIR_GRADES) }],
  ['szy_hp_fs', { color: valueRule('lymc', BASIN_TYPES) }],
  ['szy_hp_ks', { color: valueRule('lymc', BASIN_TYPES) }],
  ['szy_kt', { color: valueRule('lymc', BASIN_TYPES) }],
  ['bgdc_gddb', { color: valueRule('lyd', FARMLAND_GRADES) }],
  ['bgdc_pzwjstd', { color: valueRule('ywlx', UNBUILT_LAND_TYPES) }],
  ['bgdc_xzqjx', { color: valueRule('jxlx', BOUNDARY_TYPES) }],
  ['bgdc_yjjbnttb', { color: valueRule('dlmc', PERMANENT_FARMLAND_TYPES), summary: ['水田', '水浇地', '旱地'] }],
  [
    'bgdc_cjdcqjx',
    {
      color: valueRule('jxlx', pickEntries(BOUNDARY_TYPES, '630200', '640200', '650200', '660200', '670500'))
    }
  ]
]);

// 发布的默认符号（ADR 0154）：格式和用户保存的覆盖相同，由 symbols:import 从某个用户调好的样式写入
const SHIPPED_SYMBOLS = fromStoredSymbols(storedSymbolsSchema.parse(shippedSymbols));

// 登记表加上发布的默认符号；只有发布的默认符号的资源（不按属性配色）也在这里
const STYLES: ReadonlyMap<string, ResourceStyle> = new Map(
  [...new Set([...RESOURCE_STYLES.keys(), ...SHIPPED_SYMBOLS.keys()])].map(code => {
    const symbols = SHIPPED_SYMBOLS.get(code);
    const style: ResourceStyle = { ...RESOURCE_STYLES.get(code), ...(symbols ? { symbols } : {}) };
    return [code, style];
  })
);

const NO_STYLE: ResourceStyle = {};

export function resourceStyle(code: string): ResourceStyle {
  return STYLES.get(code) ?? NO_STYLE;
}

/** 新出现的资源的透明度：100%（ADR 0053 第 6 节；旧项目是 0.9）。已经存下的透明度保留原值 */
export const DEFAULT_OPACITY = 1;

/** 数据源的最大级别：更高的级别由 MapLibre 放大，不再向后端请求 */
export const SOURCE_MAXZOOM = 15;

/** 瓦片集名，也是瓦片地址的一段 */
export function tilesetOf(code: string, year: number): string {
  return `${code}_${year}`;
}

// 瓦片里的图层名默认等于瓦片集名；地类图斑（城镇村）的规范名称不带 bgdc_ 前缀（后端确认，2026-11-01 探查全部资源）
const SOURCE_LAYER_EXCEPTIONS = new Map([['bgdc_dltb_czc_2021', 'dltb_czc_2021']]);

export function sourceLayerOf(code: string, year: number): string {
  const tileset = tilesetOf(code, year);
  return SOURCE_LAYER_EXCEPTIONS.get(tileset) ?? tileset;
}


// 默认符号（ADR 0044 第 2 节、ADR 0045 第 1 节）：主色之外，线是实线、M 档，点是 M 档、白色 1 像素描边；
// 面是均匀填充，填充、花纹、描边同色，描边 1 像素实线
function colorSymbol(geometry: ResourceGeometry, color: string): ResourceSymbol {
  if (geometry === 'fill') {
    return {
      geometry: 'fill',
      fillColor: color,
      fillStyle: 'solid',
      patternColor: color,
      outlineColor: color,
      outlineWidth: 'M',
      outlineDash: 'solid'
    };
  }
  if (geometry === 'line') {
    return { geometry: 'line', color, width: 'M', dash: 'solid' };
  }
  return { geometry: 'circle', shape: 'circle', size: 'M', fillColor: color, strokeColor: '#FFFFFF', strokeWidth: 1 };
}

// 统一符号的面是 0.35 透明度的填充加同色描边
const FILL_ALPHA = 0.35;

/** 统一符号的默认值：颜色按资源在目录里的顺序从配色板取，再叠加发布的默认符号 */
export function defaultSymbol(resource: Resource, style: ResourceStyle = resourceStyle(resource.code)): ResourceSymbol {
  const color = paletteColor(resource.index);
  const symbol = colorSymbol(resource.geometry, color);
  const computed = symbol.geometry === 'fill' ? { ...symbol, fillColor: withAlpha(color, FILL_ALPHA) } : symbol;
  return resolveSymbol(computed, style.symbols?.uniform);
}

// 分类样式的纹理颜色是取值颜色加深（ADR 0046）：填充不透明，同色的花纹看不见
const CLASS_PATTERN_DARKEN = 0.4;

/** 分类样式里一个取值的默认值：取值的颜色作主色，面的纹理颜色加深，再叠加发布的默认符号 */
export function classDefaultSymbol(
  resource: Resource,
  item: ClassItem,
  style: ResourceStyle = resourceStyle(resource.code)
): ResourceSymbol {
  const symbol = colorSymbol(resource.geometry, item.color);
  const computed =
    symbol.geometry === 'fill' ? { ...symbol, patternColor: darkenColor(item.color, CLASS_PATTERN_DARKEN) } : symbol;
  return resolveSymbol(computed, style.symbols?.items?.[item.key]);
}

/** 统一样式叠加覆盖后的符号 */
export function uniformSymbol(
  resource: Resource,
  override?: ResourceSymbolOverride,
  style: ResourceStyle = resourceStyle(resource.code)
): ResourceSymbol {
  return resolveSymbol(defaultSymbol(resource, style), override?.uniform);
}

/** 分类样式里一个取值叠加覆盖后的符号 */
export function classSymbol(
  resource: Resource,
  item: ClassItem,
  override?: ResourceSymbolOverride,
  style: ResourceStyle = resourceStyle(resource.code)
): ResourceSymbol {
  return resolveSymbol(classDefaultSymbol(resource, item, style), override?.items?.[item.key]);
}

/** 用户没调过时的样式方式：发布的默认符号决定，没有时是分类样式（ADR 0154） */
export function defaultSymbolMode(style: ResourceStyle): SymbolMode {
  return layerMode(style.symbols, CODE_DEFAULT_MODE);
}

/**
 * 样式方式：不按属性配色的资源只有统一样式；用户没选过方式时，调过统一样式的按统一样式，只调过取值的按分类样式，
 * 都没调过时用默认的方式（ADR 0123 第 3 节、ADR 0154）
 */
export function symbolModeOf(style: ResourceStyle, override?: ResourceSymbolOverride): SymbolMode {
  if (!style.color) {
    return 'uniform';
  }
  return layerMode(override, defaultSymbolMode(style));
}

/**
 * 资源的图层和样式图片（ADR 0044 第 4 节、ADR 0045 第 2 节）：统一样式是默认符号叠加覆盖；
 * 分类样式由各取值叠加覆盖后的符号组合。图例用同样的 uniformSymbol、classSymbol 得出预览
 */
export function resourceStyleLayers(
  resource: Resource,
  style: ResourceStyle = resourceStyle(resource.code),
  override?: ResourceSymbolOverride
): ResourceStyleLayers {
  const rule = style.color;
  if (!rule || symbolModeOf(style, override) === 'uniform') {
    return symbolLayers(uniformSymbol(resource, override, style));
  }
  return classifiedLayers(symbolClasses(rule), item => classSymbol(resource, item, override, style));
}

/**
 * 点资源的选中高亮（ADR 0159）：和资源的点图层同样按要素的属性取形状、大小，描边换成高亮色、加宽；
 * 图片就是资源分组里的那几张。不是点资源时为 null
 */
export function resourceHighlightStyle(
  resource: Resource,
  color: string,
  override?: ResourceSymbolOverride,
  style: ResourceStyle = resourceStyle(resource.code)
): Extract<ResourceLayerStyle, { type: 'symbol' }> | null {
  if (resource.geometry !== 'circle') {
    return null;
  }
  const rule = style.color;
  const { parts } =
    !rule || symbolModeOf(style, override) === 'uniform'
      ? symbolLayers(uniformSymbol(resource, override, style), color)
      : classifiedLayers(symbolClasses(rule), item => classSymbol(resource, item, override, style), color);
  const [part] = parts;
  return part?.type === 'symbol' ? { type: 'symbol', layout: part.layout, paint: part.paint } : null;
}

/** 默认标注（ADR 0160）：代码给出的默认叠加发布的默认；没有登记标注字段的资源为 null */
export function defaultLabel(
  resource: Resource,
  style: ResourceStyle = resourceStyle(resource.code)
): ResourceLabel | null {
  const defaults = codeDefaultLabel(resource);
  return defaults && resolveLabel(resource, defaults, style.symbols?.label);
}

/** 叠加用户覆盖后的标注；没有登记标注字段的资源为 null */
export function resourceLabel(
  resource: Resource,
  override?: ResourceSymbolOverride,
  style: ResourceStyle = resourceStyle(resource.code)
): ResourceLabel | null {
  const defaults = defaultLabel(resource, style);
  return defaults && resolveLabel(resource, defaults, override?.label);
}

/** 点资源画出的各种点（统一样式一种，分类样式每个取值一种），标注据此让开点；不是点资源时为空 */
export function pointLooks(
  resource: Resource,
  override?: ResourceSymbolOverride,
  style: ResourceStyle = resourceStyle(resource.code)
): PointLook[] {
  if (resource.geometry !== 'circle') {
    return [];
  }
  const rule = style.color;
  const symbols =
    !rule || symbolModeOf(style, override) === 'uniform'
      ? [uniformSymbol(resource, override, style)]
      : classItems(rule).map(item => classSymbol(resource, item, override, style));
  return symbols.flatMap(symbol =>
    symbol.geometry === 'circle' ? [{ shape: symbol.shape, size: symbol.size, strokeWidth: symbol.strokeWidth }] : []
  );
}

/** 按要素的属性给出它在地图上画出的样子 */
export type PointMarkOf = (properties: Readonly<Record<string, unknown>>) => PointMark;

// 取值的键按 MapLibre 的语义求值：和图层的 match 是同一个表达式（map.md：地图以外的求值一律用 style-spec）
const CLASS_KEY_SPEC = {
  type: 'string',
  'property-type': 'data-driven',
  expression: { interpolated: false, parameters: ['zoom', 'feature'] },
  transition: false
} as const satisfies StylePropertySpecification;

/**
 * 点资源的要素在这一级画出的样子（ADR 0159 第 3 节）：按属性找到它的取值和符号，给出形状、icon-size 和描边宽度，
 * 点选按到它的距离过滤和排序；icon-size 同图层的曲线。不是点资源时为 null
 */
export function pointMarkOf(
  resource: Resource,
  zoom: number,
  override?: ResourceSymbolOverride,
  style: ResourceStyle = resourceStyle(resource.code)
): PointMarkOf | null {
  if (resource.geometry !== 'circle') {
    return null;
  }
  const markOf = (symbol: ResourceSymbol): PointMark =>
    symbol.geometry === 'circle'
      ? { shape: symbol.shape, iconSize: pointIconSize(symbol.size, zoom), strokeWidth: symbol.strokeWidth }
      : { shape: 'circle', iconSize: 0, strokeWidth: 0 };
  const rule = style.color;
  if (!rule || symbolModeOf(style, override) === 'uniform') {
    const mark = markOf(uniformSymbol(resource, override, style));
    return () => mark;
  }
  const items = classItems(rule);
  const marks = new Map(items.map(item => [item.key, markOf(classSymbol(resource, item, override, style))]));
  const parsed = createExpression(classExpression(rule, item => item.key), 'class-key', CLASS_KEY_SPEC);
  if (parsed.result !== 'success') {
    throw new Error(parsed.value.map(({ message }) => message).join('；'));
  }
  const fallback = marks.get(OTHER_ITEM) ?? markOf(uniformSymbol(resource, override, style));
  const expression = parsed.value;
  return properties => {
    const key: unknown = expression.evaluate({ zoom }, { type: 'Point', properties: { ...properties } });
    return marks.get(String(key)) ?? fallback;
  };
}
