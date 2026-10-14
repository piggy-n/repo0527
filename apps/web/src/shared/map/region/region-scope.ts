import { booleanIntersects } from '@turf/boolean-intersects';
import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';
import { intersect } from '@turf/intersect';
import type { Feature, Geometry, MultiPolygon, Polygon } from 'geojson';
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

/** 识别范围和区划的交集；没有共同的面积（不相交或只相接）时为 null */
export function clipToScope(area: Polygon, scope: RegionScope): RegionScope | null {
  return intersect({ type: 'FeatureCollection', features: [asFeature(area), asFeature(scope)] })?.geometry ?? null;
}

/** 要素的几何是否和范围相交，相接也算 */
export function intersectsScope(geometry: Geometry, scope: RegionScope): boolean {
  return booleanIntersects(geometry, scope);
}
