import { Geodesic } from 'geographiclib-geodesic';
import type { MapView, SceneView } from './types';

/** [经度, 纬度] */
export type LngLat = readonly [number, number];

// 椭球面距离（米）；geographiclib 的参数是先纬度后经度，CGCS2000 与 WGS84 的椭球视为相同（ADR 0024）
function distance([lng1, lat1]: LngLat, [lng2, lat2]: LngLat): number | undefined {
  return Geodesic.WGS84.Inverse(lat1, lng1, lat2, lng2).s12;
}

function mapView(northDegrees: number, meters: number | undefined, pixels: number): MapView | null {
  const metersPerPixel = meters === undefined ? Number.NaN : meters / pixels;
  if (!Number.isFinite(northDegrees) || !Number.isFinite(metersPerPixel) || metersPerPixel <= 0) {
    return null;
  }
  return { northDegrees, metersPerPixel };
}

/** 三维场景的取样两点换回经纬度后量距离；打不到顶面或算不出来时为 null */
export function sceneMapView(scene: SceneView, unproject: (x: number, y: number) => LngLat): MapView | null {
  const { sample } = scene;
  if (!sample) {
    return null;
  }
  return mapView(scene.north, distance(unproject(...sample.a), unproject(...sample.b)), sample.pixels);
}

/** 二维降级正北朝上；比例量中心纬度上相距 0.5° 的两点在图上的距离，量不到时为 null */
export function flatMapView([lng, lat]: LngLat, toPixel: (point: LngLat) => LngLat | null): MapView | null {
  const west: LngLat = [lng - 0.25, lat];
  const east: LngLat = [lng + 0.25, lat];
  const from = toPixel(west);
  const to = toPixel(east);
  if (!from || !to) {
    return null;
  }
  return mapView(0, distance(west, east), Math.hypot(to[0] - from[0], to[1] - from[1]));
}
