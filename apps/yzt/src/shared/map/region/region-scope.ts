import { bbox } from '@turf/bbox';
import { bboxClip } from '@turf/bbox-clip';
import { booleanIntersects } from '@turf/boolean-intersects';
import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';
import { intersect } from '@turf/intersect';
import type { BBox, Feature, Geometry, MultiPolygon, Polygon, Position } from 'geojson';
import type { LngLat } from '@mx/map-core';

/** 区划裁剪的范围（ADR 0051 第 1 节）：已加载的区划边界；识别范围和它求交后也是这个类型 */
export type RegionScope = Polygon | MultiPolygon;

function asFeature(geometry: RegionScope): Feature<RegionScope> {
  return { type: 'Feature', properties: {}, geometry };
}

/** 点是否在范围里，落在边界上的也算 */
export function scopeContains(scope: RegionScope, lngLat: LngLat): boolean {
  return booleanPointInPolygon([...lngLat], scope);
}

// 区划在矩形附近的部分：按矩形裁剪（Sutherland–Hodgman）。矩形边上留下的退化边由精确求交处理
// （全部市、区县上随机 400 个框，结果和直接求交相同）。整个在矩形外的部分裁剪后是空数组，去掉；都不剩时为 null
function nearby(scope: RegionScope, box: BBox): MultiPolygon | null {
  const { geometry } = bboxClip(scope, box);
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
  const near = nearby(scope, bbox(area));
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

// 要素的外包矩形四边各外扩 1%（点外扩一个极小值），要素碰不到裁剪在矩形边上留下的退化边
function paddedBox(geometry: Geometry): BBox {
  const [west, south, east, north] = bbox(geometry);
  const pad = Math.max(east - west, north - south) * 0.01 || 1e-9;
  return [west - pad, south - pad, east + pad, north + pad];
}

/**
 * 要素的几何是否和范围相交，相接也算。跨过边界或在范围外的，先把范围裁到要素附近再逐段求交：南京市界约 1 万个坐标，
 * 直接求交每个范围外的要素要 5～8 毫秒，裁过后约 0.1 毫秒，结果相同（ADR 0174 审查）
 */
export function intersectsScope(geometry: Geometry, scope: RegionScope): boolean {
  // 大多数要素在范围里面：先看一个顶点，在范围里就是相交
  const first = firstPosition(geometry);
  if (first !== undefined && booleanPointInPolygon(first, scope)) {
    return true;
  }
  const near = nearby(scope, paddedBox(geometry));
  return near !== null && booleanIntersects(geometry, near);
}
