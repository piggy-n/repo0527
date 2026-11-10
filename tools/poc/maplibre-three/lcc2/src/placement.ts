// LCC2 局部坐标到地心坐标的换算，MapLibre 页和 Cesium 叠画布页共用
import proj4 from 'proj4';
import { MathUtils, Matrix4, Vector3 } from 'three';
import type { LccIndex } from './lcc-meta.ts';

export const EPSG_4548 = '+proj=tmerc +lat_0=0 +lon_0=117 +k=1 +x_0=500000 +y_0=0 +ellps=GRS80 +units=m +no_defs';
export const WGS84_LL = '+proj=longlat +datum=WGS84 +no_defs';

// WGS84：和 Cesium 的 Ellipsoid.WGS84 相同
const A = 6378137;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);

export const primeVertical = (lat: number) => A / Math.sqrt(1 - E2 * Math.sin(MathUtils.degToRad(lat)) ** 2);
export const meridional = (lat: number) => (A * (1 - E2)) / (1 - E2 * Math.sin(MathUtils.degToRad(lat)) ** 2) ** 1.5;

export function ecefOf(lng: number, lat: number, height: number): Vector3 {
  const lon = MathUtils.degToRad(lng);
  const la = MathUtils.degToRad(lat);
  const n = primeVertical(lat);
  return new Vector3((n + height) * Math.cos(la) * Math.cos(lon), (n + height) * Math.cos(la) * Math.sin(lon), (n * (1 - E2) + height) * Math.sin(la));
}

/** 地心坐标到局部系（x 东、y 上、z 南）的矩阵，原点在给定的经纬度和椭球高 */
export function ecefToEnu(lng: number, lat: number, height: number): Matrix4 {
  const lon = MathUtils.degToRad(lng);
  const la = MathUtils.degToRad(lat);
  const east = new Vector3(-Math.sin(lon), Math.cos(lon), 0);
  const up = new Vector3(Math.cos(la) * Math.cos(lon), Math.cos(la) * Math.sin(lon), Math.sin(la));
  const south = new Vector3(Math.sin(la) * Math.cos(lon), Math.sin(la) * Math.sin(lon), -Math.cos(la));
  return new Matrix4().makeBasis(east, up, south).setPosition(ecefOf(lng, lat, height)).invert();
}

/** 索引里 offset 对应的经纬度 */
export function lccOrigin(index: LccIndex): [number, number] {
  const [lng, lat] = proj4(EPSG_4548, WGS84_LL, [index.offset[0], index.offset[1]]);
  return [lng, lat];
}

/** LCC2 局部坐标 (x, y) 对应的经纬度 */
export function lccToLngLat(index: LccIndex, x: number, y: number): [number, number] {
  const [lng, lat] = proj4(EPSG_4548, WGS84_LL, [index.offset[0] + x, index.offset[1] + y]);
  return [lng, lat];
}

/** LCC2 局部（网格 x、y，高度 z）到地心：原点和两个网格方向按 proj4 算，高度取椭球高 */
export function lccToEcefMatrix(index: LccIndex): Matrix4 {
  const at = (x: number, y: number, z: number) => {
    const [lng, lat] = lccToLngLat(index, x, y);
    return ecefOf(lng, lat, index.offset[2] + z);
  };
  const origin = at(0, 0, 0);
  const axisX = at(100, 0, 0).sub(origin).multiplyScalar(0.01);
  const axisY = at(0, 100, 0).sub(origin).multiplyScalar(0.01);
  const axisZ = at(0, 0, 100).sub(origin).multiplyScalar(0.01);
  return new Matrix4().makeBasis(axisX, axisY, axisZ).setPosition(origin);
}
