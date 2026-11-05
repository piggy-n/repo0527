import { Matrix4, Vector3 } from 'three';
import { prepareTileset } from '../../../../packages/map-core/src/scene/prepare-tileset.ts';
import models from './models.json';

export type ModelId = 'station' | 'white' | 'oblique';

export interface ModelSpec {
  readonly id: ModelId;
  readonly url: string;
  readonly center: readonly [number, number];
  readonly zoom: number;
}

// 中心点来自各瓦片集根节点的地心坐标变换；测量脚本读同一个文件
export const MODELS = models as unknown as Readonly<Record<ModelId, ModelSpec>>;

// WGS84：和 Cesium 的 Ellipsoid.WGS84 相同
const A = 6378137;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);

export function primeVerticalRadius(latDeg: number): number {
  const sin = Math.sin((latDeg * Math.PI) / 180);
  return A / Math.sqrt(1 - E2 * sin * sin);
}

export function meridionalRadius(latDeg: number): number {
  const sin = Math.sin((latDeg * Math.PI) / 180);
  return (A * (1 - E2)) / (1 - E2 * sin * sin) ** 1.5;
}

export function ecefOf(lng: number, lat: number, height: number): Vector3 {
  const lon = (lng * Math.PI) / 180;
  const la = (lat * Math.PI) / 180;
  const n = primeVerticalRadius(lat);
  return new Vector3(
    (n + height) * Math.cos(la) * Math.cos(lon),
    (n + height) * Math.cos(la) * Math.sin(lon),
    (n * (1 - E2) + height) * Math.sin(la)
  );
}

// 地心坐标 -> 局部系（x 东、y 上、z 南），和 maplibre-gl-three 的 LocalSpace 约定相同
export function ecefToEnuMatrix(lng: number, lat: number, height: number): Matrix4 {
  const lon = (lng * Math.PI) / 180;
  const la = (lat * Math.PI) / 180;
  const east = new Vector3(-Math.sin(lon), Math.cos(lon), 0);
  const up = new Vector3(Math.cos(la) * Math.cos(lon), Math.cos(la) * Math.sin(lon), Math.sin(la));
  const south = new Vector3(Math.sin(la) * Math.cos(lon), Math.sin(la) * Math.sin(lon), -Math.cos(la));
  const toEcef = new Matrix4().makeBasis(east, up, south).setPosition(ecefOf(lng, lat, height));
  return toEcef.invert();
}

/** 按经纬度走 east、north 米，用于生成测试点；只在几千米内使用 */
export function offsetLngLat(lng: number, lat: number, east: number, north: number): [number, number] {
  const n = primeVerticalRadius(lat);
  const m = meridionalRadius(lat);
  const rad = Math.PI / 180;
  return [lng + east / (n * Math.cos(lat * rad) * rad), lat + north / (m * rad)];
}

/** 用项目的 prepareTileset 整理索引（合并外部索引、修正几何误差），返回可以交给 TilesRenderer 的 Blob 地址 */
export async function preparedTilesetUrl(url: string): Promise<string> {
  const absolute = new URL(url, location.href).href;
  const prepared = await prepareTileset(
    absolute,
    async (target, signal) => {
      const response = await fetch(target, { signal });
      if (!response.ok) {
        throw new Error(`${target} ${response.status}`);
      }
      return response.json();
    },
    new AbortController().signal
  );
  return URL.createObjectURL(new Blob([JSON.stringify(prepared)], { type: 'application/json' }));
}

export function isRawTileset(): boolean {
  return new URLSearchParams(location.search).get('raw') === '1';
}
