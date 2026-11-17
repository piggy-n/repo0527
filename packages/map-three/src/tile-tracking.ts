import type { TileOutcome } from '@mx/map-core';
import type { LRUCache } from '3d-tiles-renderer';

// 统计这一轮的加载（ADR 0162）要碰的瓦片库内部：瓦片的状态取值、请求的入口、缓存移除的回调。
// 这些都不在库的类型声明里，版本锁定，升级时由这里的测试和 tile-budget、契约的浏览器测试发现

/** 瓦片的加载状态：库的常量 FAILED、UNLOADED、QUEUED、LOADED，类型声明里没有导出 */
export const TILE_FAILED = -1;
export const TILE_UNLOADED = 0;
export const TILE_QUEUED = 1;
export const TILE_LOADED = 4;

/** 请求过的瓦片现在的结果：到了、失败、回到"没请求"（被缓存淘汰、不再要）算取消；还在排队、下载、解析（含等上传）时为 null */
export function tileOutcome(loadingState: number): TileOutcome | null {
  switch (loadingState) {
    case TILE_LOADED:
      return 'loaded';
    case TILE_FAILED:
      return 'failed';
    case TILE_UNLOADED:
      return 'aborted';
    default:
      return null;
  }
}

/** 有加载状态的瓦片 */
export interface StatefulTile {
  readonly internal: { readonly loadingState: number };
}

/**
 * 包住库的 requestTileContents：瓦片从"没请求"变成"排队"时才交给 onRequest。排进下载队列以后缓存满了库会拒绝
 * （状态不变），已经在路上的再请求也什么都不做，这两种都不算
 */
export function trackTileRequests<T extends StatefulTile>(
  target: { requestTileContents(tile: T): unknown },
  onRequest: (tile: T) => void
): void {
  const request = target.requestTileContents.bind(target);
  target.requestTileContents = tile => {
    const before = tile.internal.loadingState;
    const result = request(tile);
    if (before === TILE_UNLOADED && tile.internal.loadingState === TILE_QUEUED) {
      onRequest(tile);
    }
    return result;
  };
}

/**
 * 包住缓存的 add：一项被移除时（淘汰、缓存满了到了也不留、不再要的在路上的）调用 onRemoved。库在这些时候不发事件，
 * 淘汰还在选瓦片之后的微任务、之后的动画帧里，地图不一定再画；onRemoved 在库改完瓦片的状态以后调用
 */
export function watchCacheRemovals(cache: LRUCache, onRemoved: (item: unknown) => void): void {
  const add = cache.add.bind(cache);
  cache.add = (item: unknown, removeCb: (removed: unknown) => void) =>
    add(item, removed => {
      removeCb(removed);
      onRemoved(removed);
    });
}
