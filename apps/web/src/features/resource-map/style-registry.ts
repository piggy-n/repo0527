import type { Resource, ResourceGeometry } from './catalog';
import { type ClassItem, type ColorRule, symbolClasses } from './classification';
import { LANDUSE_FALLBACK_COLOR } from './landuse';
import { paletteColor } from './palette';
import type { ResourceSymbolOverride, SymbolMode } from './resource-symbols';
import {
  classifiedPaint,
  type ResourceLayerStyle,
  type ResourceSymbol,
  resolveSymbol,
  symbolPaint,
  withAlpha
} from './symbols';

// 样式登记表（ADR 0041 第 2 节）：接口只给 code、名称、几何类型和年份，渲染细节按 code 登记在这里；
// 只登记和默认值不同的部分。地图样式里的颜色是数据，不走 CSS 令牌

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

export type { ResourceLayerStyle } from './symbols';

// 默认符号（ADR 0044 第 2 节）：主色之外，线是实线、M 档，点是 M 档、白色 1 像素描边；面的填充和描边同色
function colorSymbol(geometry: ResourceGeometry, color: string): ResourceSymbol {
  if (geometry === 'fill') {
    return { geometry: 'fill', fillColor: color, outlineColor: color };
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

/** 分类样式里一个取值的默认值：取值的颜色作主色 */
export function classDefaultSymbol(resource: Resource, item: ClassItem): ResourceSymbol {
  return colorSymbol(resource.geometry, item.color);
}

/** 统一样式叠加覆盖后的符号 */
export function uniformSymbol(resource: Resource, override?: ResourceSymbolOverride): ResourceSymbol {
  return resolveSymbol(defaultSymbol(resource), override?.uniform);
}

/** 分类样式里一个取值叠加覆盖后的符号 */
export function classSymbol(resource: Resource, item: ClassItem, override?: ResourceSymbolOverride): ResourceSymbol {
  return resolveSymbol(classDefaultSymbol(resource, item), override?.items?.[item.key]);
}

/** 样式方式：不按属性配色的资源只有统一样式 */
export function symbolModeOf(style: ResourceStyle, override?: ResourceSymbolOverride): SymbolMode {
  return style.color && override?.mode !== 'uniform' ? 'classified' : 'uniform';
}

/**
 * 资源图层的样式（ADR 0044 第 4 节）：统一样式是默认符号叠加覆盖；分类样式由各取值叠加覆盖后的符号组合。
 * 图例用同样的 uniformSymbol、classSymbol 得出预览
 */
export function resourceLayerStyle(
  resource: Resource,
  style: ResourceStyle = resourceStyle(resource.code),
  override?: ResourceSymbolOverride
): ResourceLayerStyle {
  const rule = style.color;
  if (!rule || symbolModeOf(style, override) === 'uniform') {
    return symbolPaint(uniformSymbol(resource, override));
  }
  return classifiedPaint(symbolClasses(rule), item => classSymbol(resource, item, override));
}
