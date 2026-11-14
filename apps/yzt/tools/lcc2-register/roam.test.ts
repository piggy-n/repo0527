// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildFloorGrid } from './floor-grid.ts';
import type { Vec3 } from './lcc2-data.ts';
import { EYE_HEIGHT, type RoamPoint, routeOf, simplify, spawnOf, trackOf } from './roam.ts';
import { rectangle, walk } from './test-meshes.ts';

// 20 × 4 米的地面；x 10～20 头顶 1.5 米有顶（矮墓道）；x 5.0～5.2 地上一道 0.35 米高的门槛
const GRID = buildFloorGrid([
  rectangle(0, 0, 20, 4, 0),
  rectangle(10, 0, 20, 4, 1.5),
  rectangle(5, 0, 5.2, 4, 0.35)
]);
// 沿 y = 2 从西往东走，扫描仪离地 1.25 米（门槛上照样离地面 1.25 米）
const TRAJECTORY = walk([{ from: [0, 2], to: [20, 2] }], () => 0);

describe('trackOf', () => {
  it('每 0.25 米一个点，累计米数；脚下、头顶的表面', () => {
    const track = trackOf(TRAJECTORY, GRID);
    expect(track.at(-1)?.distance).toBeGreaterThan(19.5);
    const at = (x: number) => track.find(({ point }) => point[0] >= x);
    expect(at(2)).toMatchObject({ floor: 0, ceiling: undefined });
    expect(at(15)).toMatchObject({ floor: 0, ceiling: 1.5 });
    // 门槛上脚下的表面是门槛顶
    expect(at(5.05)?.floor).toBeCloseTo(0.35, 6);
  });
});

// 1.2 米宽、20 米长的通道（两边没有网格就是墙），头顶 2.5 米；扫描的人在里面左右摆着走（y 0.35～0.85，每 4 米一个来回）
const corridor = (...extra: ReturnType<typeof rectangle>[]) =>
  buildFloorGrid([rectangle(0, 0, 20, 1.2, 0), rectangle(0, 0, 20, 1.2, 2.5), ...extra]);
const zigzag = walk(
  Array.from({ length: 10 }, (_, i) => ({
    from: [i * 2, i % 2 === 0 ? 0.35 : 0.85] as const,
    to: [(i + 1) * 2, i % 2 === 0 ? 0.85 : 0.35] as const
  })),
  () => 0
);
// 路线上的点离首尾连线的最大水平距离
const bend = (route: readonly RoamPoint[]) => {
  const first = route[0];
  const last = route.at(-1);
  if (!first || !last) {
    throw new Error('路线没有点');
  }
  const length = Math.hypot(last.x - first.x, last.y - first.y);
  return Math.max(
    ...route.map(
      ({ x, y }) => Math.abs((last.x - first.x) * (first.y - y) - (first.x - x) * (last.y - first.y)) / length
    )
  );
};

// 沿路线每 5 厘米一个点
function along(route: readonly RoamPoint[]): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1];
    const b = route[i];
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.05);
    for (let s = 0; s <= steps; s++) {
      points.push({ x: a.x + ((b.x - a.x) * s) / steps, y: a.y + ((b.y - a.y) * s) / steps });
    }
  }
  return points;
}

describe('routeOf', () => {
  it('贴地板、门槛按中位数滤掉；矮墓道里眼高 = 净空 - 0.2；直线抽稀成几个点', () => {
    const route = routeOf(trackOf(TRAJECTORY, GRID), 2, 18, GRID);
    expect(route.length).toBeLessThanOrEqual(5);
    expect(route.every(({ floor }) => floor === 0)).toBe(true);
    expect(route[0]).toMatchObject({ eye: EYE_HEIGHT });
    expect(route[0]?.x).toBeCloseTo(2, 0);
    expect(route.at(-1)?.eye).toBeCloseTo(1.3, 6);
    expect(route.at(-1)?.x).toBeCloseTo(18, 0);
  });

  it('门楣、梁只占一两个取样点，眼高照样降下来，不按中位数滤掉', () => {
    // x 6.0～6.3 头顶 1.4 米有一道梁，扫描仪在它下面
    const grid = buildFloorGrid([rectangle(0, 0, 12, 4, 0), rectangle(6, 0, 6.3, 4, 1.4)]);
    const route = routeOf(trackOf(walk([{ from: [0, 2], to: [12, 2] }], () => 0), grid), 1, 11, grid);
    // 路线上 x 处的眼高（按前后两点插值，同 RoutePath）
    const eyeAt = (x: number) => {
      const next = route.findIndex(point => point.x >= x);
      const a = route[next - 1];
      const b = route[next];
      if (!a || !b) {
        throw new Error(`路线在 x ${x} 两边没有点`);
      }
      return a.eye + ((b.eye - a.eye) * (x - a.x)) / (b.x - a.x);
    };
    for (const x of [6, 6.15, 6.3]) {
      expect(eyeAt(x)).toBeLessThanOrEqual(1.2 + 0.08);
    }
    expect(eyeAt(3)).toBe(EYE_HEIGHT);
    expect(eyeAt(9)).toBe(EYE_HEIGHT);
  });

  it('眼高按路线的地板算：一个取样点脚下是栏杆顶，视点不跟着压低', () => {
    // 头顶 2 米处整条有顶；x 6.0～6.3 有一道 0.9 米高的栏杆，扫描仪从它上面过，这个点"脚下的表面"是栏杆顶
    const grid = buildFloorGrid([
      rectangle(0, 0, 12, 4, 0),
      rectangle(0, 0, 12, 4, 2),
      rectangle(6, 0, 6.3, 4, 0.9)
    ]);
    const route = routeOf(trackOf(walk([{ from: [0, 2], to: [12, 2] }], () => 0), grid), 1, 11, grid);
    expect(route.every(({ floor }) => floor === 0)).toBe(true);
    expect(route.map(({ eye }) => eye)).toStrictEqual(route.map(() => EYE_HEIGHT));
  });

  it('通道里左右摆的轨迹拉成一条直线', () => {
    const route = routeOf(trackOf(zigzag, corridor()), 1, 19, corridor());
    expect(bend(route)).toBeLessThan(0.03);
    expect(route.every(({ floor, eye }) => floor === 0 && eye === EYE_HEIGHT)).toBe(true);
  });

  it('地面上一格宽的洞（扫描漏掉的）不打断直线', () => {
    const grid = buildFloorGrid([
      rectangle(0, 0, 9.9, 1.2, 0),
      rectangle(10.1, 0, 20, 1.2, 0),
      rectangle(0, 0, 20, 1.2, 2.5)
    ]);
    const route = routeOf(trackOf(zigzag, grid), 1, 19, grid);
    expect(bend(route)).toBeLessThan(0.03);
  });

  it('拉直后离墙仍有 0.2 米：通道变窄处直线会贴到墙，拐点留着', () => {
    // x 10 以前 y 0～1.6，以后收窄成 y 0～0.6；扫描的人走在两段的中间。首尾连线在 x 10.4 处 y 约 0.54，离墙只有 0.06 米
    const grid = buildFloorGrid([rectangle(0, 0, 10, 1.6, 0), rectangle(10, 0, 20, 0.6, 0)]);
    const track = trackOf(
      walk(
        [
          { from: [0, 0.8], to: [10, 0.8] },
          { from: [10, 0.8], to: [10.3, 0.3] },
          { from: [10.3, 0.3], to: [20, 0.3] }
        ],
        () => 0
      ),
      grid
    );
    const route = routeOf(track, 1, 19, grid);
    // 窄的一段里每 5 厘米离墙（y 0.6）至少约 0.2 米（方格 0.2 米，差几厘米）
    const narrow = along(route).filter(({ x }) => x > 10.4);
    expect(narrow.length).toBeGreaterThan(0);
    expect(Math.max(...narrow.map(({ y }) => y))).toBeLessThan(0.42);
  });

  it('拉直不穿墙：通道错开 0.8 米，偏差在容差以内但直线会穿过墙角，拐点留着', () => {
    // 西段 y 0～1，东段 y 0.8～1.8，x 5～5.5 两段重叠处能过去；错开的地方不在中间，首尾连线在 x 6 处 y 约 0.72，在墙里
    const grid = buildFloorGrid([rectangle(0, 0, 5.5, 1, 0), rectangle(5, 0.8, 20, 1.8, 0)]);
    const track = trackOf(
      walk(
        [
          { from: [0, 0.5], to: [5.25, 0.5] },
          { from: [5.25, 0.5], to: [5.25, 1.3] },
          { from: [5.25, 1.3], to: [20, 1.3] }
        ],
        () => 0
      ),
      grid
    );
    const route = routeOf(track, 1, 19, grid);
    // 路线上每 5 厘米都在地面上（不在墙里）
    const inWall = along(route).filter(
      ({ x, y }) => !((x <= 5.5 && y >= 0 && y <= 1) || (x >= 5 && y >= 0.8 && y <= 1.8))
    );
    expect(inWall).toStrictEqual([]);
  });

  it('拉直以后，梁下面的低眼高还在原来的地方', () => {
    // x 10.0～10.3 头顶 1.4 米有一道梁
    const grid = corridor(rectangle(10, 0, 10.3, 1.2, 1.4));
    const route = routeOf(trackOf(zigzag, grid), 1, 19, grid);
    expect(bend(route)).toBeLessThan(0.03);
    const eyeAt = (x: number) => {
      const next = route.findIndex(point => point.x >= x);
      const a = route[next - 1];
      const b = route[next];
      if (!a || !b) {
        throw new Error(`路线在 x ${x} 两边没有点`);
      }
      return a.eye + ((b.eye - a.eye) * (x - a.x)) / (b.x - a.x);
    };
    for (const x of [10, 10.15, 10.3]) {
      expect(eyeAt(x)).toBeLessThanOrEqual(1.2 + 0.08);
    }
    expect(eyeAt(6)).toBe(EYE_HEIGHT);
    expect(eyeAt(15)).toBe(EYE_HEIGHT);
  });

  it('中间脚下没有网格的按前后插值；段不在轨迹里、整段没有网格时报错', () => {
    // 地面在 x 8～9 断开，在 x 12 以后高 0.4 米
    const grid = buildFloorGrid([
      rectangle(0, 0, 8, 4, 0),
      rectangle(9, 0, 12, 4, 0),
      rectangle(12, 0, 20, 4, 0.4)
    ]);
    const track = trackOf(
      walk([{ from: [0, 2], to: [20, 2] }], x => (x > 12 ? 0.4 : 0)),
      grid
    );
    const route = routeOf(track, 1, 19, grid);
    expect(route[0]?.x).toBeCloseTo(1, 0);
    // 米数按扫描仪走过的三维长度算，x 12 处上了 0.4 米，19 米在 x 18 多一点
    expect(route.at(-1)?.x).toBeGreaterThan(18);
    expect(route.filter(({ x }) => x < 11.5).every(({ floor }) => floor === 0)).toBe(true);
    // 地面方格的高度是 Float32
    expect(route.filter(({ x }) => x > 12.5).every(({ floor }) => Math.abs(floor - 0.4) < 1e-6)).toBe(true);
    expect(() => routeOf(track, 10, 30, grid)).toThrow('不在轨迹里');
    const offMesh: Vec3[] = walk([{ from: [30, 2], to: [40, 2] }], () => 0);
    expect(() => routeOf(trackOf(offMesh, grid), 1, 5, grid)).toThrow('脚下没有网格');
  });
});

describe('spawnOf', () => {
  it('从第一个站着拿扫描仪、头顶够高的点出生，朝向是之后 8 米的方向；开头在网格外、蹲着的点不算', () => {
    const points: Vec3[] = [
      ...walk([{ from: [-4, 2], to: [0, 2] }], () => 0),
      ...walk([{ from: [0, 2], to: [3, 2] }], () => 0, 0.6),
      ...walk([{ from: [3, 2], to: [3, 4] }, { from: [3, 4], to: [15, 4] }], () => 0)
    ];
    const { point, yaw } = spawnOf(trackOf(points, GRID));
    expect(point.x).toBeCloseTo(3, 0);
    expect(point.floor).toBe(0);
    // 8 米以后是往东（局部 x）走的那一段，比开头往北的 2 米要远
    expect(yaw).toBeGreaterThan(0);
    expect(yaw).toBeLessThan(Math.PI / 4);
    // 从轨迹的 10 米以后找：落在 x 10 以后的矮墓道里，净空不够，一直找不到
    expect(() => spawnOf(trackOf(points, GRID), 10)).toThrow('找不到');
  });
});

// x 轴上的一点
const line = (x: number, eye = EYE_HEIGHT): RoamPoint => ({ x, y: 0, floor: 0, eye });

describe('simplify', () => {
  it('直线只留两头；拐弯、眼高变了的点留下', () => {
    expect(simplify([0, 1, 2, 3].map(x => line(x)))).toStrictEqual([line(0), line(3)]);
    const bent = [line(0), line(1), { ...line(2), y: 1 }, { ...line(3), y: 2 }];
    expect(simplify(bent)).toHaveLength(3);
    expect(simplify([line(0), line(1), line(2, 1.2), line(3, 1.2)])).toHaveLength(4);
  });
});
