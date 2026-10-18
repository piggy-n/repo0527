import { Credit, Event, Rectangle, WebMercatorTilingScheme, type ImageryProvider, type TileProviderError } from 'cesium';
import { nativeTileCoordinate, type TileDataSource } from '@yzt/map-core';
import type { BasicStyleLayer } from './style-plan';
import { styleFields } from './style-fields';
import { assertLevel, sourceRectangle } from './raster-provider';
import type { MvtWorkerPool } from './mvt-worker-pool';

export interface MvtProviderOptions {
  readonly baseUrl?: string;
  readonly dataVersion?: string;
  readonly permissionScope?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface MvtProvider extends ImageryProvider, Disposable {
  cancelPending(): void;
}

/** 影像只拥有自己的任务与画布；父矢量数据由视图的 Worker 池复用 */
export function createMvtProvider(
  layer: BasicStyleLayer,
  zoom: number,
  pool: MvtWorkerPool,
  { baseUrl = document.baseURI, dataVersion = 'session', permissionScope = 'view', headers }: MvtProviderOptions = {}
): MvtProvider {
  const source = layer.source;
  if (source?.type !== 'vector' || !source.tiles?.length || !Number.isFinite(zoom)) {
    throw new Error('MVT 影像需要矢量来源和有限相机级别');
  }
  const maximum = source.maxzoom ?? 22;
  const minimum = source.minzoom ?? 0;
  assertLevel(maximum, 'maxzoom');
  assertLevel(minimum, 'minzoom');
  if (minimum > maximum) {
    throw new RangeError('MVT minzoom 不能大于 maxzoom');
  }
  const scheme = source.scheme ?? 'xyz';
  if (scheme !== 'xyz' && scheme !== 'tms') {
    throw new Error('MVT 仅支持 XYZ 或 TMS');
  }
  const tiles = source.tiles.map(template => {
    if (!template.trim() || /[{}]|%7[bd]/i.test(template.replaceAll(/\{[xyz]\}/g, ''))) {
      throw new Error('MVT 地址仅支持 {x}、{y}、{z} 占位符');
    }
    return new URL(template, baseUrl).href;
  });
  const dataSource: TileDataSource = { tiles, dataVersion, permissionScope, scheme };
  const fields = styleFields(layer.specification, source);
  const tilingScheme = new WebMercatorTilingScheme();
  const bounds = sourceRectangle(source.bounds, tilingScheme.rectangle);
  // 先拆跨经线范围，再投影；影像内部裁剪避免 SDK 对精确局部边界求交时的浮点空交集
  const nativeBounds = (bounds.west > bounds.east ? [
    new Rectangle(bounds.west, bounds.south, Math.PI, bounds.north),
    new Rectangle(-Math.PI, bounds.south, bounds.east, bounds.north)
  ] : [bounds]).map(rectangle => tilingScheme.rectangleToNativeRectangle(rectangle));
  const pending = new Set<AbortController>();
  // 恒透明祖先共享一个像素，保留 SDK 层级遍历但不重复分配大画布
  let empty: HTMLCanvasElement | undefined;
  const emptyImage = () => {
    if (!empty) {
      empty = document.createElement('canvas');
      empty.width = 1;
      empty.height = 1;
    }
    return empty;
  };
  let disposed = false;
  const cancelPending = () => {
    for (const controller of pending) {
      controller.abort();
    }
  };
  const provider = {
    rectangle: tilingScheme.rectangle, tilingScheme, tileWidth: 512, tileHeight: 512,
    // SDK 从透明祖先逐级加载；数据最小级别不要求先铺满全球的高等级瓦片
    minimumLevel: 0,
    // 显示子瓦片继续从父矢量重画，不把 source.maxzoom 当成影像的清晰度上限
    maximumLevel: Math.max(22, maximum),
    tileDiscardPolicy: undefined,
    errorEvent: new Event<(error: TileProviderError) => void>(),
    credit: source.attribution ? new Credit(source.attribution) : undefined,
    proxy: undefined,
    hasAlphaChannel: true,
    getTileCredits: () => undefined,
    pickFeatures: () => undefined,
    requestImage: (x, y, level) => {
      if (disposed || !pool.hasCapacity) {
        return undefined;
      }
      const controller = new AbortController();
      pending.add(controller);
      // 即便同步准备出错，也用 rejection 交给 SDK 的单来源错误通道
      return (async () => {
        const tile = { x, y, z: level };
        const coordinate = nativeTileCoordinate(tile, maximum);
        if (level < minimum) {
          // 低于来源 minzoom 不下载，透明祖先仅用于 SDK 的影像层级遍历
          return emptyImage();
        }
        const tileBounds = tilingScheme.tileXYToNativeRectangle(x, y, level);
        const clips = nativeBounds.flatMap(nativeBound => {
          const west = Math.max(nativeBound.west, tileBounds.west);
          const east = Math.min(nativeBound.east, tileBounds.east);
          const south = Math.max(nativeBound.south, tileBounds.south);
          const north = Math.min(nativeBound.north, tileBounds.north);
          return west < east && south < north ? [{ west, east, south, north }] : [];
        });
        if (!clips.length) {
          // 范围外不请求父数据，透明影像只服务于 SDK 的完整根级覆盖
          return emptyImage();
        }
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const row = scheme === 'tms' ? 2 ** coordinate.z - 1 - coordinate.y : coordinate.y;
        const url = tiles[(coordinate.x + coordinate.y) % tiles.length]
          .replaceAll(/\{z\}|%7Bz%7D/gi, String(coordinate.z))
          .replaceAll(/\{x\}|%7Bx%7D/gi, String(coordinate.x))
          .replaceAll(/\{y\}|%7By%7D/gi, String(row));
        const bitmap = await pool.render({ data: { source: dataSource, coordinate, url, headers, fields },
          source, layer: layer.specification, images: layer.images, cameraZoom: zoom, tile, tileSize: 512 }, controller.signal);
        try {
          controller.signal.throwIfAborted();
          const context = canvas.getContext('2d');
          if (!context) { throw new Error('无法创建 MVT 影像画布'); }
          context.beginPath();
          for (const clip of clips) {
            context.rect(
              512 * (clip.west - tileBounds.west) / tileBounds.width,
              512 * (tileBounds.north - clip.north) / tileBounds.height,
              512 * (clip.east - clip.west) / tileBounds.width,
              512 * (clip.north - clip.south) / tileBounds.height
            );
          }
          context.clip();
          context.drawImage(bitmap, 0, 0);
          return canvas;
        } finally {
          // Cesium 纹理上传不负责关闭 ImageBitmap，立即转为可自动回收的 Canvas
          bitmap.close();
        }
      })().catch((error: unknown) => {
        // 已撤销影像不再参与显示，兑现占位避免 SDK 把主动取消打印成来源失败
        if (controller.signal.aborted) { return emptyImage(); }
        throw error;
      }).finally(() => pending.delete(controller));
    },
    cancelPending,
    [Symbol.dispose]: () => { disposed = true; cancelPending(); }
  } satisfies Omit<MvtProvider, 'tileDiscardPolicy' | 'credit' | 'proxy' | 'getTileCredits'> & {
    tileDiscardPolicy: undefined;
    credit: Credit | undefined;
    proxy: undefined;
    getTileCredits(): undefined;
  };
  // 与 SDK 原生提供者一样允许无署名等可选值，发布类型未标注 undefined
  return provider as unknown as MvtProvider;
}
