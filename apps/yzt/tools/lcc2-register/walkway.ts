// 补的地板（ADR 0172）：扫描采不到的步行表面（玻璃栈道这类）沿扫描轨迹补上，找断口候选、算地板都在网格的局部系里；
// 规则和理由见 docs/commands.md 的 --walkway，换成经纬度在 roam-manifest.ts
import { SCANNER_WINDOW } from './fit.ts';
import { type FloorGrid, floorsAt } from './floor-grid.ts';
import { ToolError } from './errors.ts';
import { EYE_HEIGHT, type RoamPoint, simplify, type TrackSample } from './roam.ts';

/** 补的地板的宽度（米）的默认值：人站得下（导航网格的身体半径 0.15 米，两边各让出约 0.15），又不会伸进旁边太多 */
export const WALKWAY_WIDTH = 1.2;
// 推地板用的扫描仪离地高度：前后这么远（米）以内、离地在 SCANNER_WINDOW 里的点的中位数
const HOLD_REACH = 5;
// 脚下的某一层离推出的地板不超过这么多米，就算这一点脚下有地板，补的地板取这些点的高度
const SUPPORT = 0.25;
// 一级台阶（米），同导航网格的 stepHeight：相邻两个取样点脚下的表面差得比它多，人走不过去
const STEP = 0.45;
// 断口：前后 GAP_WINDOW 米以内至少 GAP_BREAKS 处"断"（脚下没有表面、和前一个点差一级台阶以上、陷在坑里），连着至少 GAP_MIN 米，
// 相隔不到 GAP_MERGE 米的并成一个
const GAP_WINDOW = 2;
const GAP_BREAKS = 3;
const GAP_MIN = 2;
const GAP_MERGE = 2;
/** 建议的 --walkway 范围在断口两头各往外留这么多米：补的地板要压到断口两边能站的地板上 */
export const GAP_MARGIN = 2;
// 推出的地板、补的地板的高度按前后这么远（米）取中位数，滤掉扫描仪的上下晃动
const SMOOTH_REACH = 1;

/** 轨迹上做成补的地板的一段：起止米数、宽度（米，没写时用 WALKWAY_WIDTH） */
export interface WalkwaySpan {
  readonly from: number;
  readonly to: number;
  readonly width?: number;
}

/** 断口候选：轨迹上的起止米数、取样点数，其中和前一个点差一级台阶以上的、陷在坑里的、脚下没有表面的个数 */
export interface WalkwayGap {
  readonly from: number;
  readonly to: number;
  readonly samples: number;
  readonly jumps: number;
  readonly sunken: number;
  readonly holes: number;
}

// 中位数（偶数个时取靠上的那个），没有时为 undefined
function median(values: readonly number[]): number | undefined {
  return values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
}

// 前后 reach 米以内（按轨迹的米数）的序号
function within(track: readonly TrackSample[], i: number, reach: number): number[] {
  const indices: number[] = [];
  for (let j = i; j >= 0 && track[i].distance - track[j].distance <= reach; j--) {
    indices.push(j);
  }
  for (let j = i + 1; j < track.length && track[j].distance - track[i].distance <= reach; j++) {
    indices.push(j);
  }
  return indices;
}

/**
 * 每个取样点推出的地板：扫描仪的高度减去前后 HOLD_REACH 米以内扫描仪离地（离地在 SCANNER_WINDOW 里的点）的中位数；
 * 附近没有这样的点时用整条轨迹的，整条都没有时是 undefined
 */
export function expectedFloors(track: readonly TrackSample[]): (number | undefined)[] {
  const holds = track.map(({ point, floor }) => {
    const hold = floor === undefined ? undefined : point[2] - floor;
    return hold !== undefined && hold >= SCANNER_WINDOW.min && hold <= SCANNER_WINDOW.max ? hold : undefined;
  });
  const steady = holds.filter(hold => hold !== undefined);
  const overall = median(steady);
  return track.map(({ point }, i) => {
    const nearby = within(track, i, HOLD_REACH).flatMap(j => {
      const hold = holds[j];
      return hold === undefined ? [] : [hold];
    });
    const hold = median(nearby) ?? overall;
    return hold === undefined ? undefined : point[2] - hold;
  });
}

// 脚下离 expected 最近、不超过 SUPPORT 的一层，没有时 undefined
function supportAt(grid: FloorGrid, [x, y]: readonly number[], expected: number): number | undefined {
  let best: number | undefined;
  for (const height of floorsAt(grid, x, y)) {
    const closer = best === undefined || Math.abs(height - expected) < Math.abs(best - expected);
    if (Math.abs(height - expected) <= SUPPORT && closer) {
      best = height;
    }
  }
  return best;
}

// first～last 之间标了的个数
const count = (flags: readonly boolean[], first: number, last: number) =>
  flags.slice(first, last + 1).filter(Boolean).length;

/**
 * 断口候选（ADR 0172）：扫描的人走过、碰撞网格里却没有连着的地板的地方，玻璃栈道、网格的洞、数据的边都会是。
 * 是不是真的把导航网格断成了两片，要在 /dev/nav-grid 上看
 */
export function walkwayGaps(track: readonly TrackSample[]): WalkwayGap[] {
  const hole = track.map(({ floor }) => floor === undefined);
  const jump = track.map(({ floor }, i) => {
    const before = track[i - 1]?.floor;
    return floor !== undefined && before !== undefined && Math.abs(floor - before) > STEP;
  });
  // 陷在坑里：比前面最后一处正常的地板低一级台阶以上，扫描仪离它又超过 SCANNER_WINDOW（人不是站在上面）
  let reference: number | undefined;
  const sunken = track.map(({ point, floor }) => {
    if (floor === undefined) {
      return false;
    }
    const sunk = reference !== undefined && floor < reference - STEP && point[2] - floor > SCANNER_WINDOW.max;
    if (!sunk) {
      reference = floor;
    }
    return sunk;
  });
  const broken = track.map((_, i) => hole[i] || jump[i] || sunken[i]);
  const dense = track.map((_, i) => within(track, i, GAP_WINDOW).filter(j => broken[j]).length >= GAP_BREAKS);
  // 连着的一段，只算断的点：[first, last] 是序号
  const runs: { first: number; last: number }[] = [];
  track.forEach((sample, i) => {
    if (!dense[i] || !broken[i]) {
      return;
    }
    const current = runs.at(-1);
    if (current && sample.distance - track[current.last].distance < GAP_MERGE) {
      current.last = i;
    } else {
      runs.push({ first: i, last: i });
    }
  });
  return runs
    .filter(({ first, last }) => track[last].distance - track[first].distance >= GAP_MIN)
    .map(({ first, last }) => ({
      from: track[first].distance,
      to: track[last].distance,
      samples: last - first + 1,
      jumps: count(jump, first, last),
      sunken: count(sunken, first, last),
      holes: count(hole, first, last)
    }));
}

/** 断口候选建议的 --walkway 范围：两头各往外留 GAP_MARGIN 米，取到 0.5 米，不超出轨迹 */
export function suggestedSpan({ from, to }: WalkwayGap, track: readonly TrackSample[]): { from: number; to: number } {
  const end = track.at(-1)?.distance ?? to;
  return {
    from: Math.max(0, Math.floor((from - GAP_MARGIN) * 2) / 2),
    to: Math.min(Math.floor(end * 2) / 2, Math.ceil((to + GAP_MARGIN) * 2) / 2)
  };
}

/**
 * 一段补的地板在轨迹每个取样点上的高度（取样点的序号 → 局部系的高度）：取脚下实际的表面（断口两边的地板、栈道的梁），
 * 中间按米数插值，不跟着扫描仪晃；这一段一处这样的表面都没有时报错。路线经过这一段时也取这个高度
 */
export function walkwayFloors(
  track: readonly TrackSample[],
  grid: FloorGrid,
  { from, to }: WalkwaySpan
): Map<number, number> {
  const indices = track.flatMap((sample, i) => (sample.distance >= from && sample.distance <= to ? [i] : []));
  if (indices.length < 2) {
    throw new ToolError(`补的地板 ${from}-${to}：轨迹上这一段不到两个取样点`);
  }
  const expected = expectedFloors(track);
  // 脚下实际的表面：[米数, 高度]
  const surfaces = indices.flatMap(i => {
    const guide = median(
      within(track, i, SMOOTH_REACH).flatMap(j => {
        const floor = expected[j];
        return floor === undefined ? [] : [floor];
      })
    );
    const floor = guide === undefined ? undefined : supportAt(grid, track[i].point, guide);
    return floor === undefined ? [] : [[track[i].distance, floor] as const];
  });
  if (surfaces.length === 0) {
    throw new ToolError(`补的地板 ${from}-${to}：这一段脚下在推出的地板附近都没有表面，把起止往断口两边的地板上挪`);
  }
  // 前后 SMOOTH_REACH 米以内总有它自己
  const heights = surfaces.map(
    ([distance, floor]) =>
      median(surfaces.filter(([other]) => Math.abs(other - distance) <= SMOOTH_REACH).map(([, height]) => height)) ??
      floor
  );
  // 按米数在实际的表面之间插值，两头外面取最近的
  const floorAt = (distance: number) => {
    const after = surfaces.findIndex(([other]) => other >= distance);
    if (after === -1) {
      return heights[heights.length - 1];
    }
    if (after === 0) {
      return heights[0];
    }
    const [a, b] = [surfaces[after - 1][0], surfaces[after][0]];
    const t = b > a ? (distance - a) / (b - a) : 0;
    return heights[after - 1] + (heights[after] - heights[after - 1]) * t;
  };
  return new Map(indices.map(i => [i, floorAt(track[i].distance)]));
}

/** 一段补的地板（局部系）：walkwayFloors 的点按路线的规则抽稀，眼高都是 EYE_HEIGHT（清单里不写） */
export function walkwayOf(track: readonly TrackSample[], grid: FloorGrid, span: WalkwaySpan): RoamPoint[] {
  const points = [...walkwayFloors(track, grid, span)].map(([i, floor]) => {
    const [x, y] = track[i].point;
    return { x, y, floor, eye: EYE_HEIGHT };
  });
  return simplify(points);
}
