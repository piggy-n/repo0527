// 方案 B 的 PoC：瓦片坐标的换算，主线程和 Worker 共用

export interface TileCoord {
  readonly z: number;
  readonly x: number;
  readonly y: number;
}

export const tileKey = ({ z, x, y }: TileCoord): string => `${z}/${x}/${y}`;

/** 显示级别超过数据源的最大级别时，下载的是那张父瓦片，矢量按子区域重新栅格化 */
export function sourceTile(coord: TileCoord, maxzoom: number): TileCoord {
  if (coord.z <= maxzoom) {
    return coord;
  }
  const shift = coord.z - maxzoom;
  return { z: maxzoom, x: coord.x >> shift, y: coord.y >> shift };
}

/** 经纬度在 z 级的瓦片坐标（带小数） */
export function tilePoint(lng: number, lat: number, z: number): { readonly x: number; readonly y: number } {
  const n = 2 ** z;
  const radians = (lat * Math.PI) / 180;
  return {
    x: ((lng + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) * n
  };
}

/** 瓦片里的一点（瓦片坐标，0～extent）换成经纬度 */
export function lngLatOf(px: number, py: number, extent: number, { z, x, y }: TileCoord): [number, number] {
  const n = 2 ** z;
  const lng = ((x + px / extent) / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + py / extent)) / n))) * 180) / Math.PI;
  return [lng, lat];
}

/** 瓦片的范围：西、南、东、北 */
export function tileBounds(coord: TileCoord): readonly [number, number, number, number] {
  const [west, north] = lngLatOf(0, 0, 1, coord);
  const [east, south] = lngLatOf(1, 1, 1, coord);
  return [west, south, east, north];
}
