import { bbox } from '@turf/bbox';
import type { Geometry, Point, Polygon, Position } from 'geojson';
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
import { type FeatureRecord, isFeatureGuid } from './api';
import type { Resource, ResourceGeometry } from './catalog';
import { LANDUSE_FIELD_LABELS } from './landuse';
import { type ResourceLayersState, resourceSourceId } from './resource-layers';
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

/**
 * 二维 14 级以上只用渲染要素，没有就跳过这个资源；三维（没有渲染要素）和低级别下能后端识别的查后端，
 * 其他有渲染要素就用
 */
export function identifyStep(
  capability: QueryCapability,
  view: ViewKind,
  zoom: number,
  rendered: readonly PickCandidate[]
): IdentifyStep {
  const fromRendered: IdentifyStep =
    rendered.length > 0 ? { kind: 'rendered', candidates: rendered } : { kind: 'none' };
  if (view === '2d' && zoom >= RENDERED_PICK_ZOOM) {
    return fromRendered;
  }
  return capability.identify ? { kind: 'server' } : fromRendered;
}

/** 识别一个资源要做的事：渲染要素已经取到，或者用这个地理范围查后端 */
export type IdentifyTask =
  | { readonly kind: 'rendered'; readonly target: PickResource; readonly candidates: readonly PickCandidate[] }
  | { readonly kind: 'server'; readonly target: PickResource; readonly geometry: Point | Polygon };

// 渲染要素的查询范围：面是点击位置，线、点是容差框
function renderedArea(point: ScreenPoint, tolerance: number): ScreenPoint | ScreenBox {
  if (tolerance === 0) {
    return point;
  }
  const { x, y } = point;
  return { from: { x: x - tolerance, y: y - tolerance }, to: { x: x + tolerance, y: y + tolerance } };
}

/**
 * 点击时就定下每个资源怎样识别（ADR 0047、0048 第 2 节）：屏幕上的查询、拾取都在这里同步做完，之后查后端只用地理范围，
 * 地图移动不影响结果。既没有渲染要素、又不能查后端或拾取不到范围的资源不在结果里
 */
export function planIdentify(
  targets: readonly PickResource[],
  point: ScreenPoint,
  zoom: number,
  view: Pick<ToolView, 'kind' | 'pick' | 'project' | 'queryRendered'>
): IdentifyTask[] {
  return targets.flatMap((target): IdentifyTask[] => {
    const tolerance = PICK_TOLERANCES[target.resource.geometry];
    // 面的距离都是 0，不用换算几何
    const features = view.queryRendered(renderedArea(point, tolerance), {
      sources: [target.sourceId],
      withGeometry: tolerance > 0
    });
    const rendered = renderedCandidates(target, features, shape =>
      screenDistance(shape, point, lngLat => view.project(lngLat))
    );
    const step = identifyStep(queryCapabilityOf(target.resource.code), view.kind, zoom, rendered);
    if (step.kind === 'server') {
      const geometry = identifyGeometry(target.resource.geometry, point, at => view.pick(at));
      if (geometry) {
        return [{ kind: 'server', target, geometry }];
      }
    }
    // 用渲染要素；后端识别拾取不到范围时也退回渲染要素
    return rendered.length > 0 ? [{ kind: 'rendered', target, candidates: rendered }] : [];
  });
}

/** 后端识别用的范围：面用点击位置（只返回包含它的面），线、点用容差框四角拾取到的多边形；拾取不到时为 null */
export function identifyGeometry(
  geometry: ResourceGeometry,
  point: ScreenPoint,
  pick: (point: ScreenPoint) => PickResult
): Point | Polygon | null {
  const lngLatAt = (x: number, y: number): Position | null => {
    const result = pick({ x, y });
    return result.kind === 'hit' ? [...result.lngLat] : null;
  };
  const tolerance = PICK_TOLERANCES[geometry];
  if (tolerance === 0) {
    const center = lngLatAt(point.x, point.y);
    return center ? { type: 'Point', coordinates: center } : null;
  }
  const { x, y } = point;
  const corners = [
    lngLatAt(x - tolerance, y - tolerance),
    lngLatAt(x + tolerance, y - tolerance),
    lngLatAt(x + tolerance, y + tolerance),
    lngLatAt(x - tolerance, y + tolerance)
  ];
  const ring = corners.filter(corner => corner !== null);
  const [first] = ring;
  if (ring.length !== corners.length || !first) {
    return null;
  }
  return { type: 'Polygon', coordinates: [[...ring, first]] };
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

// 地类图斑（含城镇村）：名称取地类名称，字段名用地类的中文名
function isLanduse(code: string): boolean {
  const kind = resourceStyle(code).color?.kind;
  return kind === 'landuse-code' || kind === 'landuse-name';
}

const textOf = (value: unknown): string | null =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : null;

/** 候选和详情的标题是资源名，副标题是年份和名称（地类取地类名称，其他取 name） */
export function featureSummary(
  target: PickResource,
  properties: Readonly<FeatureRecord>
): { readonly title: string; readonly subtitle: string } {
  const name = textOf(isLanduse(target.resource.code) ? properties.dlmc : properties.name);
  return { title: target.resource.name, subtitle: [String(target.year), name].filter(Boolean).join(' · ') };
}

/** 详情的一行 */
export interface FeatureRow {
  readonly key: string;
  readonly label: string;
  readonly value: string;
}

// 主键和几何不在详情里列出
const HIDDEN_FIELDS = new Set(['guid', 'geom', 'geometry']);

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return '-';
  }
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** 详情的字段行，按接口返回的顺序；字段名地类用中文名（大小写不敏感），其他用字段编码；空值显示 - */
export function featureRows(code: string, properties: Readonly<FeatureRecord>): FeatureRow[] {
  const labels: Readonly<Record<string, string>> = isLanduse(code) ? LANDUSE_FIELD_LABELS : {};
  return Object.entries(properties).flatMap(([key, value]) =>
    HIDDEN_FIELDS.has(key.toLowerCase())
      ? []
      : [{ key, label: labels[key.toUpperCase()] ?? key, value: displayValue(value) }]
  );
}
