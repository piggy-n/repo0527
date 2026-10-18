import type { RasterSourceSpecification } from '@maplibre/maplibre-gl-style-spec';
import { Rectangle, UrlTemplateImageryProvider, WebMercatorTilingScheme, type ImageryProvider } from 'cesium';

// SDK 的瓦片数量使用位移计算，31 级起会溢出
const MAX_LEVEL = 30;

/** 按会话的栅格源创建影像提供者，URL 展开、请求节流和取消仍交给 SDK */
export function createRasterProvider(source: RasterSourceSpecification): ImageryProvider {
  if (source.url !== undefined) {
    throw new Error('三维栅格暂不支持 TileJSON url，请提供 tiles');
  }
  if (!source.tiles?.length) {
    throw new Error('三维栅格需要至少一个 tiles 地址');
  }
  const scheme = source.scheme ?? 'xyz';
  if (scheme !== 'xyz' && scheme !== 'tms') {
    throw new Error(`三维栅格不支持 scheme：${String(scheme)}`);
  }
  const urls = source.tiles.map(url => tileTemplate(url, scheme));
  const minimumLevel = source.minzoom ?? 0;
  const maximumLevel = source.maxzoom ?? 22;
  const tileSize = source.tileSize ?? 512;
  assertLevel(minimumLevel, 'minzoom');
  assertLevel(maximumLevel, 'maxzoom');
  if (maximumLevel < minimumLevel) {
    throw new RangeError('三维栅格 maxzoom 不能小于 minzoom');
  }
  if (!Number.isSafeInteger(tileSize) || tileSize <= 0) {
    throw new RangeError('三维栅格 tileSize 必须是正整数');
  }

  const tilingScheme = new WebMercatorTilingScheme();
  const rectangle = sourceRectangle(source.bounds, tilingScheme.rectangle);
  assertMinimumCoverage(tilingScheme, rectangle, minimumLevel);
  const providers = urls.map(url => new UrlTemplateImageryProvider({
    url, tilingScheme, minimumLevel, maximumLevel,
    tileWidth: tileSize, tileHeight: tileSize,
    credit: source.attribution,
    enablePickFeatures: false
  }));
  const first = providers[0];

  // 每个模板保留自己的 Resource；不改写实例 URL，也不绕过 SDK 的 RequestScheduler
  return {
    rectangle,
    tileWidth: first.tileWidth,
    tileHeight: first.tileHeight,
    maximumLevel: first.maximumLevel,
    minimumLevel: first.minimumLevel,
    tilingScheme: first.tilingScheme,
    tileDiscardPolicy: first.tileDiscardPolicy,
    errorEvent: first.errorEvent,
    credit: first.credit,
    proxy: first.proxy,
    hasAlphaChannel: first.hasAlphaChannel,
    getTileCredits: (x, y, level) => first.getTileCredits(x, y, level),
    requestImage: (x, y, level, request) => providers[(x + y) % providers.length].requestImage(x, y, level, request),
    pickFeatures: () => undefined
  };
}

// 仅接收 MapLibre 的 XYZ 占位符，避免 SDK 对未知占位符原样发请求
function tileTemplate(url: string, scheme: 'xyz' | 'tms'): string {
  if (url.trim().length === 0) {
    throw new Error('三维栅格 tiles 地址不能为空');
  }
  const remaining = url.replaceAll(/\{[xyz]\}/g, '');
  if (/[{}]|%7[bd]/i.test(remaining)) {
    throw new Error('三维栅格 tiles 只支持 {x}、{y}、{z} 占位符');
  }
  return scheme === 'tms' ? url.replaceAll('{y}', '{reverseY}') : url;
}

function assertLevel(level: number, name: string): void {
  if (!Number.isInteger(level) || level < 0 || level > MAX_LEVEL) {
    throw new RangeError(`三维栅格 ${name} 必须是 0～${MAX_LEVEL} 的整数`);
  }
}

// 墨卡托影像只覆盖投影的有效纬度，保留跨 180° 经线的 bounds
function sourceRectangle(bounds: RasterSourceSpecification['bounds'], world: Rectangle): Rectangle {
  if (!bounds) {
    return world;
  }
  const [west, south, east, north] = bounds;
  if (bounds.length !== 4 || !bounds.every(Number.isFinite) ||
    west < -180 || west > 180 || east < -180 || east > 180 || west === east ||
    south < -90 || north > 90 || south >= north) {
    throw new RangeError('三维栅格 bounds 必须是有效的西、南、东、北经纬度范围');
  }
  const requested = Rectangle.fromDegrees(west, south, east, north);
  // SDK 的 Rectangle.intersection 与全球范围求交会截短跨经线范围，这里只裁纬度
  const rectangle = new Rectangle(requested.west, Math.max(requested.south, world.south),
    requested.east, Math.min(requested.north, world.north));
  if (rectangle.width <= 0 || rectangle.height <= 0) {
    throw new RangeError('三维栅格 bounds 不在 Web Mercator 有效范围内');
  }
  return rectangle;
}

// 与 SDK 的 OpenStreetMapImageryProvider 一样，阻止最小级别铺满大量瓦片导致渲染异常
function assertMinimumCoverage(tilingScheme: WebMercatorTilingScheme, rectangle: Rectangle, level: number): void {
  const southwest = tilingScheme.positionToTileXY(Rectangle.southwest(rectangle), level);
  const northeast = tilingScheme.positionToTileXY(Rectangle.northeast(rectangle), level);
  const columns = tilingScheme.getNumberOfXTilesAtLevel(level);
  const width = rectangle.west > rectangle.east
    ? Math.min(columns, columns - southwest.x + northeast.x + 1)
    : northeast.x - southwest.x + 1;
  const count = width * (southwest.y - northeast.y + 1);
  if (count > 4) {
    throw new RangeError(`三维栅格 minzoom=${level} 的 bounds 覆盖 ${count} 块瓦片，最多支持 4 块`);
  }
}
