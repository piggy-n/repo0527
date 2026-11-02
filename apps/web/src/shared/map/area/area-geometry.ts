import { intersect } from '@turf/intersect';
import { simplify } from '@turf/simplify';
import { Geodesic } from 'geographiclib-geodesic';
import type { MultiPolygon, Polygon, Position } from 'geojson';

// 自定义范围的几何：校验、整理成有效的面、面积与周长（docs/modules/shared-map.md 的"自定义范围"）。
// 在 Worker 里运行，只用相对导入和 npm 包

/** 整理后的范围：一个或几个面，可以有洞 */
export type AreaGeometry = MultiPolygon;

/** 范围的限值 */
export const AREA_LIMITS = {
  /** 一个文件（或一组 Shapefile 加起来）的字节数 */
  fileBytes: 50 * 1024 * 1024,
  /** 压缩包解压后的字节数：防止解压出极大的内容 */
  unzippedBytes: 200 * 1024 * 1024,
  /** 节点数：再多时整理和求交太慢 */
  vertices: 500_000,
  /** 最小面积（平方千米，1 公顷） */
  minArea: 0.01,
  /** 最大面积（平方千米）：江苏省约 10.7 万平方千米 */
  maxArea: 150_000
} as const;

/** 缩略图轮廓最多的节点数 */
const OUTLINE_VERTICES = 400;

/**
 * 参与分析的范围最多的节点数：更多时按逐步加大的容差（约 1 米起，最多约 100 米）简化。
 * 县界本身只有约 8400 个节点，范围再精细也不改变判定，求交的耗时却和节点数成正比
 */
export const ANALYSIS_VERTICES = 5000;
const MAX_TOLERANCE = 1e-3;

/** 不能作为范围的原因；message 原样显示给用户 */
export type AreaProblemCode =
  | 'file-type'
  | 'file-size'
  | 'file-empty'
  | 'file-corrupt'
  | 'file-parts'
  | 'crs'
  | 'geometry-type'
  | 'geometry-invalid'
  | 'too-complex'
  | 'too-small'
  | 'too-large'
  | 'outside';

export interface AreaProblem {
  readonly code: AreaProblemCode;
  readonly message: string;
}

/** 整理好的范围 */
export interface PreparedArea {
  readonly geometry: AreaGeometry;
  /** 简化的轮廓：缩略图用，不参与计算 */
  readonly outline: AreaGeometry;
  /** 面积（平方千米） */
  readonly area: number;
  readonly vertices: number;
  /** 可以继续使用、但要告诉用户的情况，如修正了交叉的边 */
  readonly notices: readonly string[];
}

export type AreaCheck = { readonly ok: true; readonly area: PreparedArea } | AreaFailure;

/** 面的坐标：多边形 → 环 → 节点 */
export type PolygonCoordinates = readonly (readonly (readonly Position[])[])[];

/** 不能使用的结果 */
export interface AreaFailure {
  readonly ok: false;
  readonly problem: AreaProblem;
}

export const problem = (code: AreaProblemCode, message: string): AreaFailure => ({
  ok: false,
  problem: { code, message }
});

// CGCS2000 与 WGS84 的椭球在这里视为相同，同 map-core 的 geodesicArea（ADR 0035）
const ELLIPSOID = Geodesic.WGS84;

/** 一个环在椭球面上的面积（平方米）和周长（米）；顺时针、逆时针都按正值 */
export function ringMeasure(ring: readonly Position[]): { readonly area: number; readonly perimeter: number } {
  const polygon = ELLIPSOID.Polygon(false);
  for (const [lng = 0, lat = 0] of ring) {
    polygon.AddPoint(lat, lng);
  }
  const { area = 0, perimeter } = polygon.Compute(false, true);
  return { area: Math.abs(area), perimeter };
}

export const polygonsOf = (geometry: Polygon | MultiPolygon): Position[][][] =>
  geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;

/** 面积（平方千米）和周长（千米，含洞的边） */
export function geometryMeasure(geometry: Polygon | MultiPolygon): {
  readonly area: number;
  readonly perimeter: number;
} {
  let area = 0;
  let perimeter = 0;
  for (const [outer = [], ...holes] of polygonsOf(geometry)) {
    const shell = ringMeasure(outer);
    area += shell.area;
    perimeter += shell.perimeter;
    for (const hole of holes) {
      const measure = ringMeasure(hole);
      area -= measure.area;
      perimeter += measure.perimeter;
    }
  }
  return { area: area / 1e6, perimeter: perimeter / 1000 };
}

const countVertices = (polygons: PolygonCoordinates, count: (ring: readonly Position[]) => number): number =>
  polygons.reduce((sum, rings) => sum + rings.reduce((total, ring) => total + count(ring), 0), 0);

/** 节点数：每个环不算重复的首尾点 */
export const vertexCount = (geometry: Polygon | MultiPolygon): number =>
  countVertices(polygonsOf(geometry), ring => Math.max(0, ring.length - 1));

const isLngLat = (lng: number, lat: number): boolean => Math.abs(lng) <= 180 && Math.abs(lat) <= 90;

/** 坐标的问题：不是数、不在经纬度范围里（可能是投影坐标），或者经纬度颠倒；都正常时为 null */
export function coordinateIssue(polygons: PolygonCoordinates): 'invalid' | 'projected' | 'swapped' | null {
  let swappable = true;
  let bad = false;
  for (const rings of polygons) {
    for (const ring of rings) {
      for (const [x = NaN, y = NaN] of ring) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          return 'invalid';
        }
        if (!isLngLat(x, y)) {
          bad = true;
        }
        if (!isLngLat(y, x)) {
          swappable = false;
        }
      }
    }
  }
  if (!bad) {
    return null;
  }
  return swappable ? 'swapped' : 'projected';
}

// 去掉相邻的重复点并闭合；不足 3 个不同的点时退化，返回 null
function cleanRing(ring: readonly Position[]): Position[] | null {
  const points: Position[] = [];
  for (const [lng = 0, lat = 0] of ring) {
    const last = points.at(-1);
    if (!last || last[0] !== lng || last[1] !== lat) {
      points.push([lng, lat]);
    }
  }
  const [first] = points;
  const last = points.at(-1);
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
    points.push([first[0] ?? 0, first[1] ?? 0]);
  }
  return points.length >= 4 ? points : null;
}

// 逐步加大容差（度）简化到不超过 limit 个节点，容差最多到 maxTolerance；返回简化结果和用到的容差（没简化时为 0）
function simplifyTo(geometry: AreaGeometry, limit: number, maxTolerance: number): [AreaGeometry, number] {
  let result = geometry;
  let used = 0;
  for (let tolerance = 1e-5; vertexCount(result) > limit && tolerance <= maxTolerance; tolerance *= 2) {
    const simplified = simplify(geometry, { tolerance, highQuality: false });
    if (simplified.coordinates.length > 0) {
      result = simplified;
      used = tolerance;
    }
  }
  return [result, used];
}

// 1 度纬度约 111 千米，容差换成米给用户看
const toleranceMeters = (degrees: number): number => Math.round(degrees * 111_000);

/**
 * 整理范围：检查坐标，去掉退化的环，自己和自己求交得到有效的面（合并重叠、拆开交叉的边、闭合未闭合的环），
 * 再检查节点数和面积。坐标的问题由读取文件时先按来源给出更具体的说明
 */
export function prepareArea(polygons: PolygonCoordinates, notices: readonly string[] = []): AreaCheck {
  const raw = countVertices(polygons, ring => ring.length);
  if (raw > AREA_LIMITS.vertices) {
    return problem(
      'too-complex',
      `范围有 ${raw.toLocaleString('zh-CN')} 个节点，超过 ${AREA_LIMITS.vertices.toLocaleString('zh-CN')} 个的上限，请简化后上传`
    );
  }
  if (coordinateIssue(polygons) !== null) {
    return problem('crs', '坐标不是有效的经纬度，请转换为 CGCS2000 或 WGS84 经纬度坐标');
  }
  const kept: Position[][][] = [];
  let dropped = 0;
  for (const [outer = [], ...holes] of polygons) {
    const shell = cleanRing(outer);
    if (!shell) {
      dropped += 1 + holes.length;
      continue;
    }
    const inner = holes.map(cleanRing);
    dropped += inner.filter(ring => ring === null).length;
    kept.push([shell, ...inner.filter(ring => ring !== null)]);
  }
  if (kept.length === 0) {
    return problem('geometry-invalid', '没有有效的面：每个面至少要有 3 个不重合的节点');
  }
  const input: MultiPolygon = { type: 'MultiPolygon', coordinates: kept };
  // 先简化再整理：整理（求交）的耗时也和节点数成正比；简化可能带来的交叉由整理修正
  const [simplified, tolerance] = simplifyTo(input, ANALYSIS_VERTICES, MAX_TOLERANCE);
  const feature = { type: 'Feature' as const, properties: {}, geometry: simplified };
  const normalized = intersect({ type: 'FeatureCollection', features: [feature, feature] });
  if (!normalized) {
    return problem('geometry-invalid', '范围没有面积：节点重合或在一条直线上');
  }
  const geometry: AreaGeometry =
    normalized.geometry.type === 'Polygon'
      ? { type: 'MultiPolygon', coordinates: [normalized.geometry.coordinates] }
      : normalized.geometry;
  const { area } = geometryMeasure(geometry);
  const next = [...notices];
  if (dropped > 0) {
    next.push(`去掉了 ${dropped} 个不足 3 个节点的环`);
  }
  // 面积都按各个面相加（重叠的部分算两次）：简化前后比是简化的影响，整理前后比是合并了重叠、拆开了交叉
  const before = geometryMeasure(input).area;
  const reduced = tolerance > 0 ? geometryMeasure(simplified).area : before;
  if (tolerance > 0) {
    const change = (Math.abs(before - reduced) / before) * 100;
    next.push(
      `范围有 ${vertexCount(input).toLocaleString('zh-CN')} 个节点，分析时按约 ${toleranceMeters(tolerance)} 米的精度简化为 ` +
        `${vertexCount(geometry).toLocaleString('zh-CN')} 个，面积变化${change < 0.01 ? '不到 0.01' : ` ${change.toFixed(2)}`}%`
    );
  }
  if (Math.abs(reduced - area) > Math.max(0.001, area * 0.001)) {
    next.push('范围里有交叉的边或互相重叠的面，已合并为有效的面');
  }
  if (area < AREA_LIMITS.minArea) {
    return problem('too-small', `范围面积不足 1 公顷（${area.toFixed(4)} 平方千米），请重新绘制或上传`);
  }
  if (area > AREA_LIMITS.maxArea) {
    return problem(
      'too-large',
      `范围面积约 ${(area / 1e4).toFixed(1)} 万平方千米，超过 ${AREA_LIMITS.maxArea / 1e4} 万平方千米的上限（江苏省约 10.7 万平方千米）`
    );
  }
  return {
    ok: true,
    area: {
      geometry,
      outline: simplifyTo(geometry, OUTLINE_VERTICES, 1)[0],
      area,
      vertices: vertexCount(geometry),
      notices: next
    }
  };
}
