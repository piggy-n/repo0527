// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildNavGrid } from './heightfield';
import { HEADROOM_OPEN, NAV_EMPTY } from './nav-data';
import { NavGrid } from './nav-grid';
import { floorQuad, triangles, wallQuad } from './nav-testing';
import { labelRegions } from './regions';
import { findSpawn } from './spawn';

// 10 × 4 米的走廊，3 米高的顶板；x = 5.1 处一堵墙，中间留 door 米宽的门（y 从 1.5 开始）
function corridor(door: number) {
  const raw = buildNavGrid([
    triangles(
      floorQuad(0, 0, 10, 4, 0),
      floorQuad(0, 0, 10, 4, 3),
      wallQuad(5.1, 0, 5.1, 1.5, 0, 3),
      wallQuad(5.1, 1.5 + door, 5.1, 4, 0, 3)
    )
  ]);
  return new NavGrid(labelRegions(raw));
}

// (x, y) 处离地板 0 最近的节点
const nodeAt = (grid: NavGrid, x: number, y: number) => grid.nodeAt(x, y, 0);

describe('buildNavGrid', () => {
  it('有顶板的地板是室内、净空是层高，顶板上面是露天的地板；墙脚下没有地板、墙顶不可站立', () => {
    const raw = buildNavGrid([
      triangles(floorQuad(0, 0, 4, 2, 0), floorQuad(0, 0, 2, 2, 3), wallQuad(3.1, 0, 3.1, 2, 0, 3))
    ]);
    const grid = new NavGrid(raw);
    expect(raw.meta).toMatchObject({ width: 21, height: 11, cellSize: 0.2, maxLevels: 4 });

    const covered = grid.nodeAt(0.5, 1, 0);
    expect(grid.nodeCovered(covered)).toBe(true);
    expect(grid.nodeHeadroom(covered)).toBeCloseTo(3, 1);
    expect(grid.floorsAt(0.5, 1)).toStrictEqual([0, 3]);
    expect(grid.floorsAt(3.1, 1)).toStrictEqual([]);
    const open = grid.nodeAt(2.5, 1, 0);
    expect(grid.nodeCovered(open)).toBe(false);
    expect(raw.headroom[open]).toBe(HEADROOM_OPEN);
    expect(grid.nodeHeadroom(open)).toBe(Infinity);
  });

  it('地面上几厘米高的门槛并进地板，仍然能站；高出地面 0.2 米以上的竖面顶部不可站立', () => {
    const grid = new NavGrid(
      buildNavGrid([
        triangles(floorQuad(0, 0, 4, 2, 0), wallQuad(1.1, 0, 1.1, 2, 0, 0.08), wallQuad(3.1, 0, 3.1, 2, 0, 0.5))
      ])
    );
    expect(grid.floorsAt(1.1, 1).map(value => Math.round(value * 100) / 100)).toStrictEqual([0.08]);
    expect(grid.floorsAt(3.1, 1)).toStrictEqual([]);
  });

    it('顶板低于身高的地方不是地板；没有三角形时抛错', () => {
    const raw = buildNavGrid([triangles(floorQuad(0, 0, 2, 2, 0), floorQuad(0, 0, 2, 2, 1.5))]);
    expect(raw.data.every(value => value === NAV_EMPTY || value >> 1 === 75)).toBe(true);
    expect(() => buildNavGrid([new Float32Array(0)])).toThrow('模型没有可用的三角形');
  });
});

describe('labelRegions', () => {
  it('1.2 米的门两边是同一个区域；贴墙不到一个身体半径的地板站不住', () => {
    const grid = corridor(1.2);
    const left = grid.componentOf(nodeAt(grid, 2, 2));
    expect(left).toBeGreaterThan(0);
    expect(grid.componentOf(nodeAt(grid, 8, 2))).toBe(left);
    expect(grid.componentOf(nodeAt(grid, 4.9, 0.5))).toBe(0);
    expect(grid.componentOf(nodeAt(grid, 0.1, 2))).toBe(0);
    expect(grid.componentSize(left)).toBeGreaterThan(500);
  });

  it('门比身体窄（0.4 米）时两边是两个区域，寻路不通', () => {
    const grid = corridor(0.4);
    const left = grid.componentOf(nodeAt(grid, 2, 2));
    const right = grid.componentOf(nodeAt(grid, 8, 2));
    expect(left).toBeGreaterThan(0);
    expect(right).toBeGreaterThan(0);
    expect(right).not.toBe(left);
    expect(grid.findPath(nodeAt(grid, 2, 2), nodeAt(grid, 8, 2))).toBeNull();
  });
});

describe('NavGrid', () => {
  it('寻路穿过门，拉直后只剩几个拐点、都走得通；直线穿墙走不通', () => {
    const grid = corridor(1.2);
    const path = grid.findPath(nodeAt(grid, 2, 0.6), nodeAt(grid, 8, 0.6));
    expect(path).not.toBeNull();
    const smooth = grid.smoothPath(path ?? []);
    expect(smooth.length).toBeLessThan(6);
    expect(smooth.some(point => Math.abs(point.x - 5.1) < 0.5 && point.y > 1.5 && point.y < 2.7)).toBe(true);
    for (let i = 1; i < smooth.length; i++) {
      expect(grid.walkLine(smooth[i - 1], smooth[i])).toBe(true);
    }
    expect(grid.walkLine({ x: 2, y: 0.6, floor: 0 }, { x: 8, y: 0.6, floor: 0 })).toBe(false);
    // 墙本身一格，加上两侧各约一个身体半径
    expect(grid.blockedLength({ x: 2, y: 0.6, floor: 0 }, { x: 8, y: 0.6, floor: 0 })).toBeCloseTo(0.5, 1);
    expect(grid.findPath(nodeAt(grid, 2, 0.6), nodeAt(grid, 8, 0.6), { maxCost: 3 })).toBeNull();
  });

  it('挪一步：能站的格子返回地板高度；斜着跨过墙角时中间那一格也得能站', () => {
    const grid = corridor(1.2);
    expect(grid.moveFloor(2, 2, 0, 2.15, 2.15)).toBe(0);
    // 墙两侧各一格（0.2 米）贴着墙，站不下
    expect(grid.moveFloor(4.7, 0.6, 0, 4.9, 0.6)).toBeNull();
    // 门洞左侧：格 (24, 9) 斜着跨到 (23, 8)，两格都能站；(24, 8) 贴着门下沿的墙站不下，(23, 9) 能站。
    // 先跨过 y 边界时穿过的是 (24, 8)，走不过去；先跨过 x 边界时穿过的是 (23, 9)，走得过去
    expect(grid.moveFloor(4.85, 1.82, 0, 4.78, 1.7)).toBeNull();
    expect(grid.moveFloor(4.81, 1.98, 0, 4.7, 1.75)).toBe(0);
  });

  it('空处、开阔处与最近的可走点', () => {
    const grid = corridor(1.2);
    expect(grid.isFree(2, 2, 1.5)).toBe(true);
    expect(grid.isFree(2, 2, -0.5)).toBe(false);
    expect(grid.isFree(5.1, 0.5, 1.5)).toBe(false);
    expect(grid.isOpen(2, 2, 0, 0.6)).toBe(true);
    expect(grid.isOpen(4.6, 0.6, 0, 0.6)).toBe(false);
    const nearest = grid.nearestWalkable(5.1, 0.5, 0, { maxRadius: 1 });
    expect(nearest).not.toBeNull();
    expect(grid.componentOf(nearest?.index ?? -1)).toBeGreaterThan(0);
  });

  it('出生点：在目标附近、四周开阔、所在区域够大的室内地板', () => {
    const grid = corridor(1.2);
    const spot = findSpawn(grid, { x: 5.1, y: 0.5, z: 0 }, { mode: 'near', minReach: 100 });
    if (!spot) {
      throw new Error('没有找到出生点');
    }
    expect(grid.isOpen(spot.x, spot.y, spot.floor, 0.6)).toBe(true);
    expect(Math.hypot(spot.x - 5.1, spot.y - 0.5)).toBeLessThan(2);
    // 区域不够大时找不到；top 模式只认不高于 below 的地板
    expect(findSpawn(grid, { x: 2, y: 2, z: 0 }, { mode: 'near', minReach: 100000, maxRadius: 3 })).toBeNull();
    expect(findSpawn(grid, { x: 2, y: 2, z: 0 }, { mode: 'top', below: -1, maxRadius: 3 })).toBeNull();
  });
});
