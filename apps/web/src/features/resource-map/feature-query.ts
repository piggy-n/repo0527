import { bbox } from '@turf/bbox';
import type { Geometry, MultiPolygon, Point, Polygon, Position } from 'geojson';
import type {
  LngLat,
  PickResult,
  RenderedFeature,
  ScreenBox,
  ScreenPoint,
  ToolView,
  ViewBounds,
  ViewKind
} from '@yzt/map-core';
import { lngLatAt, pixelSizeAt, queryGeometry, screenBoxPolygon } from '@/shared/map/query-geometry';
import { clipToScope, intersectsScope, type RegionScope, scopeContains } from '@/shared/map/region/region-scope';
import { type FeatureRecord, isFeatureGuid } from './api';
import type { Resource, ResourceGeometry } from './catalog';
import { LANDUSE_FIELD_LABELS } from './landuse';
import { isResourceBodyLayer, type ResourceLayersState, resourceSourceId } from './resource-layers';
import { resourceStyle, tilesetOf } from './style-registry';

// 点选与详情的纯函数（ADR 0047 第 1～3 节、ADR 0048）：识别的顺序、方式和候选，详情的标题和字段行

/** 后端查询的两种能力，各自判断（ADR 0048 第 1 节） */
export interface QueryCapability {
  /** 后端范围识别：分页结果带 guid */
  readonly identify: boolean;
  /** 按 guid 查属性和完整几何 */
  readonly detail: boolean;
}

// 分页结果带 guid 的数据集，逐个实测登记（2026-10-14，年份见 docs/migration.md）；没有登记的不做后端范围识别
const IDENTIFIABLE: ReadonlySet<string> = new Set([
  'bgdc_dltb',
  'bgdc_dltb_czc',
  'bgdc_czcdyd',
  'csxhjctb_hydl',
  'csxhjctb_lvll'
]);

// 按 guid 查详情按前缀；其他数据集（szy_、lcsh_、gtkjgh_）的查询接口返回"系统异常"
const DETAIL_PREFIXES: readonly string[] = ['bgdc_', 'csxhjctb_'];

export function queryCapabilityOf(code: string): QueryCapability {
  return { identify: IDENTIFIABLE.has(code), detail: DETAIL_PREFIXES.some(prefix => code.startsWith(prefix)) };
}

/** 渲染要素的查询容差（屏幕像素）：面只取包含点击位置的，线、点同旧项目 */
export const PICK_TOLERANCES: Readonly<Record<ResourceGeometry, number>> = { fill: 0, line: 8, circle: 10 };

/** 二维这一级及以上只用渲染要素，不查后端 */
export const RENDERED_PICK_ZOOM = 14;

/** 后端识别每页的条数 */
export const PICK_PAGE_SIZE = 30;

/** 框选时估数的拒绝阈值：框里的渲染要素去重后超过它时提示缩小范围，不请求后端（ADR 0049 第 2 节） */
export const BOX_ESTIMATE_LIMIT = 5000;

/** 参与识别的资源 */
export interface PickResource {
  readonly resource: Resource;
  readonly year: number;
  readonly sourceId: string;
  /** 查询接口的图层编码，同瓦片集名 */
  readonly layerCode: string;
}

/** 参与识别的资源，从上到下：勾选、当前级别显示、没被校验拦下的 */
export function pickResources(
  state: ResourceLayersState,
  invalid: ReadonlyMap<string, unknown>,
  zoom: number
): PickResource[] {
  return state.order.flatMap(code => {
    const resource = state.catalog?.resources.get(code);
    const display = state.displays.get(code);
    if (!resource || !display?.checked || invalid.has(code) || zoom < (resourceStyle(code).minzoom ?? 0)) {
      return [];
    }
    const layerCode = tilesetOf(code, display.year);
    return [{ resource, year: display.year, sourceId: resourceSourceId(code), layerCode }];
  });
}

/** 一个候选要素：属性来自渲染要素（瓦片）或后端的范围查询 */
export interface PickCandidate {
  /** 数据源和 guid，同一个要素只有一个 */
  readonly key: string;
  readonly target: PickResource;
  readonly guid: string;
  readonly properties: Readonly<FeatureRecord>;
  readonly origin: 'rendered' | 'server';
  /** 到点击位置的屏幕距离（像素）；后端结果没有几何，记为 0 */
  readonly distance: number;
}

function candidate(
  target: PickResource,
  guid: string,
  properties: Readonly<FeatureRecord>,
  origin: PickCandidate['origin'],
  distance: number
): PickCandidate {
  return { key: JSON.stringify([target.sourceId, guid]), target, guid, properties, origin, distance };
}

/** 这个资源的渲染要素：按 guid 去重、留下最近的，按距离从近到远（同样近的保持从上到下）；没有 guid 的不算 */
export function renderedCandidates(
  target: PickResource,
  features: readonly RenderedFeature[],
  distanceOf: (geometry: Geometry | undefined) => number
): PickCandidate[] {
  const nearest = new Map<string, PickCandidate>();
  for (const { sourceId, properties, geometry } of features) {
    const { guid } = properties;
    if (sourceId !== target.sourceId || !isFeatureGuid(guid)) {
      continue;
    }
    const distance = distanceOf(geometry);
    const previous = nearest.get(guid);
    if (!previous || distance < previous.distance) {
      nearest.set(guid, candidate(target, guid, properties, 'rendered', distance));
    }
  }
  return [...nearest.values()].toSorted((a, b) => a.distance - b.distance);
}

/** 后端范围识别的结果，按返回的顺序；没有 guid 的记录不算，重复的只留第一条 */
export function serverCandidates(target: PickResource, records: readonly FeatureRecord[]): PickCandidate[] {
  const unique = new Map<string, PickCandidate>();
  for (const record of records) {
    const { guid } = record;
    if (isFeatureGuid(guid) && !unique.has(guid)) {
      unique.set(guid, candidate(target, guid, record, 'server', 0));
    }
  }
  return [...unique.values()];
}

/** 识别一个资源的方式（ADR 0048 第 2 节） */
export type IdentifyStep =
  | { readonly kind: 'rendered'; readonly candidates: readonly PickCandidate[] }
  | { readonly kind: 'server' }
  | { readonly kind: 'none' };

// 查不查后端：二维 14 级以上只用渲染要素；三维（没有渲染要素）和低级别下能后端识别的查后端
function usesBackend(capability: QueryCapability, view: ViewKind, zoom: number): boolean {
  return capability.identify && !(view === '2d' && zoom >= RENDERED_PICK_ZOOM);
}

/** 查后端的资源用后端识别；其他的有渲染要素就用，没有就跳过这个资源 */
export function identifyStep(
  capability: QueryCapability,
  view: ViewKind,
  zoom: number,
  rendered: readonly PickCandidate[]
): IdentifyStep {
  if (usesBackend(capability, view, zoom)) {
    return { kind: 'server' };
  }
  return rendered.length > 0 ? { kind: 'rendered', candidates: rendered } : { kind: 'none' };
}

/** 后端范围识别用的地理范围：点击位置、容差框或框，有区划范围时是和区划求交后整理过的几何 */
export type QueryArea = Point | Polygon | MultiPolygon;

/**
 * 识别一个资源要做的事：渲染要素已经取到，或者用这个地理范围查后端；有区划范围时，查后端的几何整理不出来
 * （顶点太多、简化后无效）是"范围太复杂"，不请求后端（ADR 0051 第 4 节）
 */
export type IdentifyTask =
  | { readonly kind: 'rendered'; readonly target: PickResource; readonly candidates: readonly PickCandidate[] }
  | { readonly kind: 'server'; readonly target: PickResource; readonly geometry: QueryArea }
  | { readonly kind: 'too-complex'; readonly target: PickResource };

// 以点击位置为中心的容差框
function toleranceBox({ x, y }: ScreenPoint, tolerance: number): ScreenBox {
  return { from: { x: x - tolerance, y: y - tolerance }, to: { x: x + tolerance, y: y + tolerance } };
}

// 渲染要素的查询范围：面是点击位置，线、点是容差框
function renderedArea(point: ScreenPoint, tolerance: number): ScreenPoint | ScreenBox {
  return tolerance === 0 ? point : toleranceBox(point, tolerance);
}

// 只留几何和范围相交的渲染要素；没有范围时原样（ADR 0051 第 3 节）。在转换成候选、按 guid 去重之前过滤，
// 同一个 guid 被瓦片切成的几段里有一段相交就留下
function withinScope(features: readonly RenderedFeature[], area: RegionScope | null): readonly RenderedFeature[] {
  return area ? features.filter(({ geometry }) => geometry !== undefined && intersectsScope(geometry, area)) : features;
}

// 查后端的任务：有区划范围时，容差框、框换成和区划求交并整理过的几何，整理不出来时是"范围太复杂"；
// 点击位置的点在区划里，原样使用。几何对所有资源都一样，由调用方只整理一次
function serverTask(
  target: PickResource,
  geometry: Point | Polygon,
  prepared: (() => RegionScope | null) | null
): IdentifyTask {
  if (!prepared || geometry.type === 'Point') {
    return { kind: 'server', target, geometry };
  }
  const area = prepared();
  return area ? { kind: 'server', target, geometry: area } : { kind: 'too-complex', target };
}

// 只算一次的值
function once<T>(compute: () => T): () => T {
  let cached: { readonly value: T } | null = null;
  return () => (cached ??= { value: compute() }).value;
}

// 一种几何类型（容差由它决定）在一次点选里的范围：同类型的资源共用，求交、整理只算一次
interface ClickArea {
  /** 和区划求交的范围；没有区划范围时为 null */
  readonly area: RegionScope | null;
  /** 查后端的几何：点击位置或容差框，拾取不到时为 null */
  readonly geometry: () => Point | Polygon | null;
  /** 和区划求交后整理过的几何（ADR 0051 第 4 节） */
  readonly prepared: (() => RegionScope | null) | null;
}

/**
 * 点击时就定下每个资源怎样识别（ADR 0047、0048 第 2 节）：屏幕上的查询、拾取都在这里同步做完，之后查后端只用地理范围，
 * 地图移动不影响结果。资源从上到下，遇到渲染要素的结果或范围太复杂时停下（下面的资源不会用到，同框选）；
 * 既没有渲染要素、又不能查后端或拾取不到范围的资源不在结果里。
 * 有区划范围时（ADR 0051 第 3 节）：点击位置不在区划里为 null，不识别；线、点的容差框先和区划求交
 */
export function planIdentify(
  targets: readonly PickResource[],
  point: ScreenPoint,
  zoom: number,
  view: Pick<ToolView, 'kind' | 'pick' | 'project' | 'queryRendered'>
): IdentifyTask[];
export function planIdentify(
  targets: readonly PickResource[],
  point: ScreenPoint,
  zoom: number,
  view: Pick<ToolView, 'kind' | 'pick' | 'project' | 'queryRendered'>,
  scope: RegionScope | null
): IdentifyTask[] | null;
export function planIdentify(
  targets: readonly PickResource[],
  point: ScreenPoint,
  zoom: number,
  view: Pick<ToolView, 'kind' | 'pick' | 'project' | 'queryRendered'>,
  scope: RegionScope | null = null
): IdentifyTask[] | null {
  const pick = (at: ScreenPoint) => view.pick(at);
  const clicked = pick(point);
  if (scope && (clicked.kind !== 'hit' || !scopeContains(scope, clicked.lngLat))) {
    return null;
  }
  const pixelSize = once(() => pixelSizeAt(point, pick));
  const areas = new Map<ResourceGeometry, ClickArea>();
  const areaOf = (type: ResourceGeometry): ClickArea => {
    const cached = areas.get(type);
    if (cached) {
      return cached;
    }
    const tolerance = PICK_TOLERANCES[type];
    // 求交范围：面只取包含点击位置的，点击位置在区划里，用整个区划过滤；线、点用容差框和区划的交集
    const square = tolerance > 0 ? screenBoxPolygon(toleranceBox(point, tolerance), pick) : null;
    const area = scope && (tolerance === 0 ? scope : square && clipToScope(square, scope));
    const created: ClickArea = {
      area,
      geometry: once(() => identifyGeometry(type, point, pick)),
      prepared: area && once(() => queryGeometry(area, pixelSize()))
    };
    areas.set(type, created);
    return created;
  };
  const tasks: IdentifyTask[] = [];
  for (const target of targets) {
    const { geometry: type, code } = target.resource;
    const tolerance = PICK_TOLERANCES[type];
    const { area, geometry, prepared } = areaOf(type);
    if (scope && !area) {
      continue;
    }
    // 面的距离都是 0，没有范围时不用换算几何
    const features = view.queryRendered(renderedArea(point, tolerance), {
      sources: [target.sourceId],
      withGeometry: tolerance > 0 || area !== null
    });
    const rendered = renderedCandidates(target, withinScope(features, area), shape =>
      screenDistance(shape, point, lngLat => view.project(lngLat))
    );
    const server = identifyStep(queryCapabilityOf(code), view.kind, zoom, rendered).kind === 'server' && geometry();
    if (server) {
      const task = serverTask(target, server, prepared);
      tasks.push(task);
      if (task.kind === 'too-complex') {
        return tasks;
      }
      continue;
    }
    // 用渲染要素；后端识别拾取不到范围时也退回渲染要素
    if (rendered.length > 0) {
      tasks.push({ kind: 'rendered', target, candidates: rendered });
      return tasks;
    }
  }
  return tasks;
}

/** 后端识别用的范围：面用点击位置（只返回包含它的面），线、点用容差框四角拾取到的多边形；拾取不到时为 null */
export function identifyGeometry(
  geometry: ResourceGeometry,
  point: ScreenPoint,
  pick: (point: ScreenPoint) => PickResult
): Point | Polygon | null {
  const tolerance = PICK_TOLERANCES[geometry];
  if (tolerance === 0) {
    const center = lngLatAt(pick, point);
    return center ? { type: 'Point', coordinates: center } : null;
  }
  return screenBoxPolygon(toleranceBox(point, tolerance), pick);
}

/**
 * 查后端的资源框里大约有多少要素（ADR 0050 第 2 节）：只数画出要素本身的图层；带 guid 的去重，
 * 聚合要素按 point_count，其他不带 guid 的按个数（被瓦片切开的会多算）
 */
export function weightedEstimate(code: string, features: readonly RenderedFeature[]): number {
  const guids = new Set<string>();
  let others = 0;
  for (const { layerId, properties } of features) {
    if (!isResourceBodyLayer(code, layerId)) {
      continue;
    }
    const { guid, clustered, point_count: pointCount } = properties;
    if (isFeatureGuid(guid)) {
      guids.add(guid);
    } else {
      others += clustered === true && typeof pointCount === 'number' && pointCount > 0 ? pointCount : 1;
    }
  }
  return guids.size + others;
}

/** 框选一个资源要做的事：同点选；超过估数的上限时提示缩小范围 */
export type BoxTask =
  | IdentifyTask
  | { readonly kind: 'too-many'; readonly target: PickResource; readonly estimate: number };

// 范围在屏幕上的外包框；有顶点投影不到时为 null
function screenBounds(area: RegionScope, project: (lngLat: LngLat) => ScreenPoint | null): ScreenBox | null {
  const positions = (area.type === 'Polygon' ? [area.coordinates] : area.coordinates).flat(2);
  const points = positions.map(([lng = 0, lat = 0]) => project([lng, lat]));
  if (points.some(point => point === null)) {
    return null;
  }
  const xs = points.map(point => point?.x ?? 0);
  const ys = points.map(point => point?.y ?? 0);
  return { from: { x: Math.min(...xs), y: Math.min(...ys) }, to: { x: Math.max(...xs), y: Math.max(...ys) } };
}

/**
 * 松手时定下框选怎样识别（ADR 0049 第 2 节、ADR 0050 第 1 节）：资源从上到下，识别方式同点选，先定方式再计数。
 * 查后端的资源用加权估数；只用渲染要素的按有效 guid 计数，为 0 时跳过。遇到渲染要素的结果、超过估数的上限
 * 或范围太复杂时停下。有区划范围时（ADR 0051 第 3 节）：框先和区划求交，框整个在区划外时为 null，不识别；
 * 渲染要素只留和求交范围相交的，估数只数求交范围在屏幕上的外包框里的
 */
export function planBox(
  targets: readonly PickResource[],
  box: ScreenBox,
  zoom: number,
  view: Pick<ToolView, 'kind' | 'pick' | 'project' | 'queryRendered'>
): BoxTask[];
export function planBox(
  targets: readonly PickResource[],
  box: ScreenBox,
  zoom: number,
  view: Pick<ToolView, 'kind' | 'pick' | 'project' | 'queryRendered'>,
  scope: RegionScope | null
): BoxTask[] | null;
export function planBox(
  targets: readonly PickResource[],
  box: ScreenBox,
  zoom: number,
  view: Pick<ToolView, 'kind' | 'pick' | 'project' | 'queryRendered'>,
  scope: RegionScope | null = null
): BoxTask[] | null {
  const pick = (at: ScreenPoint) => view.pick(at);
  const polygon = screenBoxPolygon(box, pick);
  const area = scope && polygon && clipToScope(polygon, scope);
  if (scope && !area) {
    return null;
  }
  const estimateArea = (area && screenBounds(area, lngLat => view.project(lngLat))) ?? box;
  const center = { x: (box.from.x + box.to.x) / 2, y: (box.from.y + box.to.y) / 2 };
  const prepared = area && once(() => queryGeometry(area, pixelSizeAt(center, pick)));
  const tasks: BoxTask[] = [];
  for (const target of targets) {
    const { code } = target.resource;
    const sources = [target.sourceId];
    if (usesBackend(queryCapabilityOf(code), view.kind, zoom)) {
      const estimate = weightedEstimate(code, view.queryRendered(estimateArea, { sources }));
      if (estimate > BOX_ESTIMATE_LIMIT) {
        tasks.push({ kind: 'too-many', target, estimate });
        return tasks;
      }
      if (polygon) {
        const task = serverTask(target, polygon, prepared);
        tasks.push(task);
        if (task.kind === 'too-complex') {
          return tasks;
        }
        continue;
      }
    }
    // 只用渲染要素（后端识别拾取不到范围时也退回这里）：能列出的候选按有效 guid 计数，列不出的不占额度
    const features = withinScope(view.queryRendered(box, { sources, withGeometry: area !== null }), area);
    const count = new Set(features.flatMap(({ properties: { guid } }) => (isFeatureGuid(guid) ? [guid] : []))).size;
    if (count > BOX_ESTIMATE_LIMIT) {
      tasks.push({ kind: 'too-many', target, estimate: count });
      return tasks;
    }
    if (count > 0) {
      // 框选不按距离排序，保持查询结果从上到下的顺序
      tasks.push({ kind: 'rendered', target, candidates: renderedCandidates(target, features, () => 0) });
      return tasks;
    }
  }
  return tasks;
}

// 点到线段的距离
function segmentDistance(point: ScreenPoint, a: ScreenPoint, b: ScreenPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const ratio = length === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length));
  return Math.hypot(point.x - a.x - ratio * dx, point.y - a.y - ratio * dy);
}

/**
 * 渲染几何到点击位置的屏幕距离：面为 0（面只查包含点击位置的），线取到各线段的最短距离，点取到点的距离；
 * 没有几何、投影不到时为无穷大
 */
export function screenDistance(
  geometry: Geometry | undefined,
  point: ScreenPoint,
  project: (lngLat: LngLat) => ScreenPoint | null
): number {
  const projectPosition = ([lng, lat]: Position): ScreenPoint | null =>
    lng === undefined || lat === undefined ? null : project([lng, lat]);
  const toPoint = (position: Position) => {
    const projected = projectPosition(position);
    return projected ? Math.hypot(projected.x - point.x, projected.y - point.y) : Infinity;
  };
  const toLine = (line: readonly Position[]) => {
    const projected = line.map(projectPosition);
    let nearest = Infinity;
    for (let index = 1; index < projected.length; index++) {
      const a = projected[index - 1];
      const b = projected[index];
      if (a && b) {
        nearest = Math.min(nearest, segmentDistance(point, a, b));
      }
    }
    return nearest;
  };
  if (!geometry) {
    return Infinity;
  }
  switch (geometry.type) {
    case 'Polygon':
    case 'MultiPolygon':
      return 0;
    case 'Point':
      return toPoint(geometry.coordinates);
    case 'MultiPoint':
      return Math.min(Infinity, ...geometry.coordinates.map(toPoint));
    case 'LineString':
      return toLine(geometry.coordinates);
    case 'MultiLineString':
      return Math.min(Infinity, ...geometry.coordinates.map(toLine));
    case 'GeometryCollection':
      break;
  }
  return Math.min(Infinity, ...geometry.geometries.map(part => screenDistance(part, point, project)));
}

/** 定位用的外包范围 */
export function featureBounds(geometry: Geometry): ViewBounds {
  // 查询结果没有 bbox 属性，坐标只取前两维，结果总是四个数
  const [west, south, east, north] = bbox(geometry, { recompute: true });
  return [west, south, east, north];
}

// 地类图斑（含城镇村）
function isLanduse(code: string): boolean {
  const kind = resourceStyle(code).color?.kind;
  return kind === 'landuse-code' || kind === 'landuse-name';
}

// 后端用来占位的"没有值"（城市现状数据的大多数字段是 -9999）
const PLACEHOLDERS: ReadonlySet<unknown> = new Set([null, undefined, '', -9999, '-9999', -999, '-999']);

/** 字段没有值：null、空字符串和 -9999、-999 这类占位值；"-" 可能有意义（如无变化），不算 */
export function isEmptyValue(value: unknown): boolean {
  return PLACEHOLDERS.has(value);
}

// 名称、分类按资源取哪些字段，按顺序取第一个有值的（设计稿 5D.6）
function labelFieldsOf(code: string): { readonly name: readonly string[]; readonly category: readonly string[] } {
  if (isLanduse(code)) {
    return { name: ['dlmc'], category: ['dlbm'] };
  }
  if (code.startsWith('csxhjctb_')) {
    return { name: ['name', 'ccn'], category: ['type', 'ccn'] };
  }
  return { name: ['zldwmc', 'name'], category: [] };
}

// 字段编码大小写不敏感，同字段行的中文名
function firstText(properties: Readonly<FeatureRecord>, keys: readonly string[]): string | null {
  const values = new Map(Object.entries(properties).map(([key, value]) => [key.toLowerCase(), value]));
  for (const key of keys) {
    const value = values.get(key);
    if ((typeof value === 'string' || typeof value === 'number') && !isEmptyValue(value)) {
      return String(value);
    }
  }
  return null;
}

/** 要素的名称和分类 */
export interface FeatureLabel {
  /** 名称字段都没有值时为 null */
  readonly name: string | null;
  /** 候选列表里帮着区分重名的要素；和名称相同时为 null */
  readonly category: string | null;
}

/** 名称：地类取地类名称，城市现状数据取 name、没有时取分类名称，其他取坐落单位名称或 name；分类：地类编码，城市现状数据的 type 或分类名称 */
export function featureLabel(code: string, properties: Readonly<FeatureRecord>): FeatureLabel {
  const fields = labelFieldsOf(code);
  const name = firstText(properties, fields.name);
  const category = firstText(properties, fields.category);
  return { name, category: category === name ? null : category };
}

/** 详情的一行 */
export interface FeatureRow {
  readonly key: string;
  /** 字段名表里没有时为 null，显示字段编码 */
  readonly label: string | null;
  /** 没有值时为 null */
  readonly value: string | null;
}

/** 详情的字段：有值的和没有值的分开，各自按接口返回的顺序 */
export interface FeatureRows {
  readonly filled: readonly FeatureRow[];
  readonly empty: readonly FeatureRow[];
}

// 主键和几何不在详情里列出
const HIDDEN_FIELDS = new Set(['guid', 'geom', 'geometry']);

/** 详情的字段行：字段名按三调的字段名表（大小写不敏感），所有资源都用；没有值的另放一组 */
export function featureRows(properties: Readonly<FeatureRecord>): FeatureRows {
  const filled: FeatureRow[] = [];
  const empty: FeatureRow[] = [];
  for (const [key, value] of Object.entries(properties)) {
    if (HIDDEN_FIELDS.has(key.toLowerCase())) {
      continue;
    }
    const label = LANDUSE_FIELD_LABELS[key.toUpperCase()] ?? null;
    if (isEmptyValue(value)) {
      empty.push({ key, label, value: null });
    } else {
      filled.push({ key, label, value: typeof value === 'string' ? value : JSON.stringify(value) });
    }
  }
  return { filled, empty };
}
