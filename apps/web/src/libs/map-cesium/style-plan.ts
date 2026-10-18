import {
  latest,
  type Feature,
  type GeoJSONSourceSpecification,
  type LayerSpecification,
  type RasterSourceSpecification,
  type StyleSpecification,
  type VectorSourceSpecification
} from '@maplibre/maplibre-gl-style-spec';
import type { StyleImages } from '@yzt/map-core/worker';
import { compileStyleFilter, compileStyleProperty, type CompiledStyleProperty } from './style-expression';

type BasicLayerType = 'background' | 'raster' | 'fill' | 'line' | 'circle';
type BasicLayerSpecification = Extract<LayerSpecification, { type: BasicLayerType }>;
type BasicSource = RasterSourceSpecification | GeoJSONSourceSpecification | VectorSourceSpecification;

/** 一个可绘制图层的只读计划，保留会话快照的对象身份 */
export interface BasicStyleLayer {
  readonly id: string;
  readonly type: BasicLayerType;
  readonly sourceId?: string;
  readonly source?: BasicSource;
  readonly specification: LayerSpecification;
  readonly images: StyleImages;
  readonly zoomDependent: boolean;
  visible(zoom: number): boolean;
  value(property: string, zoom: number, feature?: Feature): unknown;
  accepts(zoom: number, feature: Feature): boolean;
}

/** 不支持或无效的图层单独报告，不影响其他图层 */
export interface StylePlanIssue {
  readonly layerId: string;
  readonly error: Error;
}

export interface BasicStylePlan {
  readonly layers: readonly BasicStyleLayer[];
  readonly issues: readonly StylePlanIssue[];
}

// 只列支持边界，属性默认值和表达式语义仍由规范库提供
const PAINT: Record<BasicLayerType, readonly string[]> = {
  background: ['background-color', 'background-opacity'],
  raster: ['raster-opacity'],
  fill: ['fill-color', 'fill-opacity', 'fill-outline-color', 'fill-antialias', 'fill-pattern'],
  line: ['line-color', 'line-opacity', 'line-width', 'line-dasharray', 'line-offset', 'line-blur'],
  circle: ['circle-color', 'circle-opacity', 'circle-radius', 'circle-stroke-color',
    'circle-stroke-opacity', 'circle-stroke-width']
};
const LAYOUT: Record<BasicLayerType, readonly string[]> = {
  background: [],
  raster: [],
  fill: [],
  line: ['line-cap', 'line-join', 'line-miter-limit'],
  circle: []
};
const SOURCE_KEYS: Record<BasicSource['type'], readonly string[]> = {
  raster: ['type', 'tiles', 'bounds', 'minzoom', 'maxzoom', 'tileSize', 'scheme', 'attribution'],
  geojson: ['type', 'data', 'attribution'],
  vector: ['type', 'tiles', 'bounds', 'minzoom', 'maxzoom', 'scheme', 'attribution', 'promoteId']
};

/** 按会话层序编译支持的基础样式；诊断与跳过规则见 ADR 0024 */
export function compileStylePlan(style: StyleSpecification, images: StyleImages = {}): BasicStylePlan {
  const layers: BasicStyleLayer[] = [];
  const issues: StylePlanIssue[] = [];
  for (const specification of style.layers) {
    try {
      if (!isBasicLayer(specification)) {
        throw new Error(`三维基础样式暂不支持 ${specification.type} 图层`);
      }
      layers.push(compileLayer(specification, style, images));
    } catch (error) {
      issues.push({ layerId: specification.id, error: error instanceof Error ? error : new Error(String(error)) });
    }
  }
  return { layers, issues };
}

function isBasicLayer(layer: LayerSpecification): layer is BasicLayerSpecification {
  return Object.hasOwn(PAINT, layer.type);
}

function compileLayer(layer: BasicLayerSpecification, style: StyleSpecification, images: StyleImages): BasicStyleLayer {
  const sourceId = 'source' in layer ? layer.source : undefined;
  const source = resolveSource(layer, sourceId, style);
  const visibility = layer.layout?.visibility ?? 'visible';
  if (visibility !== 'visible' && visibility !== 'none') {
    throw new Error('三维基础样式 visibility 只支持 visible 或 none 常量');
  }
  const minimum = layer.minzoom ?? -Infinity;
  const maximum = layer.maxzoom ?? Infinity;
  if ((layer.minzoom !== undefined && !Number.isFinite(minimum)) ||
    (layer.maxzoom !== undefined && !Number.isFinite(maximum)) || minimum > maximum) {
    throw new Error('图层 minzoom / maxzoom 必须是有效的级别范围');
  }

  const properties = new Map<string, CompiledStyleProperty>();
  compileProperties(layer.type, 'paint', layer.paint ?? {}, PAINT[layer.type], properties);
  compileProperties(layer.type, 'layout', layer.layout ?? {}, LAYOUT[layer.type], properties);
  const filter = compileStyleFilter('filter' in layer ? layer.filter : undefined, layer.id);
  return {
    id: layer.id,
    type: layer.type,
    sourceId,
    source,
    specification: layer,
    images: referencedImages(layer, images),
    zoomDependent: layer.minzoom !== undefined || layer.maxzoom !== undefined || filter.zoomDependent ||
      [...properties.values()].some(property => property.zoomDependent),
    visible: zoom => visibility === 'visible' && zoom >= minimum && zoom < maximum,
    value: (property, zoom, feature) => properties.get(property)?.evaluate(zoom, feature),
    accepts: (zoom, feature) => filter.test(zoom, feature)
  };
}

// 来源替换时不能克隆快照，渲染镜像依靠身份判断是否需要重建
function resolveSource(
  layer: BasicLayerSpecification,
  sourceId: string | undefined,
  style: StyleSpecification
): BasicSource | undefined {
  if (layer.type === 'background') {
    return undefined;
  }
  const source = sourceId === undefined ? undefined : style.sources[sourceId];
  if (!source) {
    throw new Error(`缺少图层数据源：${sourceId ?? ''}`);
  }
  if (source.type !== 'geojson' && source.type !== 'raster' && source.type !== 'vector') {
    throw new Error(`三维基础样式暂不支持 ${source.type} 数据源`);
  }
  if ((layer.type === 'raster') !== (source.type === 'raster')) {
    throw new Error(`${layer.type} 图层与 ${source.type} 数据源不匹配`);
  }
  if (source.type === 'vector') {
    if (!('source-layer' in layer) || typeof layer['source-layer'] !== 'string' || !layer['source-layer']) {
      throw new Error('三维 MVT 图层需要非空 source-layer');
    }
    const promoteId = source.promoteId;
    if (promoteId !== undefined && typeof promoteId !== 'string' &&
      (typeof promoteId !== 'object' || promoteId === null || Array.isArray(promoteId) ||
        Object.values(promoteId).some(value => typeof value !== 'string'))) {
      throw new Error('三维 MVT promoteId 只支持字段名或按源图层指定字段名');
    }
    if (!source.tiles?.length) {
      throw new Error('三维 MVT 数据源需要至少一个 tiles 地址');
    }
  } else if ('source-layer' in layer) {
    throw new Error('只有 MVT 数据源允许 source-layer');
  }
  for (const key of Object.keys(source)) {
    if (!SOURCE_KEYS[source.type].includes(key)) {
      throw new Error(`三维 ${source.type} 数据源暂不支持 ${key}`);
    }
  }
  if (source.type === 'geojson' && (source.data === null ||
    (typeof source.data !== 'object' && (typeof source.data !== 'string' || !source.data)))) {
    throw new Error('三维基础样式需要内联 GeoJSON 或非空 URL');
  }
  if (source.type === 'raster' && !source.tiles?.length) {
    throw new Error('三维栅格数据源需要至少一个 tiles 地址');
  }
  return source;
}

// 只保存花纹输出引用的图片；动态图片名保守依赖全部图片
export function referencedImages(layer: LayerSpecification, images: StyleImages): StyleImages {
  if (layer.type !== 'fill' || layer.paint?.['fill-pattern'] === undefined) { return {}; }
  const names = new Set<string>();
  function collect(value: unknown): boolean {
    if (typeof value === 'string') { names.add(value); return true; }
    if (!Array.isArray(value)) { return false; }
    const operator: unknown = value[0];
    if (operator === 'literal') { return collect(value[1]); }
    if (operator === 'coalesce') { return value.slice(1).every(collect); }
    if (operator === 'step') { return value.filter((_, index) => index >= 2 && index % 2 === 0).every(collect); }
    if (operator === 'match' || operator === 'case') {
      const first = operator === 'match' ? 3 : 2;
      return value.slice(0, -1).filter((_, index) => index >= first && (index - first) % 2 === 0).every(collect) &&
        collect(value.at(-1));
    }
    return false;
  }
  if (!collect(layer.paint['fill-pattern'])) { return images; }
  return Object.fromEntries([...names].map(name => {
    const image = images[name];
    if (!image) { throw new Error(`缺少花纹图片：${name}`); }
    return [name, image];
  }));
}

function compileProperties(
  type: BasicLayerType,
  section: 'paint' | 'layout',
  values: Record<string, unknown>,
  supported: readonly string[],
  compiled: Map<string, CompiledStyleProperty>
): void {
  for (const [property, value] of Object.entries(values)) {
    if (supported.includes(property) || (section === 'layout' && property === 'visibility')) {
      continue;
    }
    if (section === 'paint' && isImmediateTransition(type, property, value)) {
      continue;
    }
    throw new Error(`三维 ${type} 图层暂不支持 ${section}.${property}`);
  }
  for (const property of supported) {
    compiled.set(property, compileStyleProperty(type, property, values[property]));
  }
}

// 仅忽略规范允许且明确关闭动画的过渡；空配置仍包含默认的动画时间
function isImmediateTransition(type: BasicLayerType, property: string, value: unknown): boolean {
  if (!property.endsWith('-transition') || typeof value !== 'object' || value === null) {
    return false;
  }
  const base = property.slice(0, -'-transition'.length);
  const reference: Record<string, unknown> = latest[`paint_${type}`];
  const definition = reference[base];
  if (typeof definition !== 'object' || definition === null ||
    !('transition' in definition) || definition.transition !== true) {
    return false;
  }
  const transition: Record<string, unknown> = { ...value };
  return transition.duration === 0 && (transition.delay === undefined || transition.delay === 0) &&
    Object.keys(transition).every(key => key === 'duration' || key === 'delay');
}
