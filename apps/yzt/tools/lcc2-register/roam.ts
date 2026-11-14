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

/** 轨迹（网格的局部系）每 0.25 米取一个点，算累计的米数（三维）和脚下、头顶的表面 */
export function trackOf(trajectory: readonly Vec3[], grid: FloorGrid): TrackSample[] {
  let distance = 0;
  let previous: Vec3 | undefined;
  return samplePath(trajectory, ROUTE_SPACING).map((point) => {
    if (previous) {
      distance += Math.hypot(point[0] - previous[0], point[1] - previous[1], point[2] - previous[2]);
    }
    previous = point;
    const [x, y, z] = point;
    let floor: number | undefined;
    let ceiling: number | undefined;
    for (const height of floorsAt(grid, x, y)) {
      if (height <= z - FIT_WINDOW.min && height >= z - FIT_WINDOW.max) {
        floor = height;
      } else if (height > z && ceiling === undefined) {
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

// 点到 a→b 的偏差：水平到线段的距离，地板、眼高和线性插值的差，按各自的容差折算，超过 1 就要留下这个点
function deviation(point: RoamPoint, a: RoamPoint, b: RoamPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length2 = dx * dx + dy * dy;
  const t = length2 > 0 ? Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length2)) : 0;
  const horizontal = Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
  const floor = Math.abs(point.floor - (a.floor + (b.floor - a.floor) * t));
  const eye = Math.abs(point.eye - (a.eye + (b.eye - a.eye) * t));
  return Math.max(horizontal / SIMPLIFY_HORIZONTAL, floor / SIMPLIFY_VERTICAL, eye / SIMPLIFY_VERTICAL);
}

/** 抽稀（Douglas-Peucker），水平、地板、眼高一起看；首尾保留 */
export function simplify(points: readonly RoamPoint[]): RoamPoint[] {
  if (points.length <= 2) {
    return [...points];
  }
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop() ?? [0, 0];
    let worst = 0;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const value = deviation(points[i], points[first], points[last]);
      if (value > worst) {
        worst = value;
        index = i;
      }
    }
    if (worst > 1) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

/**
 * 轨迹上 from～to 米这一段做成路线：去掉两头脚下没有表面的点，中间的按前后插值；地板取中位数去抖，眼高按这个地板算、取前后的最小值，再抽稀。
 * 段不在轨迹范围里、有效的点不到两个时报错
 */
export function routeOf(track: readonly TrackSample[], from: number, to: number): RoamPoint[] {
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
  return simplify(
    usable.map(({ point: [x, y] }, i) => ({
      x,
      y,
      floor: routeFloors[i],
      eye: Math.min(...windowAround(eyes, i))
    }))
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
