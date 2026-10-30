import {
  type ExpressionSpecification,
  type LayerSpecification,
  validateStyleMin,
  type VectorSourceSpecification
} from '@maplibre/maplibre-gl-style-spec';
import type { StyleGroup, StyleImage, StyleImages } from '@yzt/map-core';
import type { Resource, ResourceCatalog, ResourceGeometry } from './catalog';
import { treeOrder } from './catalog-order';
import { noSymbolOverride, type ResourceSymbolOverride, type SymbolOverrideOf } from './resource-symbols';
import {
  DEFAULT_OPACITY,
  type ResourceStyle,
  resourceStyleLayers,
  resourceStyle,
  SOURCE_MAXZOOM,
  sourceLayerOf,
  tilesetOf
} from './style-registry';
import { isBodyLayerSuffix, type ResourceLayerPart } from './symbols';

// 资源图层的显示状态与分组推导（ADR 0041 第 3、4 节），都是纯函数；拥有者 useResourceLayers 持有状态并调用它们

/** 分组名；数据源和图层的 ID 以它为前缀（ADR 0027） */
export const RESOURCES_GROUP = 'resources';

const ID_PREFIX = `${RESOURCES_GROUP}-`;

/** 资源的数据源 ID，也是它的图层 ID（MapLibre 里数据源和图层的 ID 互不冲突） */
export function resourceSourceId(code: string): string {
  return `${ID_PREFIX}${code}`;
}

/**
 * 这个资源画出要素本身的图层：主图层和线按线型拆出的图层，每个要素只在其中一层；纹理、描边图层不算。
 * 框选的估数只数这些图层，换符号时估数不变（ADR 0050 第 2 节）
 */
export function isResourceBodyLayer(code: string, layerId: string): boolean {
  const id = resourceSourceId(code);
  return layerId === id || (layerId.startsWith(`${id}-`) && isBodyLayerSuffix(layerId.slice(id.length + 1)));
}

/** 数据源 ID 对应的资源；不是资源图层的数据源时为 null */
export function resourceCodeOfSource(sourceId: string): string | null {
  return sourceId.startsWith(ID_PREFIX) ? sourceId.slice(ID_PREFIX.length) : null;
}

/** 瓦片的基础地址：MapLibre 在 Worker 里请求瓦片，要绝对地址；后面直接拼瓦片集和 {z}/{x}/{y}，不经过 URL（会转义花括号） */
export function resourceTileBase(apiBaseUrl: string, origin: string): string {
  return new URL(`${apiBaseUrl}/api/tiles/`, origin).href;
}

/** 一个资源的显示状态 */
export interface ResourceDisplay {
  readonly checked: boolean;
  /** 0～1 */
  readonly opacity: number;
  /** 资源的年份之一 */
  readonly year: number;
}

/** 按 code 的显示状态；连同它所基于的目录放在一起，推导只读这一份，不会读到目录换了、状态还没合并的中间态 */
export interface ResourceLayersState {
  /** 目录还没加载时为 null */
  readonly catalog: ResourceCatalog | null;
  readonly displays: ReadonlyMap<string, ResourceDisplay>;
  /** 叠放顺序，包括没勾选的，排在前面的画在上面；按目录树整理过，同一个分类的资源连在一起，也是树上的顺序（ADR 0118） */
  readonly order: readonly string[];
}

export const EMPTY_RESOURCE_LAYERS: ResourceLayersState = Object.freeze({
  catalog: null,
  displays: new Map(),
  order: []
});

/** 资源最新的一年：目录保证年份升序、至少一年 */
export function latestYear(resource: Resource): number {
  return resource.years[resource.years.length - 1];
}

function defaultDisplay(resource: Resource): ResourceDisplay {
  return {
    checked: resourceStyle(resource.code).checked ?? false,
    opacity: DEFAULT_OPACITY,
    year: latestYear(resource)
  };
}

// 年份仍在资源的年份里就保留，否则改用最新的一年；勾选和透明度保留
function keptDisplay(display: ResourceDisplay, resource: Resource): ResourceDisplay {
  return resource.years.includes(display.year) ? display : { ...display, year: latestYear(resource) };
}

// 已有的资源保持原来的顺序；新出现的插到目录里排在它后面的第一个已有资源之前，没有就排在最后
function mergedOrder(previous: readonly string[], catalog: ResourceCatalog): string[] {
  const codes = [...catalog.resources.keys()];
  const order = previous.filter(code => catalog.resources.has(code));
  const existing = new Set(order);
  for (const [index, code] of codes.entries()) {
    if (!existing.has(code)) {
      const anchor = codes.slice(index + 1).find(next => existing.has(next));
      order.splice(anchor === undefined ? order.length : order.indexOf(anchor), 0, code);
    }
  }
  return order;
}

/**
 * 目录（重新）加载后按资源合并显示状态（ADR 0041 第 3 节）：仍有的资源保留勾选、透明度和顺序，年份不再有效时改用最新的一年；
 * 新出现的用登记表的默认值；目录里没有了的删掉。顺序再按目录树整理（ADR 0118）。持久化恢复的状态同样经过这里，不直接使用存下的值
 */
export function mergeDisplayState(previous: ResourceLayersState, catalog: ResourceCatalog): ResourceLayersState {
  if (previous.catalog === catalog) {
    return previous;
  }
  const displays = new Map<string, ResourceDisplay>();
  for (const resource of catalog.resources.values()) {
    const display = previous.displays.get(resource.code);
    displays.set(resource.code, display ? keptDisplay(display, resource) : defaultDisplay(resource));
  }
  return { catalog, displays, order: treeOrder(catalog.categories, mergedOrder(previous.order, catalog)) };
}

// 批量设置年份固定列出的年份（ADR 0094）：数据里还没有时也列出
const FIXED_BATCH_YEARS: readonly number[] = [2020, 2021];

/**
 * 批量设置年份可选的年份（ADR 0052 第 2 节、ADR 0094）：多年份资源的年份并集，加上固定的 2020、2021，新的在前；
 * 其他只出现在单年份资源里的年份不列出；目录还没加载时没有
 */
export function batchYearOptions(catalog: ResourceCatalog | null): number[] {
  if (!catalog) {
    return [];
  }
  const years = new Set(FIXED_BATCH_YEARS);
  for (const resource of catalog.resources.values()) {
    if (resource.years.length > 1) {
      resource.years.forEach(year => years.add(year));
    }
  }
  return [...years].toSorted((a, b) => b - a);
}

/**
 * 批量设置年份后的显示状态（ADR 0052 第 2 节）：有这一年的资源不论是否勾选都切过去，其他不变；
 * 没有资源要改时（包括没有任何资源有这一年，ADR 0094）返回原来的状态对象；年份不是整数时抛错
 */
export function withYearForAll(state: ResourceLayersState, year: number): ResourceLayersState {
  if (!Number.isInteger(year)) {
    throw new RangeError(`年份应是整数，收到 ${year}`);
  }
  const displays = new Map(state.displays);
  let changed = false;
  for (const { code, years } of state.catalog?.resources.values() ?? []) {
    const display = displays.get(code);
    if (display && years.includes(year) && display.year !== year) {
      displays.set(code, { ...display, year });
      changed = true;
    }
  }
  return changed ? { ...state, displays } : state;
}

// fill 图层要限定为面：MapLibre 会把线也当成环填充（城镇村等用地的瓦片里夹着退化的线）
const GEOMETRY_FILTERS: Readonly<Record<ResourceGeometry, ExpressionSpecification>> = {
  fill: ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false],
  line: ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false],
  circle: ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false]
};

interface ResourceEntry {
  readonly id: string;
  readonly source: VectorSourceSpecification;
  /** 主图层，以及按需拆出的纹理图层、描边图层（ADR 0045 第 2 节），从下到上 */
  readonly layers: readonly LayerSpecification[];
  readonly images: StyleImages;
}

// 共用的部分：数据源、瓦片图层名、最小级别
type LayerCommon = Pick<LayerSpecification & { type: 'fill' }, 'source' | 'source-layer' | 'minzoom'>;

// 一个图层：ID 按后缀区分，按线型拆开的图层在几何过滤之外再按要素的线型过滤，透明度乘在各几何类型的不透明度上
function layerOf(
  part: ResourceLayerPart,
  id: string,
  common: LayerCommon,
  geometryFilter: ExpressionSpecification,
  opacity: number
): LayerSpecification {
  const layerId = part.suffix ? `${id}-${part.suffix}` : id;
  const filter: ExpressionSpecification = part.filter ? ['all', geometryFilter, part.filter] : geometryFilter;
  const shared = { ...common, id: layerId, filter };
  if (part.type === 'fill') {
    return { ...shared, type: 'fill', paint: { ...part.paint, 'fill-opacity': opacity } };
  }
  if (part.type === 'line') {
    const paint = { ...part.paint, 'line-opacity': opacity };
    return { ...shared, type: 'line', layout: part.layout, paint };
  }
  const paint = { ...part.paint, 'circle-opacity': opacity, 'circle-stroke-opacity': opacity };
  return { ...shared, type: 'circle', paint };
}

// 有最小显示级别的资源，数据源和图层用同一个最小级别：更低的级别不请求瓦片
function resourceEntry(
  resource: Resource,
  { opacity, year }: ResourceDisplay,
  tileBase: string,
  style: ResourceStyle,
  override: ResourceSymbolOverride | undefined
): ResourceEntry {
  const id = resourceSourceId(resource.code);
  const { minzoom, promoteId } = style;
  const zoomRange = minzoom === undefined ? {} : { minzoom };
  const source: VectorSourceSpecification = {
    type: 'vector',
    tiles: [`${tileBase}${tilesetOf(resource.code, year)}/{z}/{x}/{y}.pbf`],
    maxzoom: SOURCE_MAXZOOM,
    ...zoomRange,
    ...(promoteId === undefined ? {} : { promoteId })
  };
  const common: LayerCommon = { source: id, 'source-layer': sourceLayerOf(resource.code, year), ...zoomRange };
  const geometryFilter = GEOMETRY_FILTERS[resource.geometry];
  const { parts, images } = resourceStyleLayers(resource, style, override);
  return { id, source, layers: parts.map(part => layerOf(part, id, common, geometryFilter, opacity)), images };
}

/**
 * 逐个资源校验它的数据源和图层（ADR 0041 第 4 节），返回不合法的资源和原因；只在目录变化时调用。
 * 样式默认取登记表，参数留给测试；按默认符号校验，覆盖的取值已由拥有者和存储格式限定在合法范围（ADR 0044）
 */
export function validateCatalog(
  catalog: ResourceCatalog | null,
  tileBase: string,
  styleOf: (code: string) => ResourceStyle = resourceStyle
): ReadonlyMap<string, readonly string[]> {
  const invalid = new Map<string, readonly string[]>();
  for (const resource of catalog?.resources.values() ?? []) {
    const display = { checked: true, opacity: DEFAULT_OPACITY, year: latestYear(resource) };
    try {
      const { id, source, layers } = resourceEntry(resource, display, tileBase, styleOf(resource.code), undefined);
      const errors = validateStyleMin({ version: 8, sources: { [id]: source }, layers: [...layers] });
      if (errors.length > 0) {
        invalid.set(resource.code, errors.map(({ message }) => message));
      }
    } catch (error) {
      // 结果在 computed 里使用，不能抛错（ADR 0028）
      invalid.set(resource.code, [String(error)]);
    }
  }
  return invalid;
}

export interface ResourcesGroupInput {
  readonly state: ResourceLayersState;
  /** 校验不通过的资源，不进入推导 */
  readonly invalid: ReadonlyMap<string, unknown>;
  readonly tileBase: string;
  /** 用户调整的符号（ADR 0044 第 4 节）；不传时都用默认符号 */
  readonly overrideOf?: SymbolOverrideOf;
}

/** resources 分组：只有勾选且校验通过的资源，每个资源一个数据源、一个图层；面板上排在前面的画在上面 */
export function resourcesGroup({
  state,
  invalid,
  tileBase,
  overrideOf = noSymbolOverride
}: ResourcesGroupInput): StyleGroup {
  const sources: Record<string, VectorSourceSpecification> = {};
  const layers: LayerSpecification[] = [];
  const images: Record<string, StyleImage> = {};
  // order 从上到下，样式里的图层从下到上
  for (const code of state.order.toReversed()) {
    const resource = state.catalog?.resources.get(code);
    const display = state.displays.get(code);
    if (resource && display?.checked && !invalid.has(code)) {
      const entry = resourceEntry(resource, display, tileBase, resourceStyle(code), overrideOf(code));
      sources[entry.id] = entry.source;
      layers.push(...entry.layers);
      // 几个资源用到同一种花纹时是同一张图片
      Object.assign(images, entry.images);
    }
  }
  return Object.keys(images).length > 0 ? { sources, layers, images } : { sources, layers };
}
