// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { FIT_WINDOW, fitShift, SCANNER_WINDOW, scoreShift } from './fit.ts';
import { buildFloorGrid } from './floor-grid.ts';
import type { Vec3 } from './lcc2-data.ts';
import { CORRIDOR_WALK, CORRIDORS, rectangle, translate } from './test-meshes.ts';

// 每 0.1 米取一个点：只有几条台阶的边，默认的 0.5 米取样定不到 0.1 米以内
const OPTIONS = { sampleSpacing: 0.1 };

describe('fitShift', () => {
  it('网格相对轨迹整体平移：求出的平移水平误差不到 0.1 米，竖直不到 0.05 米', () => {
    const truth: Vec3 = [3.7, -2.4, -6.3];
    const grid = buildFloorGrid(CORRIDORS.map((mesh) => translate(mesh, truth)));
    expect(scoreShift(CORRIDOR_WALK, grid, [0, 0, 0], FIT_WINDOW)).toBeLessThan(0.1);

    const fit = fitShift(CORRIDOR_WALK, grid, OPTIONS);
    expect(Math.abs(fit.shift[0] - truth[0])).toBeLessThan(0.1);
    expect(Math.abs(fit.shift[1] - truth[1])).toBeLessThan(0.1);
    expect(Math.abs(fit.shift[2] - truth[2])).toBeLessThan(0.05);
    expect(fit.score).toBeGreaterThan(0.99);
    expect(fit.scannerScore).toBeGreaterThan(0.95);
  });

  // cli.ts（register.ts）用的是默认参数：取样间隔、粗搜步长改大以后这里会差到 0.4～0.5 米
  it.each<[string, Vec3]>([
    ['彭城广场那么大的平移', [-15.34, 83.24, 24.11]],
    ['几米的平移', [3.7, -2.4, -6.3]]
  ])('默认参数：%s，水平每个方向差不到 0.25 米，竖直不到 0.05 米', (_, truth) => {
    const fit = fitShift(CORRIDOR_WALK, buildFloorGrid(CORRIDORS.map((mesh) => translate(mesh, truth))));
    expect(Math.abs(fit.shift[0] - truth[0])).toBeLessThan(0.25);
    expect(Math.abs(fit.shift[1] - truth[1])).toBeLessThan(0.25);
    expect(Math.abs(fit.shift[2] - truth[2])).toBeLessThan(0.05);
  });

  it('没有平移：结果接近 0', () => {
    const fit = fitShift(CORRIDOR_WALK, buildFloorGrid(CORRIDORS), OPTIONS);
    expect(Math.hypot(...fit.shift)).toBeLessThan(0.1);
  });

  it('扫描仪离地的高度决定竖直平移：轨迹整体高 0.25 米，要往下挪 0.25 米（网格往上）', () => {
    const higher = CORRIDOR_WALK.map(([x, y, z]): Vec3 => [x, y, z + 0.25]);
    const fit = fitShift(higher, buildFloorGrid(CORRIDORS), OPTIONS);
    expect(fit.shift[2]).toBeCloseTo(-0.25, 1);
  });

  it('只认脚下最近的一层：地面上方 0.6 米处处另有一层时，轨迹要比它高 1～1.5 米', () => {
    const upper = CORRIDORS.map((mesh) => translate(mesh, [0, 0, 0.6]));
    const fit = fitShift(CORRIDOR_WALK, buildFloorGrid([...CORRIDORS, ...upper]), OPTIONS);
    expect(fit.shift[2]).toBeCloseTo(0.6, 1);
  });

  it('网格是空的：不平移，得分 0', () => {
    expect(fitShift(CORRIDOR_WALK, buildFloorGrid([]))).toEqual({ shift: [0, 0, 0], score: 0, scannerScore: 0 });
  });
});

describe('scoreShift', () => {
  // 两层：0 和 1
  const grid = buildFloorGrid([rectangle(0, 0, 10, 10, 0), rectangle(0, 0, 10, 10, 1)]);

  it('按脚下最近的表面算，不看更低的层', () => {
    // 点在 1.25：离上层 0.25（不满足宽窗口），离下层 1.25
    expect(scoreShift([[5, 5, 1.25]], grid, [0, 0, 0], FIT_WINDOW)).toBe(0);
    expect(scoreShift([[5, 5, 2.25]], grid, [0, 0, 0], SCANNER_WINDOW)).toBe(1);
  });

  it('竖直平移算进点的高度，再找脚下最近的一层', () => {
    // 0.5 抬 1 米到 1.5：离上层 0.5，不满足；0.25 抬 2 米到 2.25：离上层 1.25，满足
    expect(scoreShift([[5, 5, 0.5]], grid, [0, 0, 1], SCANNER_WINDOW)).toBe(0);
    expect(scoreShift([[5, 5, 0.25]], grid, [0, 0, 2], SCANNER_WINDOW)).toBe(1);
  });
});
