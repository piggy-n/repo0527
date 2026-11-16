// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildFloorGrid, floorsAt } from './floor-grid.ts';
import type { Vec3 } from './lcc2-data.ts';
import { EYE_HEIGHT, type RoamPoint, routeOf, routeWithCorners, simplify, spawnOf, trackOf } from './roam.ts';
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

// 路线上 x 处的地板和眼高（按前后两点插值，同 RoutePath）
function routeAt(route: readonly RoamPoint[], x: number): { floor: number; eye: number } {
  const next = route.findIndex(point => point.x >= x);
  const a = route[next - 1];
  const b = route[next];
  if (!a || !b) {
    throw new Error(`路线在 x ${x} 两边没有点`);
  }
  const t = (x - a.x) / (b.x - a.x);
  return { floor: a.floor + (b.floor - a.floor) * t, eye: a.eye + (b.eye - a.eye) * t };
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

  it('拉直不切门框：门两侧没有余量的地方，中线不跨相邻格的"洞"（门框下没有地面）', () => {
    // x 9.6～10.8 是 1.2 米厚的墙，门洞 y 1.8～2.2（0.4 米宽，扫描的人在门洞中间两侧都不空）；
    // 首尾连线在墙里 y 约 1.72～1.76，在门框里，旁边一格就是门洞的地面
    const grid = buildFloorGrid([
      rectangle(0, 0, 9.6, 4, 0),
      rectangle(10.8, 0, 20, 4, 0),
      rectangle(9.6, 1.8, 10.8, 2.2, 0)
    ]);
    const track = trackOf(
      walk(
        [
          { from: [0, 1.4], to: [9.4, 2] },
          { from: [9.4, 2], to: [11, 2] },
          { from: [11, 2], to: [20, 2] }
        ],
        () => 0
      ),
      grid
    );
    const route = routeOf(track, 1, 19, grid);
    const inJamb = along(route).filter(({ x, y }) => x > 9.6 && x < 10.8 && (y < 1.8 || y > 2.2));
    expect(inJamb).toStrictEqual([]);
  });

  it('取样点之间的细横杆：原始轨迹每个点都看头顶、归到最近的取样点，视点降到杆下', () => {
    // 这条轨迹每 0.1 米一个点、从 x 0.05 起，取样每 0.3 米一个：x 9.95、10.25 落在 0.2 米的方格 [9.8, 10.0)、[10.2, 10.4) 的里面；
    // x 10.05～10.15 离地 1.5 米的横杆只在 [10.0, 10.2) 里，没有取样点看到
    const grid = buildFloorGrid([rectangle(0, 0, 20, 4, 0), rectangle(10.05, 0, 10.15, 4, 1.5)]);
    const track = trackOf(walk([{ from: [0.05, 2], to: [20, 2] }], () => 0), grid);
    // 没有取样点落在横杆的方格里
    expect(track.filter(({ point: [x] }) => x >= 10 && x < 10.2)).toStrictEqual([]);
    const route = routeOf(track, 1, 19, grid);
    const eyeAt = (x: number) => {
      const next = route.findIndex(point => point.x >= x);
      const a = route[next - 1];
      const b = route[next];
      if (!a || !b) {
        throw new Error(`路线在 x ${x} 两边没有点`);
      }
      return a.eye + ((b.eye - a.eye) * (x - a.x)) / (b.x - a.x);
    };
    // 杆在 1.5 米，视点离它留 0.2 米
    expect(eyeAt(10.1)).toBeLessThanOrEqual(1.3 + 0.08);
    expect(eyeAt(5)).toBe(EYE_HEIGHT);
    expect(eyeAt(15)).toBe(EYE_HEIGHT);
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

  it('扫描仪从台面上方掠过（连续几个点，中位数滤不掉）、高度没变：路线贴着旁边的地面', () => {
    // x 6～7 一张 0.7 米高的台面，下面有地面；或者是 0.7 米高的实心台子，下面没有地面。扫描的人从旁边走过，扫描仪离地面 1.25 米不变
    const table = buildFloorGrid([rectangle(0, 0, 12, 4, 0), rectangle(6, 0, 7, 4, 0.7)]);
    const block = buildFloorGrid([rectangle(0, 0, 6, 4, 0), rectangle(6, 0, 7, 4, 0.7), rectangle(7, 0, 12, 4, 0)]);
    for (const grid of [table, block]) {
      const track = trackOf(walk([{ from: [0, 2], to: [12, 2] }], () => 0), grid);
      // 轨迹照旧取脚下最高的一层
      expect(track.find(({ point }) => point[0] >= 6.5)?.floor).toBeCloseTo(0.7, 6);
      const route = routeOf(track, 1, 11, grid);
      expect(route.map(({ floor }) => floor)).toStrictEqual(route.map(() => 0));
      expect(route.map(({ eye }) => eye)).toStrictEqual(route.map(() => EYE_HEIGHT));
    }
  });

  it('真台阶：形状和上面的实心台子一样，扫描的人走上去、扫描仪跟着升高，台阶照旧', () => {
    const grid = buildFloorGrid([rectangle(0, 0, 6, 4, 0), rectangle(6, 0, 7, 4, 0.7), rectangle(7, 0, 12, 4, 0)]);
    const track = trackOf(walk([{ from: [0, 2], to: [12, 2] }], x => (x >= 6 && x < 7 ? 0.7 : 0)), grid);
    const route = routeOf(track, 1, 11, grid);
    expect(routeAt(route, 6.5).floor).toBeCloseTo(0.7, 6);
    expect(routeAt(route, 3).floor).toBe(0);
    expect(routeAt(route, 9).floor).toBe(0);
  });

  it('蹲着扫的矮门：扫描仪贴着顶过去，门里的地板照旧，视点降到门楣下', () => {
    // x 6～7 是一道矮门：门洞里是 0.4 米高的门槛石（下面没有地面），顶在 1.2 米；扫描的人弯腰过去，扫描仪离地面 1.0 米、离顶 0.2 米
    const grid = buildFloorGrid([
      rectangle(0, 0, 6, 4, 0),
      rectangle(6, 0, 7, 4, 0.4),
      rectangle(7, 0, 12, 4, 0),
      rectangle(6, 0, 7, 4, 1.2)
    ]);
    const track = trackOf(walk([{ from: [0, 2], to: [12, 2] }], x => (x >= 6 && x < 7 ? -0.25 : 0)), grid);
    const route = routeOf(track, 1, 11, grid);
    const door = routeAt(route, 6.5);
    expect(door.floor).toBeCloseTo(0.4, 6);
    expect(door.eye).toBeCloseTo(0.6, 6);
    expect(routeAt(route, 3)).toStrictEqual({ floor: 0, eye: EYE_HEIGHT });
  });

  it('通道顶不高、扫描仪离顶 0.45 米照常拿着走，不算蹲着扫：实心台子上方照样贴回地面', () => {
    // 通道顶 1.7 米；x 8～10 一块 0.7 米高的实心台子（下面没有地面），扫描仪离地 1.25 米从它上方过
    const grid = buildFloorGrid([
      rectangle(0, 0, 8, 4, 0),
      rectangle(8, 0, 10, 4, 0.7),
      rectangle(10, 0, 18, 4, 0),
      rectangle(0, 0, 18, 4, 1.7)
    ]);
    const route = routeOf(trackOf(walk([{ from: [0, 2], to: [18, 2] }], () => 0), grid), 1, 17, grid);
    expect(route.map(({ floor }) => floor)).toStrictEqual(route.map(() => 0));
    expect(route.every(({ eye }) => Math.abs(eye - 1.5) < 1e-6)).toBe(true);
  });

  it('台面下面是比旁边高 0.15 米的台基：取离趋势最近的台基，不当成缺表面', () => {
    const grid = buildFloorGrid([
      rectangle(0, 0, 6, 4, 0),
      rectangle(6, 0, 7, 4, 0.15),
      rectangle(6, 0, 7, 4, 0.7),
      rectangle(7, 0, 12, 4, 0)
    ]);
    const route = routeOf(trackOf(walk([{ from: [0, 2], to: [12, 2] }], () => 0), grid), 1, 11, grid);
    expect(routeAt(route, 6.5).floor).toBeCloseTo(0.15, 6);
    expect(routeAt(route, 3).floor).toBe(0);
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

describe('routeWithCorners', () => {
  it('拉直以后留下的拐点记下原因：真的拐弯是偏离超过容差，门框是中线脚下没有地面，通道收窄是两侧脚下没有地面', () => {
    // 先往东 10 米、再往北 10 米的 L 形走廊
    const bendGrid = buildFloorGrid([rectangle(0, 0, 11, 2, 0), rectangle(9, 0, 11, 12, 0)]);
    const bendTrack = trackOf(walk([{ from: [0, 1], to: [10, 1] }, { from: [10, 1], to: [10, 12] }], () => 0), bendGrid);
    const turn = routeWithCorners(bendTrack, 1, 19, bendGrid).corners;
    expect(turn.map(({ reason }) => reason)).toStrictEqual(['deviation']);
    expect(turn[0]?.offset).toBeGreaterThan(5);
    // 轨迹从 x 0 起，拐弯处走过 10 米
    expect(turn[0]?.distance).toBeCloseTo(10, 0);

    // 同"拉直不切门框"：门洞 0.4 米宽，首尾连线在门框里
    const doorGrid = buildFloorGrid([
      rectangle(0, 0, 9.6, 4, 0),
      rectangle(10.8, 0, 20, 4, 0),
      rectangle(9.6, 1.8, 10.8, 2.2, 0)
    ]);
    const doorTrack = trackOf(
      walk([{ from: [0, 1.4], to: [9.4, 2] }, { from: [9.4, 2], to: [11, 2] }, { from: [11, 2], to: [20, 2] }], () => 0),
      doorGrid
    );
    const door = routeWithCorners(doorTrack, 1, 19, doorGrid).corners;
    expect(door.length).toBeGreaterThan(0);
    expect(door.every(({ offset }) => offset < 1)).toBe(true);
    expect(door[0]?.reason).toBe('ground');
    // 第一个过不去的位置在门框里
    expect(door[0]?.at.x).toBeGreaterThan(9.5);

    // 同"拉直后离墙仍有 0.2 米"：首尾连线在窄的一段离墙只有 0.06 米
    const narrowGrid = buildFloorGrid([rectangle(0, 0, 10, 1.6, 0), rectangle(10, 0, 20, 0.6, 0)]);
    const narrowTrack = trackOf(
      walk(
        [
          { from: [0, 0.8], to: [10, 0.8] },
          { from: [10, 0.8], to: [10.3, 0.3] },
          { from: [10.3, 0.3], to: [20, 0.3] }
        ],
        () => 0
      ),
      narrowGrid
    );
    expect(routeWithCorners(narrowTrack, 1, 19, narrowGrid).corners[0]?.reason).toBe('side-ground');
  });

  it('身高范围里的东西和头顶余量分开记', () => {
    // 4 米宽的厅里 x 9～11、y 1.6～2.4 一个 1 米高的台子（下面没有地面），扫描的人从北边绕过去
    const table = buildFloorGrid([
      rectangle(0, 0, 9, 4, 0),
      rectangle(11, 0, 20, 4, 0),
      rectangle(9, 0, 11, 1.6, 0),
      rectangle(9, 2.4, 11, 4, 0),
      rectangle(9, 1.6, 11, 2.4, 1)
    ]);
    const around = trackOf(
      walk([{ from: [0, 2], to: [8, 2] }, { from: [8, 2], to: [10, 2.9] }, { from: [10, 2.9], to: [12, 2] }, { from: [12, 2], to: [20, 2] }], () => 0),
      table
    );
    expect(routeWithCorners(around, 1, 19, table).corners.map(({ reason }) => reason)).toContain('obstacle');

    // 头顶 1.75 米的矮通道（视点 1.55，头顶正好没有余量），x 9.9～10.1、y 0.5～0.7 吊着一盏灯，底在 1.6 米；
    // 左右摆的轨迹从灯旁边过，首尾连线从灯下过（灯下视点要降到 1.4）
    const reasons = routeWithCorners(trackOf(zigzag, LAMP), 1, 19, LAMP).corners.map(({ reason }) => reason);
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons.every(reason => reason === 'headroom' || reason === 'side-headroom')).toBe(true);
  });
});

// 1.2 米宽、头顶 1.75 米的矮通道，x 9.9～10.1、y 0.5～0.7 吊着一盏灯，底在 1.6 米
const LAMP = buildFloorGrid([
  rectangle(0, 0, 20, 1.2, 0),
  rectangle(0, 0, 20, 1.2, 1.75),
  rectangle(9.9, 0.5, 10.1, 0.7, 1.6)
]);

// 路线上 (x, y) 处视点以上到头顶的米数（路线按前后两点插值，头顶取这一格地板以上 0.5 米以上最低的表面）
function headroomAlong(route: readonly RoamPoint[], grid: ReturnType<typeof buildFloorGrid>): number {
  let least = Infinity;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1];
    const b = route[i];
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.05);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      const floor = a.floor + (b.floor - a.floor) * t;
      const eye = a.eye + (b.eye - a.eye) * t;
      const top = floorsAt(grid, x, y).find(height => height > floor + 0.5);
      if (top !== undefined) {
        least = Math.min(least, top - floor - eye);
      }
    }
  }
  return least;
}

// 路线上 x 在 from～to 之间的点最北到哪
const northmost = (route: readonly RoamPoint[], from: number, to: number) =>
  Math.max(...route.filter(({ x }) => x > from && x < to).map(({ y }) => y));

describe('拉直：贪心拉线、直线上重算眼高、按路线的容差', () => {
  it('直线只在挡住的地方拐：厅里一根柱子挡住首尾连线，左右摆的轨迹拉成两段，不在摆动处拐', () => {
    // 3 米宽的厅，x 9.6～10.4、y 0～1.75 是一根柱子（没有地面）；扫描的人在 y 1.4～2.2 之间每 2 米摆一次，从柱子北边过
    const grid = buildFloorGrid([
      rectangle(0, 0, 9.6, 3, 0),
      rectangle(10.4, 0, 20, 3, 0),
      rectangle(9.6, 1.75, 10.4, 3, 0),
      rectangle(0, 0, 20, 3, 2.5)
    ]);
    const track = trackOf(
      walk(
        Array.from({ length: 10 }, (_, i) => ({
          from: [i * 2, i % 2 === 0 ? 1.4 : 2.2] as const,
          to: [(i + 1) * 2, i % 2 === 0 ? 2.2 : 1.4] as const
        })),
        () => 0
      ),
      grid
    );
    const { points, corners } = routeWithCorners(track, 1, 19, grid);
    // 拐点在柱子北边以东、从起点还看得到的最远处（轨迹每 2 米走约 2.15 米）
    expect(corners).toHaveLength(1);
    expect(corners[0]?.distance).toBeGreaterThan(10.5);
    expect(corners[0]?.distance).toBeLessThan(17);
    // 柱子旁边离柱子（y 1.75）至少约 0.2 米
    const nearPillar = along(points).filter(({ x }) => x > 9.5 && x < 10.5);
    expect(Math.min(...nearPillar.map(({ y }) => y))).toBeGreaterThan(1.9);
  });

  it('矮通道两侧的顶低几厘米：直线上的视点按新位置的头顶重算，左右摆的轨迹照样拉直，视点不碰顶', () => {
    // 1.2 米宽的通道，y 0.6 以北头顶 1.80，以南 1.76；扫描的人在 y 0.35～0.85 之间摆，南边的点视点按 1.76 算成 1.56
    const grid = buildFloorGrid([
      rectangle(0, 0, 20, 1.2, 0),
      rectangle(0, 0.6, 20, 1.2, 1.8),
      rectangle(0, 0, 20, 0.6, 1.76)
    ]);
    const route = routeOf(trackOf(zigzag, grid), 1, 19, grid);
    expect(bend(route)).toBeLessThan(0.03);
    expect(Math.min(...route.map(({ eye }) => eye))).toBeGreaterThan(1.5);
    // 视点以上到顶至少 0.2 米（抽稀的竖直容差 0.08 米以内）
    expect(headroomAlong(route, grid)).toBeGreaterThan(0.2 - 0.08);
  });

  it('直线上的视点只往低里重算，不比原来的路线高：网格里门楣只扫到扫描仪经过的一条，直线从没扫到的地方过，视点照样压低', () => {
    // 同"蹲着扫的矮门"：x 6～7 是 0.4 米高的门槛石，门楣在 1.2 米，但网格里只有 y 1.8～2.2 这一条（扫描仪蹲着从这里过）；
    // 扫描的人从 y 3 斜着走到门口、出门再斜着走回 y 3，首尾连线在门口 y 约 2.8，头顶在网格里是空的
    const grid = buildFloorGrid([
      rectangle(0, 0, 6, 4, 0),
      rectangle(6, 0, 7, 4, 0.4),
      rectangle(7, 0, 12, 4, 0),
      rectangle(6, 1.8, 7, 2.2, 1.2)
    ]);
    const track = trackOf(
      walk(
        [
          { from: [0, 3], to: [6, 2] },
          { from: [6, 2], to: [7, 2] },
          { from: [7, 2], to: [12, 3] }
        ],
        (x) => (x >= 6 && x < 7 ? -0.25 : 0)
      ),
      grid
    );
    const route = routeOf(track, 1, 11, grid);
    // 拉直了（门口离首尾连线不到 1 米），门口的视点仍是扫描仪蹲着过时的 0.6
    expect(bend(route)).toBeLessThan(0.03);
    expect(routeAt(route, 6.5).eye).toBeLessThanOrEqual(0.6 + 0.08);
  });

  it('直线上的视点不能比原来的路线低太多：原来绕开的低灯，直线不从它下面过', () => {
    const route = routeOf(trackOf(zigzag, LAMP), 1, 19, LAMP);
    const underLamp = along(route).filter(({ x, y }) => x > 9.85 && x < 10.15 && y > 0.45 && y < 0.75);
    expect(underLamp).toStrictEqual([]);
    expect(headroomAlong(route, LAMP)).toBeGreaterThan(0.2 - 0.08);
  });

  it('按路线调大水平容差：宽坡道上左右摆 1.6 米的轨迹，默认 1 米留着拐点，容差 2 米拉成一条直线', () => {
    // 4 米宽的厅，扫描的人在 y 1.2～2.8 之间每 3 米摆一次
    const grid = buildFloorGrid([rectangle(0, 0, 21, 4, 0)]);
    const track = trackOf(
      walk(
        Array.from({ length: 7 }, (_, i) => ({
          from: [i * 3, i % 2 === 0 ? 1.2 : 2.8] as const,
          to: [(i + 1) * 3, i % 2 === 0 ? 2.8 : 1.2] as const
        })),
        () => 0
      ),
      grid
    );
    expect(bend(routeOf(track, 1, 20, grid))).toBeGreaterThan(0.5);
    expect(bend(routeOf(track, 1, 20, grid, { tolerance: 2 }))).toBeLessThan(0.03);
  });

  it('按轨迹米数分段的容差：宽坡道那一段拉直，后面进小室又出来的一段照样走', () => {
    // 4 米宽的坡道（x 0～12），扫描的人在 y 1.2～2.8 之间每 3 米摆一次；之后是 1.2 米宽的通道（y 1.4～2.6），
    // x 16～17 北边有一间 1.5 米深的小室（y 2.6～4.1），扫描的人进去到 y 3.6 再出来
    const grid = buildFloorGrid([
      rectangle(0, 0, 12, 4, 0),
      rectangle(12, 1.4, 24, 2.6, 0),
      rectangle(16, 2.6, 17, 4.1, 0)
    ]);
    const segments = [
      ...Array.from({ length: 4 }, (_, i) => ({
        from: [i * 3, i % 2 === 0 ? 1.2 : 2.8] as const,
        to: [(i + 1) * 3, i % 2 === 0 ? 2.8 : 1.2] as const
      })),
      { from: [12, 1.2] as const, to: [12.5, 2] as const },
      { from: [12.5, 2] as const, to: [16.5, 2] as const },
      { from: [16.5, 2] as const, to: [16.5, 3.6] as const },
      { from: [16.5, 3.6] as const, to: [16.5, 2] as const },
      { from: [16.5, 2] as const, to: [24, 2] as const }
    ];
    const track = trackOf(walk(segments, () => 0), grid);
    // 坡道走完时轨迹上约 13.6 米
    const end = track.find(({ point }) => point[0] >= 12)?.distance ?? 0;
    const whole = routeOf(track, 0.5, 26, grid, { tolerance: 2 });
    const parted = routeOf(track, 0.5, 26, grid, { stretches: [{ from: 0, to: end, tolerance: 2 }] });
    // 整条用 2 米：小室没进去（1.6 米深的往返在容差以内，被拉直跳过）
    expect(northmost(whole, 15.5, 17.5)).toBeLessThan(3);
    // 只有坡道用 2 米：坡道上只剩首尾两个点，小室照样进去
    expect(parted.filter(({ x }) => x < 11.5).length).toBeLessThanOrEqual(2);
    expect(northmost(parted, 15.5, 17.5)).toBeGreaterThan(3.3);
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
