// 内网服务器可能有的底图（ADR 0165 第 2 节，docs/config/overview.md"代码里的产品开关"）：所有部署一样，每台服务器有哪几套运行时探测。
// 读取器只管紧凑缓存的格式；切法（Web 墨卡托、256 像素、级别号就是 z）是使用方的前提，换数据时按 docs/deployment.md 核对 conf.xml。只写类型和常量，不导入别的模块

/** 服务器底图的 ID：影像沿用天地图影像的 ID，三套矢量是新的 */
export type ServerBasemapId = 'standard' | 'imagery' | 'black' | 'night-blue';

/** 地名的来源：static 叠静态底图的市、区县地名，跟着标注开关；baked 印在底图上，开关不起作用 */
export type ServerBasemapPlaceNames = 'static' | 'baked';

/** 西、南、东、北（经纬度） */
export type LngLatBounds = readonly [west: number, south: number, east: number, north: number];

export interface ServerBasemapOption {
  readonly id: ServerBasemapId;
  /** nginx 的地址前缀：`<BASE_URL>basemap/<prefix>/` 指到缓存的 `Layers/` */
  readonly prefix: string;
  /** 有数据的级别范围 */
  readonly minzoom: number;
  readonly maxzoom: number;
  /** 缓存 conf.cdi 的范围向外取整；范围外不请求 */
  readonly bounds: LngLatBounds;
  readonly labels: ServerBasemapPlaceNames;
}

// 影像和三套矢量的范围不同（2026-11-17 读服务器上的 conf.cdi）
const IMAGERY_BOUNDS: LngLatBounds = [116.311, 30.748, 122.065, 35.169];
const VECTOR_BOUNDS: LngLatBounds = [116.353, 30.76, 122.447, 35.322];

/** 可能有的服务器底图，按 ADR 0165 第 1 节表格的顺序；面板里的位置见 basemap-style 的 INTRANET_ORDER */
export const SERVER_BASEMAP_OPTIONS: readonly ServerBasemapOption[] = [
  { id: 'standard', prefix: 'standard', minzoom: 7, maxzoom: 18, bounds: VECTOR_BOUNDS, labels: 'baked' },
  { id: 'imagery', prefix: 'imagery', minzoom: 7, maxzoom: 18, bounds: IMAGERY_BOUNDS, labels: 'static' },
  { id: 'black', prefix: 'black', minzoom: 7, maxzoom: 18, bounds: VECTOR_BOUNDS, labels: 'baked' },
  { id: 'night-blue', prefix: 'night-blue', minzoom: 7, maxzoom: 18, bounds: VECTOR_BOUNDS, labels: 'baked' }
];

/** 探测读的瓦片：南京那块 10 级瓦片，同天地图的缩略图，读到的字节直接做缩略图 */
export const SERVER_BASEMAP_PROBE_TILE = { z: 10, x: 849, y: 415 } as const;

/** 探测总共最多等多久（毫秒）：服务器挂住时进入地图页最多多等这么久 */
export const SERVER_BASEMAP_PROBE_TIMEOUT = 3000;
