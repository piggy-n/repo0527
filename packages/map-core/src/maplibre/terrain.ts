// 三维的地形（ADR 0170）：app 按部署的配置注入，视图只在三维、不在漫游时打开；天地图的地形经自定义协议换成 raster-dem
import type { RasterDEMSourceSpecification } from '@maplibre/maplibre-gl-style-spec';
import {
  encodeTerrarium,
  TIANDITU_TERRAIN_MAX_LEVEL,
  TIANDITU_TERRAIN_MIN_LEVEL,
  type TiandituTerrainReader
} from '../tiles/tianditu-terrain';
import type { LngLat } from '../view/view-input';

/** 视图加的地形数据源的 ID：不和会话样式里的数据源重复（拥有者的数据源以分组名为前缀） */
export const TERRAIN_SOURCE_ID = 'view-terrain';

/** 三维的地形：raster-dem 数据源，和贴地用的取高度（不依赖地图加载了哪些瓦片） */
export interface MapTerrain {
  readonly source: RasterDEMSourceSpecification;
  /** 这个经纬度的地形高度（米）；signal 中止时以它的原因结束 */
  heightAt(lngLat: LngLat, signal: AbortSignal): Promise<number>;
}

/** 天地图地形的协议名：数据源的瓦片地址是 `tianditu-terrain://{z}/{x}/{y}` */
export const TIANDITU_TERRAIN_PROTOCOL = 'tianditu-terrain';

const PREFIX = `${TIANDITU_TERRAIN_PROTOCOL}://`;
const TILE_URL = /^(\d+)\/(\d+)\/(\d+)$/;
// 换出来的墨卡托瓦片每边的像素
const TILE_SIZE = 256;

/** 处理函数：结构上和 maplibre-gl 的 AddProtocolAction 兼容，可以直接交给 addProtocol */
export type TerrainTileProtocol = (
  request: { readonly url: string },
  abortController: AbortController
) => Promise<{ data: ImageBitmap }>;

/** 天地图的地形：交给 addProtocol 的处理函数（页面注册一次），和注入视图的地形 */
export interface TiandituTerrain {
  readonly protocol: TerrainTileProtocol;
  readonly terrain: MapTerrain;
}

/**
 * 天地图的地形（ADR 0170）：协议把墨卡托的 z/x/y 重采样成 256 × 256 的 terrarium，直接给 MapLibre 位图；
 * 6 级以下没有数据（数据源的 minzoom），12 级以上由 MapLibre 放大。贴地取高度和协议共用读取器的缓存
 */
export function createTiandituTerrain(reader: TiandituTerrainReader): TiandituTerrain {
  const protocol: TerrainTileProtocol = async ({ url }, abortController) => {
    const tile = url.startsWith(PREFIX) ? TILE_URL.exec(url.slice(PREFIX.length)) : null;
    if (!tile) {
      throw new Error(`不是天地图地形的瓦片地址：${url}`);
    }
    const [, z, x, y] = tile;
    const heights = await reader.mercatorTile(Number(z), Number(x), Number(y), TILE_SIZE, abortController.signal);
    const image = new ImageData(encodeTerrarium(heights), TILE_SIZE, TILE_SIZE);
    // 不预乘、不转色彩空间：编码在颜色里的高度要原样读回
    return { data: await createImageBitmap(image, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }) };
  };
  const terrain: MapTerrain = {
    source: {
      type: 'raster-dem',
      tiles: [`${PREFIX}{z}/{x}/{y}`],
      tileSize: TILE_SIZE,
      minzoom: TIANDITU_TERRAIN_MIN_LEVEL,
      maxzoom: TIANDITU_TERRAIN_MAX_LEVEL,
      encoding: 'terrarium'
    },
    heightAt: ([lng, lat], signal) => reader.heightAt(lng, lat, signal)
  };
  return { protocol, terrain };
}
