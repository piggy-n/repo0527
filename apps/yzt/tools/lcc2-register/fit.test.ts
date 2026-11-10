// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { FIT_WINDOW, fitShift, SCANNER_WINDOW, scoreShift } from './fit.ts';
import { buildFloorGrid } from './floor-grid.ts';
import type { Vec3 } from './lcc2-data.ts';
import { rectangle, translate, walk } from './test-meshes.ts';

// 合成的场景：三条走廊，地面有几级台阶，水平、竖直方向都能定下来。
// 台阶要比扫描仪高度的窗口（0.5 米）高，否则跨过台阶的点能用竖直平移补回来
//   A：x 0～40、y 0～3，x 20 以东高 0.8 米
//   B：x 37～40、y 3～30，y 15 以南高 1.6、以北高 2.4
//   C：x 10～13、y 3～20，下沉 0.8 米
const SCENE = [
  rectangle(0, 0, 20, 3, 0),
  rectangle(20, 0, 40, 3, 0.8),
  rectangle(37, 3, 40, 15, 1.6),
  rectangle(37, 15, 40, 30, 2.4),
  rectangle(10, 3, 13, 20, -0.8)
];

function floorAt(x: number, y: number): number {
  if (y < 3) {
    return x < 20 ? 0 : 0.8;
  }
  if (x >= 37) {
    return y < 15 ? 1.6 : 2.4;
  }
  return -0.8;
}

// 每 0.1 米取一个点：只有几条台阶的边，默认的 0.5 米取样定不到 0.1 米以内
const OPTIONS = { sampleSpacing: 0.1 };

const TRAJECTORY = walk(
  [
    { from: [1.5, 1.5], to: [38.5, 1.5] },
    { from: [38.5, 1.5], to: [38.5, 28.5] },
    { from: [11.5, 1.5], to: [11.5, 18.5] }
  ],
  floorAt
);

describe('fitShift', () => {
  it('网格相对轨迹整体平移：求出的平移水平误差不到 0.1 米，竖直不到 0.05 米', () => {
    const truth: Vec3 = [3.7, -2.4, -6.3];
    const grid = buildFloorGrid(SCENE.map((mesh) => translate(mesh, truth)));
    expect(scoreShift(TRAJECTORY, grid, [0, 0, 0], FIT_WINDOW)).toBeLessThan(0.1);

    const fit = fitShift(TRAJECTORY, grid, OPTIONS);
    expect(Math.abs(fit.shift[0] - truth[0])).toBeLessThan(0.1);
    expect(Math.abs(fit.shift[1] - truth[1])).toBeLessThan(0.1);
    expect(Math.abs(fit.shift[2] - truth[2])).toBeLessThan(0.05);
    expect(fit.score).toBeGreaterThan(0.99);
    expect(fit.scannerScore).toBeGreaterThan(0.95);
  });

  it('没有平移：结果接近 0', () => {
    const fit = fitShift(TRAJECTORY, buildFloorGrid(SCENE), OPTIONS);
    expect(Math.hypot(...fit.shift)).toBeLessThan(0.1);
  });

  it('扫描仪离地的高度决定竖直平移：轨迹整体高 0.25 米，要往下挪 0.25 米（网格往上）', () => {
    const higher = TRAJECTORY.map(([x, y, z]): Vec3 => [x, y, z + 0.25]);
    const fit = fitShift(higher, buildFloorGrid(SCENE), OPTIONS);
    expect(fit.shift[2]).toBeCloseTo(-0.25, 1);
  });

  it('只认脚下最近的一层：地面上方 0.6 米处处另有一层时，轨迹要比它高 1～1.5 米', () => {
    const upper = SCENE.map((mesh) => translate(mesh, [0, 0, 0.6]));
    const fit = fitShift(TRAJECTORY, buildFloorGrid([...SCENE, ...upper]), OPTIONS);
    expect(fit.shift[2]).toBeCloseTo(0.6, 1);
  });

  it('网格是空的：不平移，得分 0', () => {
    expect(fitShift(TRAJECTORY, buildFloorGrid([]))).toEqual({ shift: [0, 0, 0], score: 0, scannerScore: 0 });
  });
});

describe('scoreShift', () => {
  it('按脚下最近的表面算，不看更低的层', () => {
    // 两层：0 和 1。点在 1.25：离上层 0.25（不满足宽窗口），离下层 1.25
    const grid = buildFloorGrid([rectangle(0, 0, 10, 10, 0), rectangle(0, 0, 10, 10, 1)]);
    expect(scoreShift([[5, 5, 1.25]], grid, [0, 0, 0], FIT_WINDOW)).toBe(0);
    expect(scoreShift([[5, 5, 2.25]], grid, [0, 0, 0], SCANNER_WINDOW)).toBe(1);
  });
});
