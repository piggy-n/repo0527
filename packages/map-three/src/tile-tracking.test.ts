import { LRUCache } from '3d-tiles-renderer';
import { describe, expect, it, vi } from 'vitest';
import {
  type StatefulTile,
  TILE_FAILED,
  TILE_LOADED,
  TILE_QUEUED,
  TILE_UNLOADED,
  tileOutcome,
  trackTileRequests,
  watchCacheRemovals
} from './tile-tracking';

// 瓦片库内部的这几处升级时最容易变（ADR 0162）：状态取值、请求的入口、缓存移除的回调
describe('瓦片库的状态和入口', () => {
  it('到了算到了，失败（-1）算失败，回到没请求算取消；排队、下载、解析时还在等', () => {
    expect(tileOutcome(TILE_LOADED)).toBe('loaded');
    expect(tileOutcome(TILE_FAILED)).toBe('failed');
    expect(tileOutcome(TILE_UNLOADED)).toBe('aborted');
    expect([TILE_QUEUED, 2, 3].map(tileOutcome)).toStrictEqual([null, null, null]);
  });

  it('只有从没请求变成排队的瓦片算请求：缓存满了被拒绝、已经在路上的不算；原来的返回值照样给出', () => {
    type Tile = StatefulTile & { readonly internal: { loadingState: number } };
    let full = false;
    const target = {
      requestTileContents(tile: Tile): unknown {
        if (tile.internal.loadingState !== TILE_UNLOADED || full) {
          return undefined;
        }
        tile.internal.loadingState = TILE_QUEUED;
        return 'queued';
      }
    };
    const requested: Tile[] = [];
    trackTileRequests(target, tile => requested.push(tile));

    const first: Tile = { internal: { loadingState: TILE_UNLOADED } };
    expect(target.requestTileContents(first)).toBe('queued');
    expect(target.requestTileContents(first)).toBeUndefined();
    full = true;
    const refused: Tile = { internal: { loadingState: TILE_UNLOADED } };
    target.requestTileContents(refused);
    expect(requested).toStrictEqual([first]);
  });

  it('缓存移除一项时通知：直接移除、淘汰不用的都在原来的回调之后', () => {
    const cache = new LRUCache();
    cache.minSize = 0;
    cache.maxSize = 10;
    const order: string[] = [];
    const removed = vi.fn<(item: unknown) => void>(item => order.push(`通知 ${(item as { id: string }).id}`));
    watchCacheRemovals(cache, removed);
    const items = ['a', 'b', 'c'].map(id => ({ id }));
    for (const item of items) {
      cache.add(item, () => order.push(`回调 ${item.id}`));
    }

    cache.remove(items[0]);
    expect(order).toStrictEqual(['回调 a', '通知 a']);
    // 都不在用：淘汰到 minSize
    cache.markAllUnused();
    cache.unloadUnusedContent();
    expect(removed.mock.calls.length).toBeGreaterThan(1);
    expect(order.slice(2, 4)).toStrictEqual([order[2], order[2]?.replace('回调', '通知')]);
  });
});
