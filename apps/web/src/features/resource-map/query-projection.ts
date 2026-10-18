import type { LngLat, ScreenBox, ScreenPoint, ToolView } from '@yzt/map-core';
import type { MultiPolygon, Polygon, Position } from 'geojson';
import { QUERY_VERTEX_LIMIT, queryGeometry } from './query-geometry';

/** 三维范围不可查询的原因，不把缺失的地表当成没有要素 */
export type QueryUnavailableReason = 'surface' | 'geometry';

type Projection = Pick<ToolView, 'pick' | 'project'>;
type Polygonal = Polygon | MultiPolygon;
type PolygonResult =
  | { readonly kind: 'ready'; readonly geometry: Polygon }
  | { readonly kind: 'query-unavailable'; readonly reason: QueryUnavailableReason };

// 每段屏幕边缘最多 64 像素；采样与舍入各留出误差余量，最终投影边界复核不超过 2 像素
const EDGE_STEP = 64;
const EDGE_ERROR = 0.5;
const CHECK_ERROR = 0.25;
const QUERY_ERROR = 1;
const SAMPLE_LIMIT = 16384;
const COMPARISON_LIMIT = 1000000;
const DEPTH_LIMIT = 12;
const FRACTIONS = [0.25, 0.5, 0.75] as const;

const unavailable = (reason: QueryUnavailableReason): PolygonResult => ({ kind: 'query-unavailable', reason });

// 屏幕线段的距离；透视投影不保持线段上的比例，因此不能比较相同插值比例的位置
function segmentDistance(point: ScreenPoint, from: ScreenPoint, to: ScreenPoint): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = dx * dx + dy * dy;
  const ratio = length === 0 ? 0 : Math.max(0, Math.min(1,
    ((point.x - from.x) * dx + (point.y - from.y) * dy) / length));
  return Math.hypot(point.x - from.x - ratio * dx, point.y - from.y - ratio * dy);
}

const middle = (from: ScreenPoint, to: ScreenPoint): ScreenPoint => ({
  x: (from.x + to.x) / 2, y: (from.y + to.y) / 2
});

function finitePosition(position: Position): position is [number, number] {
  const [lng, lat] = position;
  return lng !== undefined && lat !== undefined && Number.isFinite(lng) && Number.isFinite(lat) &&
    Math.abs(lng) <= 180 && Math.abs(lat) < 90;
}

const interpolate = (from: LngLat, to: LngLat, ratio: number): LngLat => [
  from[0] + (to[0] - from[0]) * ratio, from[1] + (to[1] - from[1]) * ratio
];

// 后端把经纬度顶点之间连成直线；跨经线不能用这条线代表屏幕上很短的一段
function continuous(from: LngLat, to: LngLat): boolean {
  return Math.abs(from[0] - to[0]) < 180;
}

/** 将三维屏幕框细分为地表边缘；天空、跨经线或预算不足时明确拒绝 */
export function projectedScreenBox(box: ScreenBox, view: Projection): PolygonResult {
  const left = Math.min(box.from.x, box.to.x);
  const right = Math.max(box.from.x, box.to.x);
  const top = Math.min(box.from.y, box.to.y);
  const bottom = Math.max(box.from.y, box.to.y);
  if (![left, right, top, bottom].every(Number.isFinite) || left === right || top === bottom) {
    return unavailable('geometry');
  }
  const corners: ScreenPoint[] = [
    { x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }
  ];
  let failure: QueryUnavailableReason | null = null;
  const pick = (point: ScreenPoint): LngLat | null => {
    const result = view.pick(point);
    if (result.kind !== 'hit') { failure = 'surface'; return null; }
    if (!finitePosition([...result.lngLat])) { failure = 'geometry'; return null; }
    return result.lngLat;
  };
  const locations = corners.map(pick);
  const ring: Position[] = [];
  // 所有分段先保证屏幕长度，再检查经纬度直线的三个内部点是否仍落在屏幕边缘附近
  const append = (from: ScreenPoint, to: ScreenPoint, a: LngLat, b: LngLat, depth: number): boolean => {
    if (!continuous(a, b) || depth > DEPTH_LIMIT || ring.length >= QUERY_VERTEX_LIMIT - 1) {
      failure = 'geometry'; return false;
    }
    const checks = FRACTIONS.map(ratio => view.project(interpolate(a, b, ratio)));
    const flat = checks.every(point => point !== null && segmentDistance(point, from, to) <= EDGE_ERROR);
    if (Math.hypot(to.x - from.x, to.y - from.y) <= EDGE_STEP && flat) {
      ring.push([...a]); return true;
    }
    const center = middle(from, to);
    const location = pick(center);
    return location !== null && append(from, center, a, location, depth + 1) &&
      append(center, to, location, b, depth + 1);
  };
  for (let index = 0; index < corners.length; index++) {
    const next = (index + 1) % corners.length;
    const from = corners[index];
    const to = corners[next];
    const a = locations[index];
    const b = locations[next];
    if (!from || !to || !a || !b || !append(from, to, a, b, 0)) {
      return unavailable(failure ?? 'surface');
    }
  }
  const first = ring[0];
  if (!first) { return unavailable('geometry'); }
  return { kind: 'ready', geometry: { type: 'Polygon', coordinates: [[...ring, first]] } };
}

// 把经纬度直线在屏幕上的曲线细分；有限点数与深度保证地平线附近不会无限细分
function projectedRings(area: Polygonal, view: Projection): ScreenPoint[][] | null {
  const rings = (area.type === 'Polygon' ? [area.coordinates] : area.coordinates).flat();
  let remaining = SAMPLE_LIMIT;
  const output: ScreenPoint[][] = [];
  for (const ring of rings) {
    const points: ScreenPoint[] = [];
    const append = (a: LngLat, b: LngLat, from: ScreenPoint, to: ScreenPoint, depth: number): boolean => {
      if (--remaining < 0 || depth > DEPTH_LIMIT || !continuous(a, b)) { return false; }
      const checks = FRACTIONS.map(ratio => view.project(interpolate(a, b, ratio)));
      if (checks.some(point => point === null)) { return false; }
      const flat = checks.every(point => point !== null && segmentDistance(point, from, to) <= CHECK_ERROR);
      if (Math.hypot(to.x - from.x, to.y - from.y) <= EDGE_STEP && flat) {
        points.push(from); return true;
      }
      const location = interpolate(a, b, 0.5);
      const center = checks[1];
      return center !== null && center !== undefined && append(a, location, from, center, depth + 1) &&
        append(location, b, center, to, depth + 1);
    };
    for (let index = 1; index < ring.length; index++) {
      const a = ring[index - 1];
      const b = ring[index];
      if (!a || !b || !finitePosition(a) || !finitePosition(b)) { return null; }
      const from = view.project(a);
      const to = view.project(b);
      if (!from || !to || !append(a, b, from, to, 0)) { return null; }
    }
    const first = points[0];
    if (!first) { return null; }
    output.push([...points, first]);
  }
  return output;
}

// 按对应环双向比较，避免简化删去岛屿或洞后只检查剩余边界而漏掉误差
function closeRings(first: readonly ScreenPoint[][], second: readonly ScreenPoint[][]): boolean {
  if (first.length !== second.length) { return false; }
  let remaining = COMPARISON_LIMIT;
  const close = (points: readonly ScreenPoint[], ring: readonly ScreenPoint[]) => points.every(point => {
    for (let index = 1; index < ring.length; index++) {
      const from = ring[index - 1];
      const to = ring[index];
      if (--remaining < 0) { return false; }
      if (from && to && segmentDistance(point, from, to) <= QUERY_ERROR) { return true; }
    }
    return false;
  });
  return first.every((ring, index) => {
    const other = second[index];
    return other !== undefined && close(ring, other) && close(other, ring);
  });
}

/** 三维查询几何仍受 120 顶点约束；简化与舍入后额外核对整个范围的投影误差 */
export function projectedQueryGeometry(area: Polygonal, pixelSize: number | null, view: Projection): Polygonal | null {
  const original = projectedRings(area, view);
  if (!original) { return null; }
  return queryGeometry(area, pixelSize, candidate => {
    const projected = projectedRings(candidate, view);
    return projected !== null && closeRings(original, projected);
  });
}
