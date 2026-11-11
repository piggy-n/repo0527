import { transfer, type WorkerHandlers } from '@mx/utils';
import type { MvtWorkerProtocol, WorkerStats } from './mvt-protocol';
import { TileSource } from './tile-source';

// 方案 B 的 PoC：Worker 里的处理函数。每个 Worker 一组数据源，各有自己的几何缓存；
// 主线程把同一张下载瓦片的请求固定交给同一个 Worker，所以一张瓦片只解码一次

const sources = new Map<string, TileSource>();

// 这个 Worker 的缓存预算归全部数据源平分：按数据源各给一份的话，总量会随勾选的资源数涨（旧项目因此 Out of Memory）
let budget = 32 * 1024 * 1024;
const MIN_SHARE = 4 * 1024 * 1024;

function rebalance(): void {
  const share = Math.max(MIN_SHARE, Math.floor(budget / Math.max(1, sources.size)));
  sources.forEach(source => source.setBudget(share));
}

const totals = { rendered: 0, fetched: 0, fetchMs: 0, decodeMs: 0, drawMs: 0, bitmapMs: 0, bytes: 0, fromHttpCache: 0, transferBytes: 0 };
const levels: Record<number, number> = {};

function sourceOf(id: string): TileSource {
  const source = sources.get(id);
  if (!source) {
    throw new Error(`没有配置数据源 ${id}`);
  }
  return source;
}

// 位图要显式上下翻转：WebGL 上传 ImageBitmap 时不理会 UNPACK_FLIP_Y_WEBGL，Cesium 自己取影像时也是这样建的位图；
// 不预乘透明度：Cesium 的 RGBA 贴图按没预乘上传
const BITMAP_OPTIONS: ImageBitmapOptions = { imageOrientation: 'flipY', premultiplyAlpha: 'none' };

export const mvtWorkerHandlers: WorkerHandlers<MvtWorkerProtocol> = {
  configure({ id, config }) {
    budget = config.cacheBytes;
    const existing = sources.get(id);
    if (existing) {
      existing.update(config);
    } else {
      sources.set(id, new TileSource(config, budget));
    }
    rebalance();
  },

  async render({ id, tile, headers }) {
    const { canvas, source, features, timing } = await sourceOf(id).render(tile, headers);
    totals.rendered++;
    totals.drawMs += timing.drawMs;
    levels[tile.z] = (levels[tile.z] ?? 0) + 1;
    if (timing.fetched) {
      totals.fetched++;
      totals.fetchMs += timing.fetchMs;
      totals.decodeMs += timing.decodeMs;
      totals.bytes += timing.bytes;
      totals.fromHttpCache += timing.transferBytes === 0 ? 1 : 0;
      totals.transferBytes += timing.transferBytes ?? 0;
    }
    if (!canvas) {
      return { bitmap: null, source, features, timing };
    }
    const started = performance.now();
    const bitmap = await createImageBitmap(canvas, BITMAP_OPTIONS);
    totals.bitmapMs += performance.now() - started;
    return transfer({ bitmap, source, features, timing }, [bitmap]);
  },

  labels({ id, layerId, tiles, limit }) {
    return sourceOf(id).labels(layerId, tiles, limit);
  },

  identify({ id, lng, lat, zoom, tolerance, headers }) {
    return sourceOf(id).identify(lng, lat, zoom, tolerance, headers);
  },

  stats(): WorkerStats {
    let cacheTiles = 0;
    let cacheBytes = 0;
    for (const source of sources.values()) {
      cacheTiles += source.cacheTiles;
      cacheBytes += source.cacheBytes;
    }
    return { ...totals, cacheTiles, cacheBytes, levels: { ...levels } };
  },

  remove({ id }) {
    sources.delete(id);
    rebalance();
  }
};
