import { bbox } from '@turf/bbox';
import { bboxClip } from '@turf/bbox-clip';
import { booleanIntersects } from '@turf/boolean-intersects';
import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';
import { intersect } from '@turf/intersect';
import type { Feature, Geometry, MultiPolygon, Polygon, Position } from 'geojson';
import type { LngLat } from '@yzt/map-core';

/** 区划裁剪的范围（ADR 0051 第 1 节）：已加载的区划边界；识别范围和它求交后也是这个类型 */
export type RegionScope = Polygon | MultiPolygon;

function asFeature(geometry: RegionScope): Feature<RegionScope> {
  return { type: 'Feature', properties: {}, geometry };
}

/** 点是否在范围里，落在边界上的也算 */
export function scopeContains(scope: RegionScope, lngLat: LngLat): boolean {
  return booleanPointInPolygon([...lngLat], scope);
}

// 区划在识别范围附近的部分：按识别范围的外包矩形裁剪（Sutherland–Hodgman）。矩形边上留下的退化边由精确求交处理
// （全部市、区县上随机 400 个框，结果和直接求交相同）。整个在矩形外的部分裁剪后是空数组，去掉；都不剩时为 null
function nearby(scope: RegionScope, area: Polygon): MultiPolygon | null {
  const { geometry } = bboxClip(scope, bbox(area));
  if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') {
    return null;
  }
  const polygons = (geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates).filter(
    rings => rings.length > 0
  );
  return polygons.length > 0 ? { type: 'MultiPolygon', coordinates: polygons } : null;
}

/**
 * 识别范围和区划的交集；没有共同的面积（不相交或只相接）时为 null。先裁掉区划远处的边再精确求交：
 * 南京市界约 1 万个坐标，直接求交要 140 ms 左右，先裁剪后 1～20 ms，结果相同
 */
export function clipToScope(area: Polygon, scope: RegionScope): RegionScope | null {
  const near = nearby(scope, area);
  if (!near) {
    return null;
  }
  return intersect({ type: 'FeatureCollection', features: [asFeature(area), asFeature(near)] })?.geometry ?? null;
}

// 几何的第一个坐标
function firstPosition(geometry: Geometry): Position | undefined {
  switch (geometry.type) {
    case 'Point':
      return geometry.coordinates;
    case 'MultiPoint':
    case 'LineString':
      return geometry.coordinates[0];
    case 'MultiLineString':
    case 'Polygon':
      return geometry.coordinates[0]?.[0];
    case 'MultiPolygon':
      return geometry.coordinates[0]?.[0]?.[0];
    case 'GeometryCollection':
      break;
  }
  const [part] = geometry.geometries;
  return part && firstPosition(part);
}

/** 要素的几何是否和范围相交，相接也算 */
export function intersectsScope(geometry: Geometry, scope: RegionScope): boolean {
  // 框选时大多数要素在范围里面：先看一个顶点，在范围里就是相交，跨过边界的才逐段求交
  const first = firstPosition(geometry);
  return (first !== undefined && booleanPointInPolygon(first, scope)) || booleanIntersects(geometry, scope);
}
