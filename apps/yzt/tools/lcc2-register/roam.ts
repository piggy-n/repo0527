// 从扫描轨迹取步行的出生点和漫游路线（ADR 0156 第 4 节）：轨迹是扫描时人拿着扫描仪走过的地方，一定能走；
// 贴到脚下的表面上，矮的地方算出眼高，按米数取段、抽稀。都在网格的局部系里，换成经纬度在 cli.ts
import { FIT_WINDOW, SCANNER_WINDOW } from './fit.ts';
import { type FloorGrid, floorsAt } from './floor-grid.ts';
import { ToolError } from './errors.ts';
import { samplePath, type Vec3 } from './lcc2-data.ts';

// 这两个值要和 map-core 的相等：工具由 Node 直接运行，导入不了 @mx/map-core，各写一份，由 roam-constants.test.ts 保证相等
/** 视点在脚下地板以上的米数，同 map-core 的 EYE_HEIGHT */
export const EYE_HEIGHT = 1.6;
/** 矮的地方视点离顶板至少这么远，同 map-core 的 HEAD_CLEARANCE（Walker） */
export const HEAD_CLEARANCE = 0.2;
/** 路线取样的间隔（米） */
export const ROUTE_SPACING = 0.25;
// 地板、眼高按前后这么多个取样点一起取：地板取中位数（表面有几厘米的起伏，不滤的话视点跟着上下抖），
// 眼高取最小值（门楣、梁只占一两个点，取中位数会滤掉，视点穿进顶板）
const WINDOW_HALF = 2;
// 抽稀的容差：水平偏离折线、地板和眼高偏离插值不超过这么多米
const SIMPLIFY_HORIZONTAL = 0.2;
const SIMPLIFY_VERTICAL = 0.08;
/**
 * 拉直的水平容差的默认值：原来的路线水平偏离一段直线不超过这么多米，才能换成这段直线（扫描的人在通道里从一面墙斜着走到另一面，
 * 摆幅约 0.5 米）；宽的坡道、走廊里摆得更大，按路线调（--route 的第四段）
 */
export const STRAIGHT_HORIZONTAL = 1;
// 直线上的点都落在直线上以后，再按这个容差去掉多余的点
const STRAIGHT_RESIDUAL = 0.02;
// 直线上相机经过的地方要空：每隔 CLEAR_STEP 米，中线和左右各偏 CLEAR_LATERAL 米处，离路线的地板 FLOOR_REACH 米内有表面；
// 地板以上 STEP_OVER 米（台阶、路沿，相机从上面过）以上最低的表面按眼高的规则限制视点
const CLEAR_STEP = 0.1;
const CLEAR_LATERAL = 0.2;
const FLOOR_REACH = 0.3;
const STEP_OVER = 0.5;
// 直线上的视点按直线经过的头顶往低里重算，取前后 EYE_WINDOW 米的最小值（同原来的点按前后 WINDOW_HALF 个取样点取）；
// 不能比原来的路线在前后 EYE_REACH 米（弧长）内最低的眼高再低 EYE_SLACK 米以上：顶板起伏几厘米照样拉直，原来绕开的低处不从下面过
const EYE_WINDOW = WINDOW_HALF * ROUTE_SPACING;
const EYE_REACH = 1;
const EYE_SLACK = 0.05;
// 出生点：朝向取之后这么远（沿轨迹）那一点的方向，开头的小弯不算，净空至少这么高（矮通道里不出生）
const SPAWN_LOOK = 8;
const SPAWN_HEADROOM = 1.8;
// steadyFloors 选路线地板用的距离和阈值（米），规则见 docs/commands.md 的 --roam
const HOLD_REACH = 4;
const HOLD_STEADY = 0.2;
const TREND_REACH = 6;
const TREND_GAP = 0.3;
const CROUCH_HEADROOM = 0.25;

/** 轨迹上的一个取样点：扫描仪的位置、从轨迹开头走过的米数、脚下的表面和头顶的表面（没有时 undefined） */
export interface TrackSample {
  readonly point: Vec3;
  readonly distance: number;
  readonly floor: number | undefined;
  readonly ceiling: number | undefined;
}

/** 出生点、路线上的一点：位置、脚下地板的高度、视点在地板以上的米数（局部系） */
export interface RoamPoint {
  readonly x: number;
  readonly y: number;
  readonly floor: number;
  readonly eye: number;
}

// 扫描仪下方能当脚下表面的各层（下方 FIT_WINDOW 米以内），从低到高
const layersBelow = (grid: FloorGrid, [x, y, z]: Vec3) =>
  floorsAt(grid, x, y).filter((height) => height <= z - FIT_WINDOW.min && height >= z - FIT_WINDOW.max);

/**
 * 轨迹（网格的局部系）每 0.25 米取一个点，算累计的米数（三维）和脚下、头顶的表面。脚下取最高的一层，头顶是扫描仪上方的第一层表面，
 * 原始轨迹（几厘米一个点）的每个点都看，归到最近的取样点：取样点之间的细横杆、门楣也算进去
 */
export function trackOf(trajectory: readonly Vec3[], grid: FloorGrid): TrackSample[] {
  const samples = samplePath(trajectory, ROUTE_SPACING);
  // 取样点在原始轨迹里的序号（samplePath 取的就是原始的点）
  const indices: number[] = [];
  for (let i = 0; i < trajectory.length && indices.length < samples.length; i++) {
    if (trajectory[i] === samples[indices.length]) {
      indices.push(i);
    }
  }
  const above = trajectory.map(([x, y, z]) => floorsAt(grid, x, y).find((height) => height > z));
  let distance = 0;
  let previous: Vec3 | undefined;
  return samples.map((point, i) => {
    if (previous) {
      distance += Math.hypot(point[0] - previous[0], point[1] - previous[1], point[2] - previous[2]);
    }
    previous = point;
    const floor = layersBelow(grid, point).at(-1);
    // 前后两个取样点之间各一半的原始点
    const from = i === 0 ? 0 : Math.ceil((indices[i - 1] + indices[i]) / 2);
    const to = i === samples.length - 1 ? trajectory.length - 1 : Math.floor((indices[i] + indices[i + 1]) / 2);
    let ceiling: number | undefined;
    for (let k = from; k <= to; k++) {
      const height = above[k];
      if (height !== undefined && (ceiling === undefined || height < ceiling)) {
        ceiling = height;
      }
    }
    return { point, distance, floor, ceiling };
  });
}

/** 视点在地板以上多高：净空够时是眼高，矮的地方离顶板留 HEAD_CLEARANCE */
export const eyeAbove = (floor: number, ceiling: number | undefined) =>
  ceiling === undefined ? EYE_HEIGHT : Math.min(EYE_HEIGHT, ceiling - floor - HEAD_CLEARANCE);

// 第 i 个和前后各 WINDOW_HALF 个
const windowAround = (values: readonly number[], i: number) =>
  values.slice(Math.max(0, i - WINDOW_HALF), i + WINDOW_HALF + 1);

// 中位数（偶数个时取靠上的那个）
const median = (values: readonly number[]) =>
  values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)] ?? Number.NaN;

// 窗口里的中位数
const medianAround = (values: readonly number[], i: number) => median(windowAround(values, i));

/** 路线用的地板：扫描仪离地不平稳的点（从栏板、台面上方掠过）改取离前后地板趋势最近的一层，规则见 docs/commands.md 的 --roam */
export function steadyFloors(track: readonly TrackSample[], grid: FloorGrid): (number | undefined)[] {
  const holds = track.map(({ point, floor }) => (floor === undefined ? undefined : point[2] - floor));
  const steady = track.map(({ distance }, i) => {
    const hold = holds[i];
    if (hold === undefined) {
      return false;
    }
    const nearby: number[] = [];
    for (let j = i; j >= 0 && distance - track[j].distance <= HOLD_REACH; j--) {
      const value = holds[j];
      if (value !== undefined) {
        nearby.push(value);
      }
    }
    for (let j = i + 1; j < track.length && track[j].distance - distance <= HOLD_REACH; j++) {
      const value = holds[j];
      if (value !== undefined) {
        nearby.push(value);
      }
    }
    return Math.abs(hold - median(nearby)) < HOLD_STEADY;
  });
  // 前后最近的平稳点，TREND_REACH 米以外的不算
  const nearest = (i: number, step: 1 | -1) => {
    for (let j = i + step; j >= 0 && j < track.length; j += step) {
      if (Math.abs(track[j].distance - track[i].distance) > TREND_REACH) {
        return undefined;
      }
      if (steady[j]) {
        return track[j];
      }
    }
    return undefined;
  };
  return track.map((sample, i) => {
    if (steady[i]) {
      return sample.floor;
    }
    const before = nearest(i, -1);
    const after = nearest(i, 1);
    let expected: number | undefined;
    if (before?.floor !== undefined && after?.floor !== undefined) {
      const t = (sample.distance - before.distance) / (after.distance - before.distance);
      expected = before.floor + (after.floor - before.floor) * t;
    } else {
      expected = before?.floor ?? after?.floor;
    }
    if (expected === undefined) {
      return sample.floor;
    }
    let layer: number | undefined;
    for (const height of layersBelow(grid, sample.point)) {
      if (layer === undefined || Math.abs(height - expected) < Math.abs(layer - expected)) {
        layer = height;
      }
    }
    const gap = layer === undefined ? Infinity : Math.abs(layer - expected);
    const crouched = sample.ceiling !== undefined && sample.ceiling - sample.point[2] < CROUCH_HEADROOM;
    return gap > TREND_GAP && !crouched ? undefined : layer;
  });
}

// 点在线段 a→b 上的投影位置（0～1）和水平距离
function project(point: RoamPoint, a: RoamPoint, b: RoamPoint): { t: number; distance: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length2 = dx * dx + dy * dy;
  const t = length2 > 0 ? Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2)) : 0;
  return { t, distance: Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t)) };
}

// 点到 a→b 的偏差：水平到线段的距离，地板、眼高和线性插值的差，按各自的容差折算，超过 1 就要留下这个点
function deviation(
  point: RoamPoint,
  a: RoamPoint,
  b: RoamPoint,
  horizontalTolerance: number,
  verticalTolerance: number
): number {
  const { t, distance: horizontal } = project(point, a, b);
  const floor = Math.abs(point.floor - (a.floor + (b.floor - a.floor) * t));
  const eye = Math.abs(point.eye - (a.eye + (b.eye - a.eye) * t));
  return Math.max(horizontal / horizontalTolerance, floor / verticalTolerance, eye / verticalTolerance);
}

// Douglas-Peucker：split(first, last) 返回要在中间留下的点（没有时 -1），首尾保留
function douglasPeucker<T>(points: readonly T[], split: (first: number, last: number) => number): T[] {
  if (points.length <= 2) {
    return [...points];
  }
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop() ?? [0, 0];
    const index = last - first < 2 ? -1 : split(first, last);
    if (index !== -1) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

// first～last 之间偏差最大的点，没有超过容差的返回 -1
function worstOf(
  points: readonly RoamPoint[],
  first: number,
  last: number,
  horizontalTolerance: number,
  verticalTolerance: number
): number {
  let worst = 0;
  let index = -1;
  for (let i = first + 1; i < last; i++) {
    const value = deviation(points[i], points[first], points[last], horizontalTolerance, verticalTolerance);
    if (value > worst) {
      worst = value;
      index = i;
    }
  }
  return worst > 1 ? index : -1;
}

/** 抽稀（Douglas-Peucker），水平、地板、眼高一起看；首尾保留 */
export function simplify(points: readonly RoamPoint[], horizontalTolerance = SIMPLIFY_HORIZONTAL): RoamPoint[] {
  return douglasPeucker(points, (first, last) => worstOf(points, first, last, horizontalTolerance, SIMPLIFY_VERTICAL));
}

/**
 * 相机在一处过不去的原因：脚下没有地面（ground）；视点以上 HEAD_CLEARANCE 米内有表面，头顶余量不够（headroom）；
 * 地板以上 STEP_OVER 米到视点之间有表面，身高范围里有东西（obstacle）
 */
export type ColumnBlock = 'ground' | 'headroom' | 'obstacle';

/** 一处过不去：原因、位置，挡住的表面离地板多高（脚下没有地面时没有） */
export interface Blocked {
  readonly block: ColumnBlock;
  readonly x: number;
  readonly y: number;
  readonly above?: number;
}

// 站在 floor 上、视点在 top 的相机在 (x, y) 这一列过不过得去，过不去时返回原因。扫描的地面常有一两格的洞，
// 脚下的表面可以在 holes 给的相邻方格里
function blockAt(
  grid: FloorGrid,
  x: number,
  y: number,
  floor: number,
  top: number,
  holes: readonly (readonly [number, number])[] = []
): Blocked | undefined {
  let ground = false;
  // 各层从低到高，挡住的第一层就是最低的
  for (const height of floorsAt(grid, x, y)) {
    if (Math.abs(height - floor) <= FLOOR_REACH) {
      ground = true;
    } else if (height > floor + STEP_OVER && height < top + HEAD_CLEARANCE) {
      return { block: height < top ? 'obstacle' : 'headroom', x, y, above: height - floor };
    }
  }
  const reached =
    ground ||
    holes.some(([dx, dy]) => floorsAt(grid, x + dx, y + dy).some(height => Math.abs(height - floor) <= FLOOR_REACH));
  return reached ? undefined : { block: 'ground', x, y };
}

// 中线：周围 8 格；两侧：只沿前进方向的前后两格。墙（陡的面不进方格）靠"没有地面"认出来，墙和前进方向平行，
// 沿前进方向找不到地面；横在路上的洞沿前进方向能跨过去
const around = (cell: number) =>
  [-1, 0, 1]
    .flatMap(i => [-1, 0, 1].map(j => [i * cell, j * cell] as const))
    .filter(([dx, dy]) => dx !== 0 || dy !== 0);
const along = (cell: number, ux: number, uy: number) => [[ux * cell, uy * cell] as const, [-ux * cell, -uy * cell] as const];

// 沿 (nx, ny) 方向两侧 CLEAR_LATERAL 米处过不过得去（前进方向是 (ny, -nx)），过不去时返回原因和位置
function blockAside(grid: FloorGrid, point: RoamPoint, nx: number, ny: number): Blocked | undefined {
  const top = point.floor + point.eye;
  const holes = along(grid.cellSize, ny, -nx);
  for (const offset of [-CLEAR_LATERAL, CLEAR_LATERAL]) {
    const blocked = blockAt(grid, point.x + nx * offset, point.y + ny * offset, point.floor, top, holes);
    if (blocked) {
      return blocked;
    }
  }
  return undefined;
}

/** 拉直以后留下一个拐点的原因：偏离扫描轨迹超过容差（deviation），或者直线上中线（ColumnBlock）、两侧（side- 开头）过不去 */
export type CornerReason = 'deviation' | ColumnBlock | `side-${ColumnBlock}`;

/**
 * 拉直以后留下的一个拐点（诊断用）：在点列里的序号、离前后两个拐点连线的水平距离、这一处用的水平容差、留下的原因，
 * 直线上第一个过不去的位置和挡住的表面离地板多高（偏离超过容差时是偏得最远的点）
 */
export interface StraightCorner {
  readonly index: number;
  readonly offset: number;
  readonly tolerance: number;
  readonly reason: CornerReason;
  readonly at: { readonly x: number; readonly y: number; readonly above?: number };
}

// 每个点的水平弧长
function arcLengths(points: readonly RoamPoint[]): number[] {
  const arcs = [0];
  for (let i = 1; i < points.length; i++) {
    arcs.push(arcs[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  }
  return arcs;
}

// 一段直线换不上去：原因和位置
interface ChordBlocked {
  readonly reason: CornerReason;
  readonly at: StraightCorner['at'];
}

// 直线上的视点被一处表面压得太低：表面在原来的视点以下是身高范围有东西，以上是头顶余量不够
const limitBlocked = (
  limit: { readonly at: StraightCorner['at']; readonly side: boolean },
  original: number
): ChordBlocked => {
  const kind = limit.at.above !== undefined && limit.at.above < original ? 'obstacle' : 'headroom';
  return { reason: limit.side ? `side-${kind}` : kind, at: limit.at };
};

// 诊断里记的位置：不带原因
const where = ({ x, y, above }: Blocked): StraightCorner['at'] => (above === undefined ? { x, y } : { x, y, above });

/** 每个位置前后各 half 个（含自己）里值最小的那个的序号，和自己一样小时取自己（直线上的视点按前后 EYE_WINDOW 米取最小值） */
export function windowMinIndex(values: readonly number[], half: number): number[] {
  return values.map((_, s) => {
    let at = s;
    for (let m = Math.max(0, s - half); m <= Math.min(values.length - 1, s + half); m++) {
      if (values[m] < values[at]) {
        at = m;
      }
    }
    return at;
  });
}

/**
 * 原来的路线在弧长 arc 前后 reach 米内最低的眼高：first～last 之间弧长在这个范围里的点，加上 arc 处插值出的 original
 * （直线上的视点不能比它再低 EYE_SLACK 米以上）
 */
export function lowestAround(
  arcs: readonly number[],
  eyes: readonly number[],
  first: number,
  last: number,
  arc: number,
  original: number,
  reach = EYE_REACH
): number {
  // first～last 里第一个弧长不小于 arc - reach 的点
  let low = first;
  let high = last;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (arcs[middle] < arc - reach) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  let least = original;
  for (let m = low; m <= last && arcs[m] <= arc + reach; m++) {
    least = Math.min(least, eyes[m]);
  }
  return least;
}

/** 第一个 values 低于 floors 的位置，没有时 -1（直线上取过前后最小值的视点和下限逐点核对） */
export const firstBelow = (values: readonly number[], floors: readonly number[]): number =>
  values.findIndex((value, s) => value < floors[s]);

/**
 * 直线上每一处的视点：按头顶重算的 raw 取前后各 half 个里最低的，再不高于原来的路线这一处的眼高（originals）；
 * 取过最低以后有一处低于下限（floors）时，返回压低它的那个点的序号
 */
export function lowerEyes(
  raw: readonly number[],
  originals: readonly number[],
  floors: readonly number[],
  half: number
): { readonly eyes: number[] } | { readonly below: number } {
  const at = windowMinIndex(raw, half);
  const windowed = at.map(m => raw[m]);
  const below = firstBelow(windowed, floors);
  if (below !== -1) {
    return { below: at[below] };
  }
  return { eyes: windowed.map((eye, s) => Math.min(eye, originals[s])) };
}

/** 首尾相接的几段点拼成一条：前一段的最后一点和后一段的第一点是同一个位置，视点取两段里低的 */
export function joinRuns(runs: readonly (readonly RoamPoint[])[]): RoamPoint[] {
  const joined: RoamPoint[] = [];
  for (const run of runs) {
    const joint = joined.at(-1);
    if (joint && run.length > 0) {
      joined[joined.length - 1] = { x: joint.x, y: joint.y, floor: joint.floor, eye: Math.min(joint.eye, run[0].eye) };
      joined.push(...run.slice(1));
    } else {
      joined.push(...run);
    }
  }
  return joined;
}

/**
 * 拉直（ADR 0156 第 4 节，规则见 docs/commands.md 的 --route）：从起点起，每次在原来的路线上找最远的、能用一段直线走到的点（贪心拉线），
 * 直线要满足：原来的路线水平偏离它不超过各点的容差（tolerances[i] 米），相机沿它走时脚下有地面、两侧不空，
 * 视点按直线上的头顶往低里重算后不比原来的路线低多少。一个点也到不了时退回原来的路线（按 0.2 米抽稀的点）。最后在直线上按地板、眼高抽稀
 */
function straighten(
  points: readonly RoamPoint[],
  grid: FloorGrid,
  tolerances: readonly number[]
): { readonly points: RoamPoint[]; readonly corners: StraightCorner[] } {
  if (points.length <= 2) {
    return { points: [...points], corners: [] };
  }
  const arcs = arcLengths(points);
  // 原来的点两侧空不空，方向取前后两点
  const roomy = points.map((point, i) => {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    return length > 0 && !blockAside(grid, point, -(b.y - a.y) / length, (b.x - a.x) / length);
  });
  // first～last 换成直线：每 CLEAR_STEP 米一个点，地板、眼高按弧长比例取原来的点，眼高再按这一处的头顶往低里重算（中线和要查两侧时的两侧，
  // 取前后 EYE_WINDOW 米的最小值），不能低于原来的路线在前后 EYE_REACH 米内最低的眼高减 EYE_SLACK；过不去时返回原因和位置
  const nearby = around(grid.cellSize);
  const eyes = points.map(({ eye }) => eye);
  const chordOf = (first: number, last: number): { readonly points: RoamPoint[] } | { readonly blocked: ChordBlocked } => {
    const a = points[first];
    const b = points[last];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const nx = length > 0 ? -(b.y - a.y) / length : 0;
    const ny = length > 0 ? (b.x - a.x) / length : 0;
    const steps = Math.max(1, Math.ceil(length / CLEAR_STEP));
    const sideHoles = along(grid.cellSize, ny, -nx);
    const samples: RoamPoint[] = [];
    // 每个点：限制视点的表面（离地多高、在不在两侧），原来的路线这里的眼高，视点最低能到多少
    const limits: ({ readonly at: StraightCorner['at']; readonly side: boolean } | undefined)[] = [];
    const originals: number[] = [];
    const allowed: number[] = [];
    let k = first;
    for (let s = 0; s <= steps; s++) {
      const arc = arcs[first] + ((arcs[last] - arcs[first]) * s) / steps;
      while (k < last && arcs[k + 1] < arc) {
        k++;
      }
      const p = points[k];
      const q = points[Math.min(k + 1, last)];
      // 弧长相加的舍入误差会让 t 差 1e-15 左右，落在点上时按点取，地板、眼高不带尾数
      const raw = arcs[k + 1] > arcs[k] ? Math.min(1, (arc - arcs[k]) / (arcs[k + 1] - arcs[k])) : 0;
      const t = raw < 1e-9 ? 0 : raw > 1 - 1e-9 ? 1 : raw;
      const x = a.x + ((b.x - a.x) * s) / steps;
      const y = a.y + ((b.y - a.y) * s) / steps;
      const floor = p.floor + (q.floor - p.floor) * t;
      const original = p.eye + (q.eye - p.eye) * t;
      const wanted = t < 0.5 ? roomy[k] : roomy[Math.min(k + 1, last)];
      const lowest = lowestAround(arcs, eyes, first, last, arc, original) - EYE_SLACK;
      let eye = EYE_HEIGHT;
      let limit: (typeof limits)[number];
      // 一列：本格自己有地面时，地板以上 STEP_OVER 米以上最低的表面是能从下面过的顶，往低里压视点；本格没有地面时（地面的洞，
      // 或者实心的柱子、碑、台子，相邻格都借得到地面）同原来的规则：地板以上 STEP_OVER 米到原来的视点以上 HEAD_CLEARANCE 米之间有表面，
      // 或者相邻格也借不到地面，就过不去
      const column = (
        cx: number,
        cy: number,
        holes: readonly (readonly [number, number])[],
        side: boolean
      ): ChordBlocked | undefined => {
        const heights = floorsAt(grid, cx, cy);
        if (heights.some(height => Math.abs(height - floor) <= FLOOR_REACH)) {
          const over = heights.find(height => height > floor + STEP_OVER);
          if (over !== undefined && over - floor - HEAD_CLEARANCE < eye) {
            eye = over - floor - HEAD_CLEARANCE;
            limit = { at: { x: cx, y: cy, above: over - floor }, side };
          }
          return undefined;
        }
        const blocked = blockAt(grid, cx, cy, floor, floor + original, holes);
        return blocked && { reason: side ? `side-${blocked.block}` : blocked.block, at: where(blocked) };
      };
      // 两侧不查的地方（门洞这类本来就窄的）中线不跨洞：门框下没有地面，跨过去直线就切进门框
      const centre = column(x, y, wanted ? nearby : [], false);
      if (centre) {
        return { blocked: centre };
      }
      for (const offset of wanted ? [-CLEAR_LATERAL, CLEAR_LATERAL] : []) {
        const side = column(x + nx * offset, y + ny * offset, sideHoles, true);
        if (side) {
          return { blocked: side };
        }
      }
      // 这一处的视点已经低过下限（取前后的最小值只会更低），不用往下算
      if (eye < lowest && limit) {
        return { blocked: limitBlocked(limit, original) };
      }
      samples.push({ x, y, floor, eye });
      limits.push(limit);
      originals.push(original);
      allowed.push(lowest);
    }
    // 只往低里重算：原来的眼高是扫描仪真走过的地方量的，网格里顶板常有洞（门楣只扫到一条），按直线的格子算可能偏高
    const half = Math.floor(EYE_WINDOW / Math.max(length / steps, 1e-6) + 1e-9);
    const lowered = lowerEyes(
      samples.map(({ eye }) => eye),
      originals,
      allowed,
      half
    );
    if ('below' in lowered) {
      // 低于下限的视点一定是哪个表面压低的（没有表面时是 EYE_HEIGHT，下限不超过 EYE_HEIGHT - EYE_SLACK）
      const limit = limits[lowered.below];
      if (!limit) {
        throw new Error(`直线上第 ${lowered.below} 个点的视点低于下限，却没有压低它的表面`);
      }
      return { blocked: limitBlocked(limit, originals[lowered.below]) };
    }
    const { eyes: chordEyes } = lowered;
    return { points: samples.map(({ x, y, floor }, s) => ({ x, y, floor, eye: chordEyes[s] })) };
  };
  // 先按原来的容差抽稀：直线通不过的地方退回到这些点（原来的路线），不退回到每 0.25 米一个的取样点
  const base = douglasPeucker(
    points.map((_, i) => i),
    (first, last) => worstOf(points, first, last, SIMPLIFY_HORIZONTAL, SIMPLIFY_VERTICAL)
  );
  // base 里 a～j 之间离直线 a→j 最远的点（按各点的容差折算，超过 1 就是偏得太远）
  const farthestOf = (a: number, j: number) => {
    let ratio = -1;
    let at = a;
    for (let m = a + 1; m < j; m++) {
      const offset = project(points[base[m]], points[base[a]], points[base[j]]).distance / tolerances[base[m]];
      if (offset > ratio) {
        ratio = offset;
        at = m;
      }
    }
    return { ratio, at: points[base[at]] };
  };
  // 拐点在 base 里的序号；每两个拐点之间的直线（undefined 是原来的路线的一段）；每个拐点为什么不能再往前
  const anchors = [0];
  const pieces: (readonly RoamPoint[] | undefined)[] = [];
  const stops: (ChordBlocked | undefined)[] = [];
  for (let a = 0; a < base.length - 1; ) {
    let next = a + 1;
    let piece: readonly RoamPoint[] | undefined;
    let stop: ChordBlocked | undefined;
    // 从远往近找第一个能到的点；退出时 stop 是它后面那个点到不了的原因
    for (let j = base.length - 1; j > a + 1; j--) {
      const { ratio, at } = farthestOf(a, j);
      const result: ReturnType<typeof chordOf> =
        ratio > 1 ? { blocked: { reason: 'deviation', at: { x: at.x, y: at.y } } } : chordOf(base[a], base[j]);
      if ('points' in result) {
        next = j;
        piece = result.points;
        break;
      }
      stop = result.blocked;
    }
    anchors.push(next);
    pieces.push(piece);
    stops.push(stop);
    a = next;
  }
  const corners = anchors.slice(1, -1).map((anchor, n) => {
    const stop = stops[n];
    if (!stop) {
      throw new Error(`拐点 ${base[anchor]} 没有记下停下的原因`);
    }
    const index = base[anchor];
    const offset = project(points[index], points[base[anchors[n]]], points[base[anchors[n + 2]]]).distance;
    return { index, offset, tolerance: tolerances[index], reason: stop.reason, at: stop.at };
  });
  // 拼起来：直线用重算过的点；原来的路线那一段，原来的点按弧长比例落到这一段上，地板、眼高照旧。接头处视点取两边低的
  const runs = anchors.slice(1).map((anchor, n): readonly RoamPoint[] => {
    const piece = pieces[n];
    if (piece) {
      return piece;
    }
    const i0 = base[anchors[n]];
    const i1 = base[anchor];
    const run: RoamPoint[] = [];
    for (let k = i0; k <= i1; k++) {
      const t = arcs[i1] > arcs[i0] ? (arcs[k] - arcs[i0]) / (arcs[i1] - arcs[i0]) : 0;
      run.push({
        x: points[i0].x + (points[i1].x - points[i0].x) * t,
        y: points[i0].y + (points[i1].y - points[i0].y) * t,
        floor: points[k].floor,
        eye: points[k].eye
      });
    }
    return run;
  });
  return { points: simplify(joinRuns(runs), STRAIGHT_RESIDUAL), corners };
}

/** 路线拉直以后留下的一个拐点（诊断用）：在轨迹上的米数和局部坐标，离前后拐点连线的距离、原因、位置同 StraightCorner */
export interface RouteCorner extends Omit<StraightCorner, 'index'> {
  readonly distance: number;
  readonly x: number;
  readonly y: number;
}

/**
 * 轨迹上 from～to 米这一段做成路线：地板按扫描仪离地是否平稳选（steadyFloors），去掉两头脚下没有表面的点，中间的按前后插值；
 * 地板取中位数去抖，眼高按这个地板算、取前后的最小值，再拉直、抽稀（grid 是 trackOf 用的那份）。段不在轨迹范围里、有效的点不到两个时报错
 */
export function routeOf(
  track: readonly TrackSample[],
  from: number,
  to: number,
  grid: FloorGrid,
  options: RouteOptions = {}
): RoamPoint[] {
  return routeWithCorners(track, from, to, grid, options).points;
}

/** 轨迹上 from～to 米这一段拉直用的水平容差（米） */
export interface Stretch {
  readonly from: number;
  readonly to: number;
  readonly tolerance: number;
}

/** 路线的选项 */
export interface RouteOptions {
  /** 拉直的水平容差（米），默认 STRAIGHT_HORIZONTAL */
  readonly tolerance?: number;
  /** 按轨迹米数分段的容差，比 tolerance 优先；几段重叠时取写在后面的 */
  readonly stretches?: readonly Stretch[];
  /** 给定的地板（轨迹取样点的序号 → 高度）：补的地板经过的取样点（ADR 0170），这些点不按 steadyFloors 选 */
  readonly floors?: ReadonlyMap<number, number>;
}

/** 同 routeOf，另外给出拉直以后留下的拐点和原因（诊断用） */
export function routeWithCorners(
  track: readonly TrackSample[],
  from: number,
  to: number,
  grid: FloorGrid,
  { tolerance = STRAIGHT_HORIZONTAL, stretches = [], floors: given = new Map() }: RouteOptions = {}
): { readonly points: RoamPoint[]; readonly corners: RouteCorner[] } {
  for (const value of [tolerance, ...stretches.map(stretch => stretch.tolerance)]) {
    if (!(value > 0)) {
      throw new ToolError(`拉直的水平容差要大于 0：${value}`);
    }
  }
  const total = track.at(-1)?.distance ?? 0;
  if (!(from >= 0 && to > from && to <= total + ROUTE_SPACING)) {
    throw new ToolError(`路线段 ${from}～${to} 米不在轨迹里（轨迹共 ${total.toFixed(1)} 米）`);
  }
  const chosen = steadyFloors(track, grid).map((floor, i) => given.get(i) ?? floor);
  const part = track
    .map((sample, i) => ({ ...sample, floor: chosen[i] }))
    .filter((sample) => sample.distance >= from && sample.distance <= to);
  const first = part.findIndex((sample) => sample.floor !== undefined);
  const last = part.findLastIndex((sample) => sample.floor !== undefined);
  if (first === -1 || last <= first) {
    throw new ToolError(`路线段 ${from}～${to} 米脚下没有网格`);
  }
  const usable = part.slice(first, last + 1);
  // 中间脚下没有表面的点：按前后有表面的两个点线性插值（两头已经去掉，前后一定有）
  const known = usable.filter((sample): sample is TrackSample & { floor: number } => sample.floor !== undefined);
  const floors = usable.map((sample) => {
    if (sample.floor !== undefined) {
      return sample.floor;
    }
    const next = known.findIndex((other) => other.distance > sample.distance);
    const a = known[next - 1];
    const b = known[next];
    return a.floor + ((b.floor - a.floor) * (sample.distance - a.distance)) / (b.distance - a.distance);
  });
  const routeFloors = floors.map((_, i) => medianAround(floors, i));
  // 眼高按路线的地板（视点站的地方）算，不按这个点脚下的表面：单个点脚下可能是栏杆、展柜、台阶的顶，按它算视点被压到贴地
  const eyes = usable.map((sample, i) => eyeAbove(routeFloors[i], sample.ceiling));
  const { points, corners } = straighten(
    usable.map(({ point: [x, y] }, i) => ({
      x,
      y,
      floor: routeFloors[i],
      eye: Math.min(...windowAround(eyes, i))
    })),
    grid,
    usable.map(
      ({ distance }) =>
        stretches.findLast(stretch => distance >= stretch.from && distance <= stretch.to)?.tolerance ?? tolerance
    )
  );
  return {
    points,
    corners: corners.map(({ index, offset, tolerance: here, reason, at }) => {
      const { distance, point } = usable[index];
      return { distance, x: point[0], y: point[1], offset, tolerance: here, reason, at };
    })
  };
}

/**
 * 出生点：从轨迹的 from 米起找第一个"站着拿扫描仪"的点（扫描仪离脚下 1～1.5 米、头顶净空够），朝向是之后 8 米那一点的方向
 * （局部系里从 x 轴逆时针的弧度）。扫描一般从入口开始，开头几米常在网格的边上、脚下没有表面，所以不直接取第一个点
 */
export function spawnOf(track: readonly TrackSample[], from = 0): { readonly point: RoamPoint; readonly yaw: number } {
  for (let i = 0; i < track.length; i++) {
    const { point, distance, floor, ceiling } = track[i];
    if (distance < from || floor === undefined) {
      continue;
    }
    const hold = point[2] - floor;
    const standing = hold >= SCANNER_WINDOW.min && hold <= SCANNER_WINDOW.max;
    const roomy = ceiling === undefined || ceiling - floor >= SPAWN_HEADROOM;
    const ahead = track.find((sample, j) => j > i && sample.distance >= distance + SPAWN_LOOK);
    if (standing && roomy && ahead) {
      return {
        point: { x: point[0], y: point[1], floor, eye: EYE_HEIGHT },
        yaw: Math.atan2(ahead.point[1] - point[1], ahead.point[0] - point[0])
      };
    }
  }
  throw new ToolError(`轨迹的 ${from} 米以后找不到站着拿扫描仪、头顶够高的点，不能取出生点`);
}
