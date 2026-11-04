import { appConfig } from '@/shared/config/app-config';
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
import { type ClassEntry, type ClassItem, type ColorRule, symbolClasses } from './classification';
import { LANDUSE_FALLBACK_COLOR } from './landuse';
import { paletteColor } from './palette';
import type { ResourceSymbolOverride, SymbolMode } from './resource-symbols';
import {
  classifiedLayers,
  darkenColor,
  type ResourceStyleLayers,
  type ResourceSymbol,
  resolveSymbol,
  symbolLayers,
  withAlpha
} from './symbols';

// 样式登记表（ADR 0041 第 2 节）：接口只给 code、名称、几何类型和年份，渲染细节按 code 登记在这里；
// 只登记和默认值不同的部分。地图样式里的颜色是数据，不走 CSS 令牌

export interface ResourceStyle {
  /** 最小显示级别：数据源和图层共用，更低的级别不请求瓦片（ADR 0041 第 3 节、ADR 0132） */
  readonly minzoom?: number;
  readonly color?: ColorRule;
  /** 用这个属性作要素 ID，跨瓦片稳定，点选高亮用 */
  readonly promoteId?: string;
  readonly checked?: boolean;
}

// 按取值配色的规则：字段加字典（ADR 0123）
function valueRule(property: string, entries: readonly ClassEntry[], fallback = LANDUSE_FALLBACK_COLOR): ColorRule {
  return { kind: 'values', property, entries, fallback };
}

// 水域的兜底色和类别同是蓝色系
const WATER_FALLBACK = '#2F80ED';

// 最小显示级别：单张瓦片不超过 6 MB 的最低级别，多个年份取最严的（--tile-cost 实测，ADR 0132，docs/migration.md）；
// 按属性配色：字段和取值来自探查（ADR 0123），点层比面层少的取值只列实际有的
const RESOURCE_STYLES = new Map<string, ResourceStyle>([
  ['bgdc_dltb', { color: { kind: 'landuse-code' }, promoteId: 'bsm', checked: true }],
  ['bgdc_dltb_czc', { color: { kind: 'landuse-name' } }],
  ['bgdc_czcdyd', { color: valueRule('czclx', URBAN_VILLAGE_TYPES) }],
  ['lcsh_sltb', { color: valueRule('lin_zhong', FOREST_TYPES) }],
  ['lcsh_cdtb', { color: { kind: 'landuse-code', only: GRASSLAND_LANDUSE } }],
  ['lcsh_sdtb', { color: { kind: 'landuse-code', only: WETLAND_LANDUSE } }],
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
  ['csxhjctb_lvll', { minzoom: 8, color: valueRule('type', RURAL_ROAD_TYPES, '#A1887F') }],
  ['csxhjctb_lrdl', { minzoom: 9, color: valueRule('type', HIGHWAY_TYPES) }],
  ['csxhjctb_lctl', { minzoom: 9, color: valueRule('type', CITY_ROAD_TYPES) }],
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
  ['szy_hl_fs', { minzoom: 8, color: valueRule('hldj', RIVER_LEVELS) }],
  ['szy_hl_ks', { minzoom: 8, color: valueRule('hldj', RIVER_LEVELS) }],
  ['szy_sk_fs', { color: valueRule('skdb', RESERVOIR_GRADES) }],
  ['szy_sk_ks', { color: valueRule('skdb', RESERVOIR_GRADES) }],
  ['szy_hp_fs', { color: valueRule('lymc', BASIN_TYPES) }],
  ['szy_hp_ks', { color: valueRule('lymc', BASIN_TYPES) }],
  ['szy_kt', { color: valueRule('lymc', BASIN_TYPES) }],
  ['bgdc_gddb', { color: valueRule('lyd', FARMLAND_GRADES) }],
  ['bgdc_pzwjstd', { color: valueRule('ywlx', UNBUILT_LAND_TYPES) }],
  ['bgdc_xzqjx', { color: valueRule('jxlx', BOUNDARY_TYPES) }],
  ['bgdc_yjjbnttb', { minzoom: 8, color: valueRule('dlmc', PERMANENT_FARMLAND_TYPES) }],
  ['bgdc_lmfw', { minzoom: 8 }],
  [
    'bgdc_cjdcqjx',
    {
      color: valueRule('jxlx', pickEntries(BOUNDARY_TYPES, '630200', '640200', '650200', '660200', '670500'))
    }
  ]
]);

const NO_STYLE: ResourceStyle = {};

export function resourceStyle(code: string): ResourceStyle {
  const style = RESOURCE_STYLES.get(code) ?? NO_STYLE;
  if (appConfig.resourceMinZoomEnabled) {
    return style;
  }
  // 提示、瓦片请求和点选都从这里取最小显示级别，关闭开关时一起不限制（ADR 0132）
  const { minzoom: _unused, ...unlimited } = style;
  return unlimited;
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
  return { geometry: 'circle', size: 'M', fillColor: color, strokeColor: '#FFFFFF', strokeWidth: 1 };
}

// 统一符号的面是 0.35 透明度的填充加同色描边
const FILL_ALPHA = 0.35;

/** 统一符号的默认值，颜色按资源在目录里的顺序从配色板取 */
export function defaultSymbol(resource: Resource): ResourceSymbol {
  const color = paletteColor(resource.index);
  const symbol = colorSymbol(resource.geometry, color);
  return symbol.geometry === 'fill' ? { ...symbol, fillColor: withAlpha(color, FILL_ALPHA) } : symbol;
}

// 分类样式的纹理颜色是取值颜色加深（ADR 0046）：填充不透明，同色的花纹看不见
const CLASS_PATTERN_DARKEN = 0.4;

/** 分类样式里一个取值的默认值：取值的颜色作主色，面的纹理颜色加深 */
export function classDefaultSymbol(resource: Resource, item: ClassItem): ResourceSymbol {
  const symbol = colorSymbol(resource.geometry, item.color);
  if (symbol.geometry !== 'fill') {
    return symbol;
  }
  return { ...symbol, patternColor: darkenColor(item.color, CLASS_PATTERN_DARKEN) };
}

/** 统一样式叠加覆盖后的符号 */
export function uniformSymbol(resource: Resource, override?: ResourceSymbolOverride): ResourceSymbol {
  return resolveSymbol(defaultSymbol(resource), override?.uniform);
}

/** 分类样式里一个取值叠加覆盖后的符号 */
export function classSymbol(resource: Resource, item: ClassItem, override?: ResourceSymbolOverride): ResourceSymbol {
  return resolveSymbol(classDefaultSymbol(resource, item), override?.items?.[item.key]);
}

/** 样式方式：不按属性配色的资源只有统一样式；没选过方式时，调过统一样式的按统一样式，其余按分类样式（ADR 0123 第 3 节） */
export function symbolModeOf(style: ResourceStyle, override?: ResourceSymbolOverride): SymbolMode {
  if (!style.color) {
    return 'uniform';
  }
  return override?.mode ?? (override?.uniform ? 'uniform' : 'classified');
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
    return symbolLayers(uniformSymbol(resource, override));
  }
  return classifiedLayers(symbolClasses(rule), item => classSymbol(resource, item, override));
}
