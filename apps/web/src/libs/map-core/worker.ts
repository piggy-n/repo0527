// ADR 0066：Worker 专用入口，不导出主线程地图实现
export { TileDataService, type TileDataRequest, type TileDataStats } from './tile/tile-data-service';
export {
  nativeTileCoordinate, tileDataKey, tileSourceKey, type TileCoordinate, type TileDataSource
} from './tile/tile-identity';
export { decodeMvt, type DecodedTile, type DecodedTileLayer, type DecodedTileFeature } from './tile/mvt-decode';
export type { StyleImage, StyleImages } from './style/style-image';
