import { MercatorCoordinate } from 'maplibre-gl';
import type { AnchorMatrices } from './scene-renderer';

// 局部系（x 东、y 上、z 南，米）到 MapLibre 世界坐标的矩阵（ADR 0147 第 5 节，算法来自 PoC 的 own-layer）：
// 三维模型按 WGS84 椭球定位，东、北一米对应的经纬度变化按椭球的两个曲率半径算；MapLibre 自己的地球半径只用于竖直方向

const A = 6378137;
const E2 = (1 / 298.257223563) * (2 - 1 / 298.257223563);
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/** 卯酉圈曲率半径（米） */
function primeVerticalRadius(lat: number): number {
  return A / Math.sqrt(1 - E2 * Math.sin(toRadians(lat)) ** 2);
}

/** 子午圈曲率半径（米） */
function meridionalRadius(lat: number): number {
  return (A * (1 - E2)) / (1 - E2 * Math.sin(toRadians(lat)) ** 2) ** 1.5;
}

// MapLibre 的地球半径：赤道上一米对应的墨卡托单位是 1 / (2πR)
const MAPLIBRE_EARTH_RADIUS = 1 / (2 * Math.PI * MercatorCoordinate.fromLngLat([0, 0], 0).meterInMercatorCoordinateUnits());

/** 局部系到墨卡托世界：墨卡托的 y 向南增大，z 是以墨卡托单位计的高度 */
function toMercator(lng: number, lat: number): Float64Array {
  const anchor = MercatorCoordinate.fromLngLat([lng, lat], 0);
  const cos = Math.cos(toRadians(lat));
  const east = 1 / (2 * Math.PI * primeVerticalRadius(lat) * cos);
  const south = 1 / (2 * Math.PI * meridionalRadius(lat) * cos);
  const up = anchor.meterInMercatorCoordinateUnits();
  // 列主序：x 列、y 列、z 列、平移
  return Float64Array.of(east, 0, 0, 0, 0, 0, up, 0, 0, south, 0, 0, anchor.x, anchor.y, anchor.z, 1);
}

/** 局部系到地球投影的单位球：x = sinλcosφ，y = sinφ，z = cosλcosφ，高度按 MapLibre 的地球半径缩放 */
function toGlobe(lng: number, lat: number): Float64Array {
  const lambda = toRadians(lng);
  const phi = toRadians(lat);
  const up = [Math.sin(lambda) * Math.cos(phi), Math.sin(phi), Math.cos(lambda) * Math.cos(phi)];
  const east = [Math.cos(lambda), 0, -Math.sin(lambda)];
  const north = [-Math.sin(lambda) * Math.sin(phi), Math.cos(phi), -Math.cos(lambda) * Math.sin(phi)];
  const e = 1 / primeVerticalRadius(lat);
  const u = 1 / MAPLIBRE_EARTH_RADIUS;
  const s = -1 / meridionalRadius(lat);
  return Float64Array.of(
    east[0] * e,
    east[1] * e,
    east[2] * e,
    0,
    up[0] * u,
    up[1] * u,
    up[2] * u,
    0,
    north[0] * s,
    north[1] * s,
    north[2] * s,
    0,
    up[0],
    up[1],
    up[2],
    1
  );
}

/** 锚点在 [lng, lat] 的椭球面上时，局部系到两种投影的矩阵 */
export function anchorMatrices(lng: number, lat: number): AnchorMatrices {
  return { mercator: toMercator(lng, lat), globe: toGlobe(lng, lat) };
}
