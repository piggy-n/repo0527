import { Geodesic } from 'geographiclib-geodesic';
import type { LngLat } from '../view/view-input';

// CGCS2000 与 WGS84 的椭球在这里视为相同（ADR 0024 第 3 条）
const ELLIPSOID = Geodesic.WGS84;

/** 两点之间椭球面上的距离（米）；geographiclib 的参数是先纬度后经度 */
export function geodesicDistance([lng1, lat1]: LngLat, [lng2, lat2]: LngLat): number {
  const { s12 } = ELLIPSOID.Inverse(lat1, lng1, lat2, lng2);
  // 默认的输出项一定包含距离
  if (s12 === undefined) {
    throw new Error('geographiclib 没有返回距离');
  }
  return s12;
}

/** 折线各节点的累计距离（米），第一个节点是 0 */
export function cumulativeDistances(points: readonly LngLat[]): number[] {
  let total = 0;
  return points.map((point, index) => {
    const previous = points[index - 1];
    if (previous) {
      total += geodesicDistance(previous, point);
    }
    return total;
  });
}

/** 折线的总长（米）；少于两个点时是 0 */
export function lineLength(points: readonly LngLat[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index++) {
    total += geodesicDistance(points[index - 1], points[index]);
  }
  return total;
}

/** 多边形在椭球面上的面积（平方米）；按顺序给出各顶点，不需要首尾相同，顺时针、逆时针都可以 */
export function geodesicArea(points: readonly LngLat[]): number {
  const polygon = ELLIPSOID.Polygon(false);
  for (const [lng, lat] of points) {
    polygon.AddPoint(lat, lng);
  }
  // sign 为 true：方向反了时得到负值，而不是"地球上其余部分"的面积，取绝对值即可
  const { area } = polygon.Compute(false, true);
  // 多边形模式（不是折线）一定包含面积
  if (area === undefined) {
    throw new Error('geographiclib 没有返回面积');
  }
  return Math.abs(area);
}
