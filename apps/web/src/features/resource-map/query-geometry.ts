import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';
import { simplify } from '@turf/simplify';
import type { MultiPolygon, Polygon, Position } from 'geojson';

// 发给后端范围查询的几何（ADR 0051 第 4 节）：几何放在 GET 地址里（约 8 KB 封顶），而且必须是有效的多边形

type Polygonal = Polygon | MultiPolygon;

/** 发给后端的几何最多这么多个坐标：地址约 4 KB，给请求头留出余量 */
export const QUERY_VERTEX_LIMIT = 120;

/** 依次尝试的简化容差（屏幕像素）；2 像素是允许的最大误差，比点选的容差（6～10 像素）小 */
export const SIMPLIFY_PIXELS: readonly number[] = [0, 0.25, 0.5, 1, 2];

// 坐标保留 6 位小数（约 0.1 米）
const SCALE = 1e6;

function polygonsOf(geometry: Polygonal): Position[][][] {
  return geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
}

function asPolygonal(polygons: Position[][][], type: Polygonal['type']): Polygonal {
  const [only] = polygons;
  return type === 'Polygon' && only ? { type, coordinates: only } : { type: 'MultiPolygon', coordinates: polygons };
}

// 舍入并去掉相邻的重复坐标；不足 3 个不同的点（4 个坐标）的环退化了，返回 null
function roundRing(ring: Position[]): Position[] | null {
  const rounded: Position[] = [];
  for (const [lng = 0, lat = 0] of ring) {
    const position = [Math.round(lng * SCALE) / SCALE, Math.round(lat * SCALE) / SCALE];
    const last = rounded.at(-1);
    if (!last || last[0] !== position[0] || last[1] !== position[1]) {
      rounded.push(position);
    }
  }
  return rounded.length >= 4 ? rounded : null;
}

/** 坐标保留 6 位小数、去掉相邻的重复；退化的洞去掉，外环退化时去掉这个部分，全部去掉时为 null */
export function roundPolygonal(geometry: Polygonal): Polygonal | null {
  const polygons = polygonsOf(geometry).flatMap(([outer = [], ...holes]) => {
    const roundedOuter = roundRing(outer);
    const roundedHoles = holes.map(roundRing).filter(hole => hole !== null);
    return roundedOuter ? [[roundedOuter, ...roundedHoles]] : [];
  });
  return polygons.length > 0 ? asPolygonal(polygons, geometry.type) : null;
}

/** 坐标的个数（含每个环的终点），决定地址的长度 */
export function vertexCount(geometry: Polygonal): number {
  return polygonsOf(geometry).reduce((sum, rings) => sum + rings.reduce((count, ring) => count + ring.length, 0), 0);
}

interface Point2 {
  readonly x: number;
  readonly y: number;
}

// 坐标换成整数（微度）后判断：区划和框的坐标差不到 90 度，叉积在 2^53 以内，计算是精确的
const toPoint = ([lng = 0, lat = 0]: Position): Point2 => ({ x: Math.round(lng * SCALE), y: Math.round(lat * SCALE) });

function orientation(a: Point2, b: Point2, c: Point2): number {
  return Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
}

// 已知 p 和 a、b 共线时，p 是否在线段 ab 上（含端点）
function within(a: Point2, b: Point2, p: Point2): boolean {
  return (
    Math.min(a.x, b.x) <= p.x && p.x <= Math.max(a.x, b.x) && Math.min(a.y, b.y) <= p.y && p.y <= Math.max(a.y, b.y)
  );
}

// 两条线段相交、在端点相接或共线重叠
function segmentsMeet(a: Point2, b: Point2, c: Point2, d: Point2): boolean {
  const [o1, o2, o3, o4] = [orientation(a, b, c), orientation(a, b, d), orientation(c, d, a), orientation(c, d, b)];
  if (o1 * o2 < 0 && o3 * o4 < 0) {
    return true;
  }
  return (
    (o1 === 0 && within(a, b, c)) ||
    (o2 === 0 && within(a, b, d)) ||
    (o3 === 0 && within(c, d, a)) ||
    (o4 === 0 && within(c, d, b))
  );
}

// 首尾相连的两段 a→b、b→c 只能共用 b：共线折回（尖刺）时重叠
function foldsBack(a: Point2, b: Point2, c: Point2): boolean {
  return orientation(a, b, c) === 0 && (within(a, b, c) || within(b, c, a));
}

interface Segment {
  readonly ring: number;
  readonly index: number;
  readonly from: Point2;
  readonly to: Point2;
}

// 同一个环里首尾相连的两段：相邻的序号，或者最后一段和第一段
function adjacent(first: Segment, second: Segment, sizes: readonly number[]): boolean {
  if (first.ring !== second.ring) {
    return false;
  }
  const last = (sizes[first.ring] ?? 0) - 1;
  const gap = Math.abs(first.index - second.index);
  return gap === 1 || gap === last;
}

// 一对线段（first 在前）：同一个环里首尾相连的两段只能共用端点，其他的不能相交、相接或共线重叠
function pairValid(first: Segment, second: Segment, sizes: readonly number[]): boolean {
  if (!adjacent(first, second, sizes)) {
    return !segmentsMeet(first.from, first.to, second.from, second.to);
  }
  // 相邻的序号是前一段连着后一段；否则是最后一段连着第一段
  return second.index === first.index + 1
    ? !foldsBack(first.from, first.to, second.to)
    : !foldsBack(second.from, second.to, first.to);
}

function segmentsValid(rings: readonly Position[][]): boolean {
  // 每个环的线段数
  const sizes = rings.map(ring => ring.length - 1);
  const segments: Segment[] = rings.flatMap((ring, ringIndex) =>
    ring.slice(1).map((position, index) => ({
      ring: ringIndex,
      index,
      from: toPoint(ring[index] ?? position),
      to: toPoint(position)
    }))
  );
  return segments.every((first, i) => segments.slice(i + 1).every(second => pairValid(first, second, sizes)));
}

const vertexOf = (ring: Position[]): Position => ring[0] ?? [0, 0];

const strictlyInside = (point: Position, rings: Position[][]) =>
  booleanPointInPolygon(point, { type: 'Polygon', coordinates: rings }, { ignoreBoundary: true });

/**
 * 是否是有效的多边形：每个环闭合、至少 4 个坐标；所有线段除了同一个环里首尾相连的两段，都不相交、不相接、不共线重叠；
 * 洞在自己的外环里、不在别的洞里；各部分互不包含（可以在别的部分的洞里）。turf 的 kinks 不查共线重叠，
 * boolean-valid 不查外环自相交，所以自己写（ADR 0051 背景）
 */
export function isValidPolygonal(geometry: Polygonal): boolean {
  const polygons = polygonsOf(geometry);
  const rings = polygons.flat();
  const closed = rings.every(ring => {
    const [first, last] = [ring[0], ring.at(-1)];
    return ring.length >= 4 && first?.[0] === last?.[0] && first?.[1] === last?.[1];
  });
  if (!closed || !segmentsValid(rings)) {
    return false;
  }
  // 线段互不相交，所以每个环的任意一个顶点都严格在别的环里面或外面
  return polygons.every(([outer = [], ...holes], index) => {
    const holesValid = holes.every(
      (hole, holeIndex) =>
        strictlyInside(vertexOf(hole), [outer]) &&
        holes.every((other, otherIndex) => otherIndex === holeIndex || !strictlyInside(vertexOf(hole), [other]))
    );
    const separate = polygons.every(
      (other, otherIndex) => otherIndex === index || !strictlyInside(vertexOf(outer), other)
    );
    return holesValid && separate;
  });
}

/**
 * 求交范围变成发给后端的几何：容差依次取 SIMPLIFY_PIXELS（乘上一个像素对应的经纬度距离），简化、舍入后
 * 顶点不超过上限且有效的第一个就用；都不通过时为 null（范围太复杂）。一个像素的距离未知时只试不简化的
 */
export function queryGeometry(
  area: Polygonal,
  pixelSize: number | null,
  accepts: (candidate: Polygonal) => boolean = () => true
): Polygonal | null {
  for (const pixels of SIMPLIFY_PIXELS) {
    if (pixels > 0 && pixelSize === null) {
      break;
    }
    const tolerance = pixels * (pixelSize ?? 0);
    const simplified = pixels === 0 ? area : simplify(area, { tolerance, highQuality: true });
    const rounded = roundPolygonal(simplified);
    if (rounded && vertexCount(rounded) <= QUERY_VERTEX_LIMIT && isValidPolygonal(rounded) && accepts(rounded)) {
      return rounded;
    }
  }
  return null;
}
