// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildFloorGrid } from './floor-grid.ts';
import { ToolError } from './errors.ts';
import { routeOf, trackOf } from './roam.ts';
import { rectangle, walk } from './test-meshes.ts';
import { suggestedSpan, walkwayFloors, walkwayGaps, walkwayOf } from './walkway.ts';

// 30 × 4 米：西边 x 0～10 的地板在 0 米，东边 x 20～30 在 -0.3 米；中间是玻璃栈道，从 0 米斜到 -0.3 米，
// 玻璃没扫到，网格里只有每米一根 0.3 米宽的梁（和栈道一样高）和 1 米深的坑底
const glass = (x: number) => -0.03 * (x - 10);
const walkingSurface = (x: number) => {
  if (x < 10) {
    return 0;
  }
  return x < 20 ? glass(x) : -0.3;
};
const beams = Array.from({ length: 9 }, (_, k) => rectangle(11 + k, 0, 11.3 + k, 4, glass(11 + k), -0.03));
const GLASS_GRID = buildFloorGrid([
  rectangle(0, 0, 10, 4, 0),
  rectangle(10, 0, 20, 4, -1),
  ...beams,
  rectangle(20, 0, 30, 4, -0.3)
]);
// 沿 y = 2 从西往东走，扫描仪离地 1.25 米，在栈道上上下晃 0.15 米
const GLASS_TRACK = trackOf(
  walk([{ from: [0, 2], to: [30, 2] }], x => walkingSurface(x) + (x > 10 && x < 20 ? 0.15 * Math.sin(x * 5) : 0)),
  GLASS_GRID
);

// 轨迹上米数最接近 distance 的点的 x
const xAt = (track: typeof GLASS_TRACK, distance: number) =>
  track.reduce((best, sample) =>
    Math.abs(sample.distance - distance) < Math.abs(best.distance - distance) ? sample : best
  ).point[0];
// 轨迹上 x 最接近的点的米数：米数是三维的，扫描仪上下晃的地方比 x 长
const distanceAt = (track: typeof GLASS_TRACK, x: number) =>
  track.reduce((best, sample) => (Math.abs(sample.point[0] - x) < Math.abs(best.point[0] - x) ? sample : best))
    .distance;

describe('walkwayGaps', () => {
  it('玻璃栈道：梁和坑底交替，脚下的表面一段段差一级台阶以上，连成一个断口', () => {
    const gaps = walkwayGaps(GLASS_TRACK);

    expect(gaps).toHaveLength(1);
    const [gap] = gaps;
    expect(xAt(GLASS_TRACK, gap.from)).toBeGreaterThan(10);
    expect(xAt(GLASS_TRACK, gap.from)).toBeLessThan(11.5);
    expect(xAt(GLASS_TRACK, gap.to)).toBeGreaterThan(18.5);
    expect(xAt(GLASS_TRACK, gap.to)).toBeLessThan(20.5);
    expect(gap.jumps + gap.sunken).toBeGreaterThan(10);
    expect(gap.holes).toBe(0);
  });

  it('整片玻璃下面只有坑底：一路都陷在坑里（比前面的地板低一级台阶以上，扫描仪离它超过 1.5 米）', () => {
    const pit = buildFloorGrid([rectangle(0, 0, 10, 4, 0), rectangle(10, 0, 20, 4, -1), rectangle(20, 0, 30, 4, -0.3)]);
    const gaps = walkwayGaps(trackOf(walk([{ from: [0, 2], to: [30, 2] }], walkingSurface), pit));

    expect(gaps).toHaveLength(1);
    expect(gaps[0].sunken).toBeGreaterThan(30);
    expect(gaps[0].to - gaps[0].from).toBeGreaterThan(9);
  });

  it('下了一个高台阶：扫描仪离新的地面回到正常的高度，不算陷在坑里', () => {
    const ledge = buildFloorGrid([rectangle(0, 0, 10, 4, 0), rectangle(10, 0, 30, 4, -0.6)]);
    expect(walkwayGaps(trackOf(walk([{ from: [0, 2], to: [30, 2] }], x => (x < 10 ? 0 : -0.6)), ledge))).toStrictEqual(
      []
    );
  });

  it('坡、扫描仪离地变高变低都不算断口；走出网格的一段是脚下没有表面的断口', () => {
    // 往下的坡，每米低 0.1 米；扫描的人在坡上把扫描仪举到离地 2 米
    const slope = buildFloorGrid([rectangle(0, 0, 30, 4, 0, -0.1)]);
    const raised = walk([{ from: [0, 2], to: [30, 2] }], x => -0.1 * x + (x > 10 && x < 20 ? 0.75 : 0));
    expect(walkwayGaps(trackOf(raised, slope))).toStrictEqual([]);

    // 再往东走出网格 5 米
    const outside = walk([{ from: [0, 2], to: [35, 2] }], x => (x < 30 ? -0.1 * x : -3));
    const gaps = walkwayGaps(trackOf(outside, slope));
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ jumps: 0 });
    expect(gaps[0].holes).toBe(gaps[0].samples);
  });
});

describe('suggestedSpan', () => {
  it('两头各往外留 2 米，取到 0.5 米，不超出轨迹', () => {
    const gap = { from: 10.3, to: 19.7, samples: 38, jumps: 12, sunken: 20, holes: 0 };
    expect(suggestedSpan(gap, GLASS_TRACK)).toStrictEqual({ from: 8, to: 22 });
    const end = GLASS_TRACK.at(-1)?.distance ?? 0;
    expect(suggestedSpan({ ...gap, from: 1, to: end - 0.5 }, GLASS_TRACK)).toStrictEqual({
      from: 0,
      to: Math.floor(end * 2) / 2
    });
  });
});

describe('walkwayOf', () => {
  it('地板取网格里实际的表面（两头的地板、栈道的梁），中间按米数插值，不跟着扫描仪晃，也不落到坑底', () => {
    const points = walkwayOf(GLASS_TRACK, GLASS_GRID, {
      from: distanceAt(GLASS_TRACK, 8),
      to: distanceAt(GLASS_TRACK, 22)
    });

    expect(points.length).toBeGreaterThanOrEqual(2);
    for (const { x, floor, eye } of points) {
      expect(Math.abs(floor - walkingSurface(x))).toBeLessThan(0.05);
      expect(eye).toBe(1.6);
    }
    // 抽稀以后两头还在：从栈道西边的地板到东边的地板
    expect(points[0].x).toBeLessThan(8.5);
    expect(points.at(-1)?.x).toBeGreaterThan(21.5);
  });

  it('这一段脚下都没有推出的地板附近的表面、不到两个取样点时报错', () => {
    // 栈道没有梁：坑底比人走的低 1 米
    const pit = buildFloorGrid([rectangle(0, 0, 10, 4, 0), rectangle(10, 0, 20, 4, -1), rectangle(20, 0, 30, 4, -0.3)]);
    const track = trackOf(walk([{ from: [0, 2], to: [30, 2] }], walkingSurface), pit);
    expect(() => walkwayOf(track, pit, { from: 12, to: 18 })).toThrow(ToolError);
    expect(() => walkwayOf(GLASS_TRACK, GLASS_GRID, { from: 12, to: 12.1 })).toThrow('不到两个取样点');
  });
});

// 栈道上那一段路线的点
const onGlass = (route: ReturnType<typeof routeOf>) => route.filter(({ x }) => x > 11 && x < 19);

describe('路线经过补的地板', () => {
  it('补的地板那几个取样点的地板给路线用：走在栈道上，不落到坑底', () => {
    const span = { from: distanceAt(GLASS_TRACK, 8), to: distanceAt(GLASS_TRACK, 22) };
    const floors = walkwayFloors(GLASS_TRACK, GLASS_GRID, span);
    const to = distanceAt(GLASS_TRACK, 28);
    const plain = onGlass(routeOf(GLASS_TRACK, 2, to, GLASS_GRID));
    expect(Math.min(...plain.map(({ floor }) => floor))).toBeLessThan(-0.6);
    const over = onGlass(routeOf(GLASS_TRACK, 2, to, GLASS_GRID, { floors }));
    expect(over.length).toBeGreaterThan(0);
    for (const { x, floor } of over) {
      expect(Math.abs(floor - walkingSurface(x))).toBeLessThan(0.05);
    }
  });
});
