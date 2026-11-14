// 从扫描轨迹取步行的出生点和漫游路线（ADR 0156 第 4 节）：轨迹是扫描时人拿着扫描仪走过的地方，一定能走；
// 贴到脚下的表面上，矮的地方算出眼高，按米数取段、抽稀。都在网格的局部系里，换成经纬度在 cli.ts
import { FIT_WINDOW, SCANNER_WINDOW } from './fit.ts';
import { type FloorGrid, floorsAt } from './floor-grid.ts';
import { ToolError } from './errors.ts';
import { samplePath, type Vec3 } from './lcc2-data.ts';

/** 视点在脚下地板以上的米数，同 map-core 的 EYE_HEIGHT */
export const EYE_HEIGHT = 1.6;
// 矮的地方视点离顶板至少这么远，同 map-core 的 Walker
const HEAD_CLEARANCE = 0.2;
/** 路线取样的间隔（米） */
export const ROUTE_SPACING = 0.25;
// 地板、眼高按前后这么多个取样点一起取：地板取中位数（表面有几厘米的起伏，不滤的话视点跟着上下抖），
// 眼高取最小值（门楣、梁只占一两个点，取中位数会滤掉，视点穿进顶板）
const WINDOW_HALF = 2;
// 抽稀的容差：水平偏离折线、地板和眼高偏离插值不超过这么多米
const SIMPLIFY_HORIZONTAL = 0.2;
const SIMPLIFY_VERTICAL = 0.08;
// 拉直：水平偏离扫描轨迹不超过这么多米的一段换成直线（扫描的人在通道里从一面墙斜着走到另一面，摆幅约 0.5 米）；
// 直线上的点都落在直线上以后，再按这个容差去掉多余的点
const STRAIGHT_HORIZONTAL = 1;
const STRAIGHT_RESIDUAL = 0.02;
// 直线上相机经过的地方要空：每隔 CLEAR_STEP 米，中线和左右各偏 CLEAR_LATERAL 米处，离路线的地板 FLOOR_REACH 米内有表面，
// 地板以上 STEP_OVER 米（台阶、路沿，相机从上面过）到视点以上 HEAD_CLEARANCE 米（同眼高的规则）之间没有别的表面
const CLEAR_STEP = 0.1;
const CLEAR_LATERAL = 0.2;
const FLOOR_REACH = 0.3;
const STEP_OVER = 0.5;
// 出生点：朝向取之后这么远（沿轨迹）那一点的方向，开头的小弯不算，净空至少这么高（矮通道里不出生）
const SPAWN_LOOK = 8;
const SPAWN_HEADROOM = 1.8;

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

/**
 * 轨迹（网格的局部系）每 0.25 米取一个点，算累计的米数（三维）和脚下、头顶的表面。头顶是扫描仪上方的第一层表面，
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
    const [x, y, z] = point;
    let floor: number | undefined;
    for (const height of floorsAt(grid, x, y)) {
      if (height <= z - FIT_WINDOW.min && height >= z - FIT_WINDOW.max) {
        floor = height;
      }
    }
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

// 视点在地板以上多高：净空够时是眼高，矮的地方离顶板留 HEAD_CLEARANCE
const eyeAbove = (floor: number, ceiling: number | undefined) =>
  ceiling === undefined ? EYE_HEIGHT : Math.min(EYE_HEIGHT, ceiling - floor - HEAD_CLEARANCE);

// 第 i 个和前后各 WINDOW_HALF 个
const windowAround = (values: readonly number[], i: number) =>
  values.slice(Math.max(0, i - WINDOW_HALF), i + WINDOW_HALF + 1);

// 窗口里的中位数
function medianAround(values: readonly number[], i: number): number {
  const sorted = windowAround(values, i).toSorted((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
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

// 站在 floor 上、视点在 top 的相机在 (x, y) 这一列是不是空的。扫描的地面常有一两格的洞，脚下的表面可以在 holes 给的相邻方格里
function clearAt(
  grid: FloorGrid,
  x: number,
  y: number,
  floor: number,
  top: number,
  holes: readonly (readonly [number, number])[] = []
): boolean {
  let ground = false;
  for (const height of floorsAt(grid, x, y)) {
    if (Math.abs(height - floor) <= FLOOR_REACH) {
      ground = true;
    } else if (height > floor + STEP_OVER && height < top + HEAD_CLEARANCE) {
      return false;
    }
  }
  return (
    ground ||
    holes.some(([dx, dy]) => floorsAt(grid, x + dx, y + dy).some(height => Math.abs(height - floor) <= FLOOR_REACH))
  );
}

// 中线：周围 8 格；两侧：只沿前进方向的前后两格。墙（陡的面不进方格）靠"没有地面"认出来，墙和前进方向平行，
// 沿前进方向找不到地面；横在路上的洞沿前进方向能跨过去
const around = (cell: number) =>
  [-1, 0, 1]
    .flatMap(i => [-1, 0, 1].map(j => [i * cell, j * cell] as const))
    .filter(([dx, dy]) => dx !== 0 || dy !== 0);
const along = (cell: number, ux: number, uy: number) => [[ux * cell, uy * cell] as const, [-ux * cell, -uy * cell] as const];

// 沿 (nx, ny) 方向两侧 CLEAR_LATERAL 米处都是空的（前进方向是 (ny, -nx)）
function clearAside(grid: FloorGrid, point: RoamPoint, nx: number, ny: number): boolean {
  const top = point.floor + point.eye;
  const holes = along(grid.cellSize, ny, -nx);
  return [-CLEAR_LATERAL, CLEAR_LATERAL].every(offset =>
    clearAt(grid, point.x + nx * offset, point.y + ny * offset, point.floor, top, holes)
  );
}

// 每个点的水平弧长
function arcLengths(points: readonly RoamPoint[]): number[] {
  const arcs = [0];
  for (let i = 1; i < points.length; i++) {
    arcs.push(arcs[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  }
  return arcs;
}

/**
 * 拉直（ADR 0156 第 4 节）：先只按水平抽稀（容差 STRAIGHT_HORIZONTAL），一段直线要代替原来那段，相机沿它走时周围得是空的；
 * 原来的点按弧长比例落到直线上，地板、眼高跟着原来的点（检查时头顶按眼高的规则留了余量，不用在新位置重算），最后在直线上按地板、眼高抽稀。
 * 原来的点两侧本来就不空的地方（贴着东西走过），直线在这一处只要求中线空
 */
function straighten(points: readonly RoamPoint[], grid: FloorGrid): RoamPoint[] {
  if (points.length <= 2) {
    return [...points];
  }
  const arcs = arcLengths(points);
  // 原来的点两侧空不空，方向取前后两点
  const roomy = points.map((point, i) => {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    return length > 0 && clearAside(grid, point, -(b.y - a.y) / length, (b.x - a.x) / length);
  });
  // first～last 换成直线时，相机经过的地方是不是空的；地板、眼高、两侧要不要空按弧长比例取原来的点
  const nearby = around(grid.cellSize);
  const clearChord = (first: number, last: number) => {
    const a = points[first];
    const b = points[last];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const nx = length > 0 ? -(b.y - a.y) / length : 0;
    const ny = length > 0 ? (b.x - a.x) / length : 0;
    const steps = Math.max(1, Math.ceil(length / CLEAR_STEP));
    let k = first;
    for (let s = 0; s <= steps; s++) {
      const arc = arcs[first] + ((arcs[last] - arcs[first]) * s) / steps;
      while (k < last && arcs[k + 1] < arc) {
        k++;
      }
      const p = points[k];
      const q = points[Math.min(k + 1, last)];
      const t = arcs[k + 1] > arcs[k] ? Math.min(1, (arc - arcs[k]) / (arcs[k + 1] - arcs[k])) : 0;
      const point: RoamPoint = {
        x: a.x + ((b.x - a.x) * s) / steps,
        y: a.y + ((b.y - a.y) * s) / steps,
        floor: p.floor + (q.floor - p.floor) * t,
        eye: p.eye + (q.eye - p.eye) * t
      };
      const wanted = t < 0.5 ? roomy[k] : roomy[Math.min(k + 1, last)];
      // 两侧不查的地方（门洞这类本来就窄的）中线不跨洞：门框下没有地面，跨过去直线就切进门框
      if (!clearAt(grid, point.x, point.y, point.floor, point.floor + point.eye, wanted ? nearby : [])) {
        return false;
      }
      if (wanted && !clearAside(grid, point, nx, ny)) {
        return false;
      }
    }
    return true;
  };
  // 先按原来的容差抽稀：直线通不过的地方退回到这些点（原来的路线），不退回到每 0.25 米一个的取样点
  const base = douglasPeucker(
    points.map((_, i) => i),
    (first, last) => worstOf(points, first, last, SIMPLIFY_HORIZONTAL, SIMPLIFY_VERTICAL)
  );
  // 再只按水平抽稀：地板、眼高要留的点放到直线上以后再补，补在这里的话每个点都在原来摆动的位置上拐一次
  const anchors = douglasPeucker(base, (first, last) => {
    let farthest = -1;
    let distance = -1;
    for (let j = first + 1; j < last; j++) {
      const offset = project(points[base[j]], points[base[first]], points[base[last]]).distance;
      if (offset > distance) {
        distance = offset;
        farthest = j;
      }
    }
    // 偏得太远，或者偏差在容差以内但直线不空：都在偏得最远的点拆开
    return distance > STRAIGHT_HORIZONTAL || !clearChord(base[first], base[last]) ? farthest : -1;
  });
  // 原来的点按弧长比例落到所在的直线上，placed[k] 对应 points[k]
  const placed: RoamPoint[] = [];
  for (let n = 1; n < anchors.length; n++) {
    const i0 = anchors[n - 1];
    const i1 = anchors[n];
    for (let k = n === 1 ? i0 : i0 + 1; k <= i1; k++) {
      const t = arcs[i1] > arcs[i0] ? (arcs[k] - arcs[i0]) / (arcs[i1] - arcs[i0]) : 0;
      placed.push({
        ...points[k],
        x: points[i0].x + (points[i1].x - points[i0].x) * t,
        y: points[i0].y + (points[i1].y - points[i0].y) * t
      });
    }
  }
  return simplify(placed, STRAIGHT_RESIDUAL);
}


/**
 * 轨迹上 from～to 米这一段做成路线：去掉两头脚下没有表面的点，中间的按前后插值；地板取中位数去抖，眼高按这个地板算、取前后的最小值，
 * 再拉直、抽稀（grid 是 trackOf 用的那份）。段不在轨迹范围里、有效的点不到两个时报错
 */
export function routeOf(track: readonly TrackSample[], from: number, to: number, grid: FloorGrid): RoamPoint[] {
  const total = track.at(-1)?.distance ?? 0;
  if (!(from >= 0 && to > from && to <= total + ROUTE_SPACING)) {
    throw new ToolError(`路线段 ${from}～${to} 米不在轨迹里（轨迹共 ${total.toFixed(1)} 米）`);
  }
  const part = track.filter((sample) => sample.distance >= from && sample.distance <= to);
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
  return straighten(
    usable.map(({ point: [x, y] }, i) => ({
      x,
      y,
      floor: routeFloors[i],
      eye: Math.min(...windowAround(eyes, i))
    })),
    grid
  );
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
