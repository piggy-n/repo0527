import {
  type CircleLayerSpecification,
  Color,
  expression,
  type Feature as SpecFeature,
  featureFilter,
  type FeatureFilter,
  type FillLayerSpecification,
  latest,
  type LineLayerSpecification,
  type PropertyValueSpecification,
  type StylePropertyExpression,
  type StylePropertySpecification
} from '@maplibre/maplibre-gl-style-spec';
import { simplify } from '@turf/simplify';
import type { GeoJSON, Geometry, GeoJsonProperties, Position } from 'geojson';

/** 三维画的覆盖物图层：对应二维 geojson 数据源上的 line、fill、circle 图层（ADR 0080 第 1 节） */
export type OverlayLayerSpecification = LineLayerSpecification | FillLayerSpecification | CircleLayerSpecification;

/** 一个覆盖物图层和它的数据：data 是地址时由视图下载 */
export interface OverlaySpec {
  readonly layer: OverlayLayerSpecification;
  /** 在样式里的位置，决定贴地的线和面的叠放 */
  readonly order: number;
  readonly sourceId: string;
  readonly data: GeoJSON | string;
}

/** 0～1、没有预乘的颜色，透明度已经乘进去 */
export type RgbaColor = readonly [r: number, g: number, b: number, a: number];

/** 虚线：一个周期的像素长度，和 16 个格子里哪些是实线（第 i 位对应第 i 格） */
export interface DashPattern {
  readonly length: number;
  readonly pattern: number;
}

export interface LineShape {
  readonly kind: 'line';
  readonly path: readonly Position[];
  readonly color: RgbaColor;
  readonly width: number;
  readonly dash: DashPattern | null;
}

export interface PolygonShape {
  readonly kind: 'polygon';
  /** 第一个是外环，其余是洞 */
  readonly rings: readonly (readonly Position[])[];
  readonly color: RgbaColor;
}

export interface PointShape {
  readonly kind: 'point';
  readonly position: Position;
  readonly radius: number;
  readonly color: RgbaColor;
  readonly strokeColor: RgbaColor;
  readonly strokeWidth: number;
}

export type OverlayShape = LineShape | PolygonShape | PointShape;

/** 一个二维图层在三维画出的形状 */
export interface OverlayLayer {
  readonly id: string;
  readonly order: number;
  readonly shapes: readonly OverlayShape[];
}

// 外环跨过这么多经度就是"整个世界"（ADR 0080 第 2 节）
const WORLD_SPAN = 359;
const SAFE_LONGITUDE = 179.9;
const MAX_LATITUDE = 85.051129;
// 收成方框时向四周扩大：至少 5°，或包围盒宽高的 4 倍
const MIN_PADDING = 5;
const PADDING_SCALE = 4;
// 相邻点的经纬度差都小于它时当作重复点
const DUPLICATE_EPSILON = 1e-9;
const DASH_SLOTS = 16;
// 闭合的环最少的点数：三个顶点加上回到起点
const MIN_RING = 4;
// 512 像素瓦片：0 级一个像素是 360 / 512 度
const DEGREES_PER_PIXEL_AT_ZERO = 360 / 512;

/**
 * 简化的容差：这一级的半个像素（度）。Cesium 贴地的线、面按点数建几何，几万个点的边界要好几秒；
 * 简化到半个像素看不出差别，二维的 MapLibre 也按瓦片简化（ADR 0080 第 2 节）
 */
export function simplifyTolerance(level: number): number {
  return DEGREES_PER_PIXEL_AT_ZERO / 2 ** level / 2;
}

/** 按容差简化一条线，首尾保留；不到 3 个点时不变 */
export function simplifyPath(path: readonly Position[], tolerance: number): Position[] {
  if (path.length < 3) {
    return [...path];
  }
  return simplify({ type: 'LineString', coordinates: [...path] }, { tolerance }).coordinates;
}

// 面按环简化，turf 保证每个环仍然是有效的环
function simplifyRings(rings: readonly (readonly Position[])[], tolerance: number): Position[][] {
  return simplify({ type: 'Polygon', coordinates: rings.map(ring => [...ring]) }, { tolerance }).coordinates;
}

/** 去掉不是有限数的点和相邻的重复点（贴地折线遇到重复点会让 Cesium 停止渲染，ADR 0080 第 2 节） */
export function cleanPath(path: readonly Position[]): Position[] {
  const cleaned: Position[] = [];
  let last: Position | undefined;
  for (const point of path) {
    // 按下标取：下载来的数据里坐标的嵌套层数可能不对
    const lng: unknown = point[0];
    const lat: unknown = point[1];
    if (typeof lng !== 'number' || typeof lat !== 'number' || !Number.isFinite(lng) || !Number.isFinite(lat)) {
      continue;
    }
    const repeated =
      last !== undefined &&
      Math.abs(lng - (last[0] ?? 0)) < DUPLICATE_EPSILON &&
      Math.abs(lat - (last[1] ?? 0)) < DUPLICATE_EPSILON;
    if (!repeated) {
      cleaned.push(point);
      last = point;
    }
  }
  return cleaned;
}

interface Box {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

function boxOf(ring: readonly Position[]): Box | null {
  if (ring.length === 0) {
    return null;
  }
  const lngs = ring.map(([lng = 0]) => lng);
  const lats = ring.map(([, lat = 0]) => lat);
  return { west: Math.min(...lngs), south: Math.min(...lats), east: Math.max(...lngs), north: Math.max(...lats) };
}

function boxRing({ west, south, east, north }: Box): Position[] {
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south]
  ];
}

/**
 * 外环横跨整个世界的面（区划遮罩）收成方框：所有洞的包围盒向四周扩大，夹在安全的经纬度范围里。
 * Cesium 处理跨 180° 经线的面时会抛错并停止渲染（ADR 0080 第 2 节）
 */
export function shrinkWorldRing(rings: readonly (readonly Position[])[]): (readonly Position[])[] {
  const [outer, ...holes] = rings;
  const outerBox = outer ? boxOf(outer) : null;
  if (!outerBox || outerBox.east - outerBox.west < WORLD_SPAN) {
    return [...rings];
  }
  const holeBoxes = holes.map(boxOf).filter(box => box !== null);
  if (holeBoxes.length === 0) {
    return [boxRing({ west: -SAFE_LONGITUDE, south: -MAX_LATITUDE, east: SAFE_LONGITUDE, north: MAX_LATITUDE })];
  }
  const merged = holeBoxes.reduce((a, b) => ({
    west: Math.min(a.west, b.west),
    south: Math.min(a.south, b.south),
    east: Math.max(a.east, b.east),
    north: Math.max(a.north, b.north)
  }));
  const padLng = Math.max(MIN_PADDING, (merged.east - merged.west) * PADDING_SCALE);
  const padLat = Math.max(MIN_PADDING, (merged.north - merged.south) * PADDING_SCALE);
  const box = {
    west: Math.max(-SAFE_LONGITUDE, merged.west - padLng),
    south: Math.max(-MAX_LATITUDE, merged.south - padLat),
    east: Math.min(SAFE_LONGITUDE, merged.east + padLng),
    north: Math.min(MAX_LATITUDE, merged.north + padLat)
  };
  return [boxRing(box), ...holes];
}

/**
 * 二维的 line-dasharray 以线宽为单位；换成 Cesium 虚线材质的周期长度和 16 格的实线位（ADR 0080 第 1 节）。
 * 不是成对的虚实或总长为 0 时没有虚线
 */
export function dashPattern(dasharray: readonly number[], width: number): DashPattern | null {
  const total = dasharray.reduce((sum, value) => sum + Math.max(0, value), 0);
  if (dasharray.length < 2 || total <= 0) {
    return null;
  }
  let pattern = 0;
  for (let slot = 0; slot < DASH_SLOTS; slot++) {
    // 格子中点落在第几段：偶数段是实线
    let position = ((slot + 0.5) / DASH_SLOTS) * total;
    let segment = 0;
    while (segment < dasharray.length - 1 && position >= Math.max(0, dasharray[segment] ?? 0)) {
      position -= Math.max(0, dasharray[segment] ?? 0);
      segment++;
    }
    if (segment % 2 === 0) {
      pattern |= 1 << slot;
    }
  }
  return { length: Math.max(4, width * total), pattern };
}

/** line-blur 在三维没有对应的效果：按线宽和模糊的比例降低不透明度，近似光晕（ADR 0080 第 1 节） */
export function blurredOpacity(opacity: number, width: number, blur: number): number {
  return blur > 0 && width > 0 ? (opacity * width) / (width + blur) : opacity;
}

// 编译过的过滤条件和样式属性按图层对象缓存：图层是不可变的常量，推导会频繁重复
interface Compiled {
  readonly filter: FeatureFilter;
  readonly properties: ReadonlyMap<string, StylePropertyExpression>;
}

const compiledLayers = new WeakMap<OverlayLayerSpecification, Compiled>();

// 三维用到的样式属性（ADR 0080 第 1 节的支持清单），其余的不求值
const USED_PAINT: Readonly<Record<OverlayLayerSpecification['type'], readonly string[]>> = {
  line: ['line-color', 'line-width', 'line-opacity', 'line-blur', 'line-dasharray'],
  fill: ['fill-color', 'fill-opacity'],
  circle: [
    'circle-radius',
    'circle-color',
    'circle-opacity',
    'circle-stroke-width',
    'circle-stroke-color',
    'circle-stroke-opacity'
  ]
};

const PAINT_SPECS: Readonly<Record<OverlayLayerSpecification['type'], Readonly<Record<string, object>>>> = {
  line: latest.paint_line,
  fill: latest.paint_fill,
  circle: latest.paint_circle
};

function compile(layer: OverlayLayerSpecification): Compiled {
  const cached = compiledLayers.get(layer);
  if (cached) {
    return cached;
  }
  const specs = PAINT_SPECS[layer.type];
  const paint: Readonly<Record<string, unknown>> = layer.paint ?? {};
  const properties = new Map<string, StylePropertyExpression>();
  for (const name of USED_PAINT[layer.type]) {
    // latest 的类型由规范的 JSON 推断，字段是宽的 string，和 StylePropertySpecification 对不上
    const specification = specs[name] as StylePropertySpecification | undefined;
    if (!specification) {
      continue;
    }
    // 没写的属性用规范里的默认值
    const value = name in paint ? paint[name] : specification.default;
    if (value === undefined) {
      continue;
    }
    try {
      // 样式的写法由 style-spec 自己校验，这里只把形状交给它
      const input = value as PropertyValueSpecification<unknown>;
      properties.set(name, expression.normalizePropertyExpression(input, `${layer.id}.${name}`, specification));
    } catch {
      // 写错的属性不画进三维，按调用方给的默认值，不影响其他属性和图层
    }
  }
  const compiled: Compiled = { filter: featureFilter(layer.filter, `${layer.id}.filter`), properties };
  compiledLayers.set(layer, compiled);
  return compiled;
}

interface FlatFeature {
  readonly geometry: Exclude<Geometry, { type: 'GeometryCollection' }>;
  readonly properties: GeoJsonProperties;
  readonly id?: string | number;
}

function flattenGeometry(
  geometry: Geometry | null,
  properties: GeoJsonProperties,
  id: string | number | undefined,
  out: FlatFeature[]
): void {
  if (!geometry) {
    return;
  }
  if (geometry.type === 'GeometryCollection') {
    for (const part of geometry.geometries) {
      flattenGeometry(part, properties, id, out);
    }
    return;
  }
  out.push({ geometry, properties, ...(id === undefined ? {} : { id }) });
}

function featuresOf(data: GeoJSON): FlatFeature[] {
  const out: FlatFeature[] = [];
  if (data.type === 'FeatureCollection') {
    for (const feature of data.features) {
      flattenGeometry(feature.geometry, feature.properties, feature.id, out);
    }
  } else if (data.type === 'Feature') {
    flattenGeometry(data.geometry, data.properties, data.id, out);
  } else {
    flattenGeometry(data, null, undefined, out);
  }
  return out;
}

class LayerEvaluator {
  readonly #compiled: Compiled;
  readonly #zoom: number;
  /** 这一级的简化容差 */
  readonly tolerance: number;

  constructor(layer: OverlayLayerSpecification, zoom: number) {
    this.#compiled = compile(layer);
    this.#zoom = zoom;
    this.tolerance = simplifyTolerance(zoom);
  }

  accepts(feature: SpecFeature): boolean {
    return this.#compiled.filter.filter({ zoom: this.#zoom }, feature);
  }

  number(name: string, feature: SpecFeature, fallback: number): number {
    const value: unknown = this.#compiled.properties.get(name)?.evaluate({ zoom: this.#zoom }, feature);
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  }

  numbers(name: string, feature: SpecFeature): readonly number[] | null {
    const value: unknown = this.#compiled.properties.get(name)?.evaluate({ zoom: this.#zoom }, feature);
    return Array.isArray(value) && value.every(item => typeof item === 'number') ? value : null;
  }

  // 透明度乘进 alpha
  color(name: string, feature: SpecFeature, opacity: number): RgbaColor {
    const value: unknown = this.#compiled.properties.get(name)?.evaluate({ zoom: this.#zoom }, feature);
    const [r, g, b, a] = value instanceof Color ? value.rgb : [0, 0, 0, 1];
    return [r, g, b, a * Math.min(1, Math.max(0, opacity))];
  }
}

function specFeature({ geometry, properties, id }: FlatFeature): SpecFeature {
  return { type: geometry.type, properties: properties ?? {}, ...(id === undefined ? {} : { id }) };
}

function polygonsOf(geometry: FlatFeature['geometry']): readonly Position[][][] {
  if (geometry.type === 'Polygon') {
    return [geometry.coordinates];
  }
  return geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
}

// 线图层画线要素，也画面的每个环（和二维一样）
function pathsOf(geometry: FlatFeature['geometry']): readonly Position[][] {
  if (geometry.type === 'LineString') {
    return [geometry.coordinates];
  }
  if (geometry.type === 'MultiLineString' || geometry.type === 'Polygon') {
    return geometry.coordinates;
  }
  return geometry.type === 'MultiPolygon' ? geometry.coordinates.flat() : [];
}

// 圆点图层只画点要素
function pointsOf(geometry: FlatFeature['geometry']): readonly Position[] {
  if (geometry.type === 'Point') {
    return [geometry.coordinates];
  }
  return geometry.type === 'MultiPoint' ? geometry.coordinates : [];
}

function lineShapes(evaluator: LayerEvaluator, feature: FlatFeature, out: OverlayShape[]): void {
  const target = specFeature(feature);
  const width = evaluator.number('line-width', target, 1);
  const blur = evaluator.number('line-blur', target, 0);
  const opacity = blurredOpacity(evaluator.number('line-opacity', target, 1), width, blur);
  if (width <= 0 || opacity <= 0) {
    return;
  }
  const color = evaluator.color('line-color', target, opacity);
  const dasharray = evaluator.numbers('line-dasharray', target);
  const dash = dasharray ? dashPattern(dasharray, width) : null;
  for (const path of pathsOf(feature.geometry)) {
    const cleaned = simplifyPath(cleanPath(path), evaluator.tolerance);
    if (cleaned.length >= 2) {
      out.push({ kind: 'line', path: cleaned, color, width, dash });
    }
  }
}

function polygonShapes(evaluator: LayerEvaluator, feature: FlatFeature, out: OverlayShape[]): void {
  const target = specFeature(feature);
  const opacity = evaluator.number('fill-opacity', target, 1);
  if (opacity <= 0) {
    return;
  }
  const color = evaluator.color('fill-color', target, opacity);
  for (const polygon of polygonsOf(feature.geometry)) {
    // 闭合的环至少 4 个点：外环不够时整个面不画，不够的洞丢掉
    const [outer, ...holes] = shrinkWorldRing(polygon.map(cleanPath));
    if (!outer || outer.length < MIN_RING) {
      continue;
    }
    const rings = [outer, ...holes.filter(ring => ring.length >= MIN_RING)];
    out.push({ kind: 'polygon', rings: simplifyRings(rings, evaluator.tolerance), color });
  }
}

function pointShapes(evaluator: LayerEvaluator, feature: FlatFeature, out: OverlayShape[]): void {
  const target = specFeature(feature);
  const radius = evaluator.number('circle-radius', target, 5);
  const opacity = evaluator.number('circle-opacity', target, 1);
  const strokeWidth = evaluator.number('circle-stroke-width', target, 0);
  if (radius <= 0 && strokeWidth <= 0) {
    return;
  }
  const color = evaluator.color('circle-color', target, opacity);
  const strokeOpacity = evaluator.number('circle-stroke-opacity', target, 1);
  const strokeColor = evaluator.color('circle-stroke-color', target, strokeOpacity);
  for (const position of cleanPath(pointsOf(feature.geometry))) {
    out.push({ kind: 'point', position, radius, color, strokeColor, strokeWidth });
  }
}

// 图层、数据、级别和位置都没变时给出上次的结果：会话里没变的分组保留原来的图层对象，
// 场景按对象判断哪些图层要重画，测量画线时别的覆盖物不重建
interface Planned {
  readonly data: GeoJSON;
  readonly level: number;
  readonly order: number;
  readonly result: OverlayLayer;
}

const plannedLayers = new WeakMap<OverlayLayerSpecification, Planned>();

function planLayer(spec: OverlaySpec, data: GeoJSON, level: number): OverlayLayer {
  const previous = plannedLayers.get(spec.layer);
  if (previous && previous.data === data && previous.level === level && previous.order === spec.order) {
    return previous.result;
  }
  const evaluator = new LayerEvaluator(spec.layer, level);
  const shapes: OverlayShape[] = [];
  for (const feature of featuresOf(data)) {
    if (!evaluator.accepts(specFeature(feature))) {
      continue;
    }
    if (spec.layer.type === 'line') {
      lineShapes(evaluator, feature, shapes);
    } else if (spec.layer.type === 'fill') {
      polygonShapes(evaluator, feature, shapes);
    } else {
      pointShapes(evaluator, feature, shapes);
    }
  }
  const result: OverlayLayer = { id: spec.layer.id, order: spec.order, shapes };
  plannedLayers.set(spec.layer, { data, level, order: spec.order, result });
  return result;
}

function visibleAt(layer: OverlayLayerSpecification, zoom: number): boolean {
  if (layer.layout?.visibility === 'none') {
    return false;
  }
  return zoom >= (layer.minzoom ?? 0) && zoom < (layer.maxzoom ?? Number.POSITIVE_INFINITY);
}

/**
 * 推导覆盖物在三维画出的形状（ADR 0080 第 1 节）：按整数级别求值样式和过滤条件。
 * resolve 给出数据源的数据，还没下载完的返回 undefined，这个图层这次不画
 */
export function planOverlays(
  specs: readonly OverlaySpec[],
  resolve: (spec: OverlaySpec) => GeoJSON | undefined,
  zoom: number
): OverlayLayer[] {
  const level = Math.round(zoom);
  const layers: OverlayLayer[] = [];
  for (const spec of specs) {
    const data = visibleAt(spec.layer, level) ? resolve(spec) : undefined;
    if (data) {
      layers.push(planLayer(spec, data, level));
    }
  }
  return layers;
}

const GEOJSON_TYPES: ReadonlySet<unknown> = new Set([
  'FeatureCollection',
  'Feature',
  'Point',
  'MultiPoint',
  'LineString',
  'MultiLineString',
  'Polygon',
  'MultiPolygon',
  'GeometryCollection'
]);

/** 下载到的数据是不是 GeoJSON：看顶层的 type 和要素、几何的结构，坐标在推导时清理 */
export function isGeoJson(value: unknown): value is GeoJSON {
  if (typeof value !== 'object' || value === null || !('type' in value) || !GEOJSON_TYPES.has(value.type)) {
    return false;
  }
  if (value.type === 'FeatureCollection') {
    return 'features' in value && Array.isArray(value.features) && value.features.every(isGeoJson);
  }
  if (value.type === 'Feature') {
    return 'geometry' in value && (value.geometry === null || isGeoJson(value.geometry));
  }
  if (value.type === 'GeometryCollection') {
    return 'geometries' in value && Array.isArray(value.geometries) && value.geometries.every(isGeoJson);
  }
  return 'coordinates' in value && Array.isArray(value.coordinates);
}
