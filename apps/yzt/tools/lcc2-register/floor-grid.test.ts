// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildFloorGrid, floorBelow, floorsAt } from './floor-grid.ts';
import { rectangle } from './test-meshes.ts';

describe('buildFloorGrid', () => {
  it('水平面：方格里是它的高度，网格外没有', () => {
    const grid = buildFloorGrid([rectangle(0, 0, 10, 10, 5)]);
    expect([...floorsAt(grid, 3.3, 7.1)]).toEqual([5]);
    expect(floorsAt(grid, 11, 5)).toHaveLength(0);
    expect(floorsAt(grid, -1, 5)).toHaveLength(0);
  });

  it('坡面：高度按方格中心插值，误差不超过半个方格乘坡度', () => {
    // 沿 x 每米升 0.5 米（约 27°）
    const grid = buildFloorGrid([rectangle(0, 0, 10, 10, 0, 0.5)]);
    for (const x of [1.03, 4.5, 8.97]) {
      const [height] = floorsAt(grid, x, 5);
      expect(height).toBeCloseTo(x * 0.5, 1);
    }
  });

  it('几层：脚下最近的是不高于点的最高一层', () => {
    const grid = buildFloorGrid([rectangle(0, 0, 10, 10, 0), rectangle(0, 0, 10, 10, 3)]);
    expect([...floorsAt(grid, 5, 5)]).toEqual([0, 3]);
    expect(floorBelow(grid, 5, 5, 2)).toBe(0);
    expect(floorBelow(grid, 5, 5, 4.2)).toBe(3);
    expect(floorBelow(grid, 5, 5, -0.5)).toBeUndefined();
  });

  it('竖直的墙跳过', () => {
    const wall = {
      positions: Float32Array.from([2, 2, 0, 8, 2, 0, 8, 2, 3]),
      triangles: Uint32Array.from([0, 1, 2])
    };
    expect(buildFloorGrid([wall]).heights).toHaveLength(0);
  });

  it('比方格小的三角形记在重心所在的方格里', () => {
    const tiny = {
      positions: Float32Array.from([1.01, 1.01, 2, 1.05, 1.01, 2, 1.01, 1.05, 2]),
      triangles: Uint32Array.from([0, 1, 2])
    };
    const grid = buildFloorGrid([tiny]);
    expect([...floorsAt(grid, 1.1, 1.1)]).toEqual([2]);
  });

  it('同一高度的相邻三角形在一个方格里只算一层', () => {
    const grid = buildFloorGrid([rectangle(0, 0, 10, 10, 1)]);
    expect([...floorsAt(grid, 5.1, 5.1)]).toEqual([1]);
    expect(grid.triangleCount).toBe(2);
  });
});
