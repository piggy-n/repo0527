import { describe, expect, it } from 'vitest';
import type { PreparedTileset } from '../prepare-tileset';
import { buildNavigation } from './nav-build';
import { toEcef } from './nav-frame';
import { b3dmOf, twoLevelStation } from './nav-testing';

// 局部系是 (lng, lat) 处的东北天
function enuAt(lng: number, lat: number): number[] {
  const lambda = (lng * Math.PI) / 180;
  const phi = (lat * Math.PI) / 180;
  const east = [-Math.sin(lambda), Math.cos(lambda), 0];
  const north = [-Math.sin(phi) * Math.cos(lambda), -Math.sin(phi) * Math.sin(lambda), Math.cos(phi)];
  const up = [Math.cos(phi) * Math.cos(lambda), Math.cos(phi) * Math.sin(lambda), Math.sin(phi)];
  return [...east, 0, ...north, 0, ...up, 0, ...toEcef(lng, lat, 0), 1];
}

describe('buildNavigation（真实的 Worker）', () => {
  it('瓦片转移给 nav-grid.worker.ts 构建，网格的类型化数组转移回来', async () => {
    const tileset: PreparedTileset = {
      geometricError: 100,
      root: {
        geometricError: 0,
        boundingVolume: { box: [0, 0, 0, 20, 0, 0, 0, 20, 0, 0, 0, 10] },
        transform: enuAt(120.6647, 31.3175),
        content: { uri: 'https://maps.test/station.b3dm' }
      }
    };
    const tile = b3dmOf(twoLevelStation());

    const { grid } = await buildNavigation(tileset, {
      signal: AbortSignal.timeout(20000),
      download: () => Promise.resolve(tile)
    });

    // 下载的瓦片已经转移给 Worker
    expect(tile.byteLength).toBe(0);
    expect(grid.labels).toBeInstanceOf(Uint16Array);
    const upper = grid.componentAt(10, 22, -5);
    expect(upper).toBeGreaterThan(0);
    expect(grid.componentAt(10, 6, -10)).toBe(upper);
  });
});
