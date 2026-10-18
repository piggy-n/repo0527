import { bboxClip } from '@turf/bbox-clip';

type Point = readonly [number, number];
type Bounds = [number, number, number, number];

/** 一段可见路径保留在原路径中的起始里程，裁剪不能重置虚线相位 */
export interface VisibleLinePath {
  readonly points: readonly number[];
  readonly distance: number;
  readonly closed: boolean;
}

interface Part {
  readonly points: number[];
  readonly distance: number;
}

/** 只把画布附近的线段交给 Canvas；远端里程仍参与虚线相位 */
export function* visibleLinePaths(
  paths: readonly ArrayLike<number>[],
  project: (x: number, y: number) => Point,
  bounds: Bounds,
  closed: boolean,
  dash: readonly number[]
): Generator<VisibleLinePath | undefined> {
  let vertices = 0;
  for (const path of paths) {
    if (path.length < 4) { continue; }
    const first = project(path[0], path[1]);
    let previous = first;
    let distance = 0;
    let current: Part | undefined;
    const parts: Part[] = [];
    const repeated = path[0] === path[path.length - 2] && path[1] === path[path.length - 1];
    const end = path.length + (closed && !repeated ? 2 : 0);
    let clipped = false;
    for (let index = 2; index < end; index += 2) {
      const next = index < path.length ? project(path[index], path[index + 1]) : first;
      const length = Math.hypot(next[0] - previous[0], next[1] - previous[1]);
      const segment = clipSegment(previous, next, bounds);
      if (segment) {
        const [start, finish] = segment;
        if (!current || !samePoint(start, [current.points.at(-2)!, current.points.at(-1)!])) {
          current = { points: [start[0], start[1]], distance: distance + Math.hypot(start[0] - previous[0], start[1] - previous[1]) };
          parts.push(current);
        }
        current.points.push(finish[0], finish[1]);
        if (!samePoint(finish, next)) { current = undefined; }
        clipped ||= !samePoint(start, previous) || !samePoint(finish, next);
      } else {
        current = undefined;
        clipped = true;
      }
      distance += length;
      previous = next;
      if (++vertices % 256 === 0) { yield; }
    }
    const visible: Part[] = [];
    for (const part of parts) {
      if (dash.length === 0) {
        visible.push(part);
      } else {
        for (const item of dashedParts(part, dash)) {
          if (item) { visible.push(item); } else { yield; }
        }
      }
    }
    // 两端均为实段时接回原闭合拐角；中间空段仍保持两个真正的端帽
    if (closed && visible.length > 1 && inside(first, bounds)) {
      const initial = visible[0];
      const last = visible.at(-1)!;
      if (samePoint([last.points.at(-2)!, last.points.at(-1)!], first) && samePoint([initial.points[0], initial.points[1]], first)) {
        for (let index = 2; index < initial.points.length; index += 2) {
          last.points.push(initial.points[index], initial.points[index + 1]);
          if (++vertices % 256 === 0) { yield; }
        }
        visible.shift();
      }
    }
    for (const part of visible) {
      const entire = visible.length === 1 && !clipped && samePoint([part.points[0], part.points[1]], [part.points.at(-2)!, part.points.at(-1)!]);
      yield { ...part, closed: closed && entire };
    }
  }
}

// 只展开有限可见片段中的虚线，全部短路径交给一次 stroke，透明度和阴影不能逐片叠加
function* dashedParts(part: Part, values: readonly number[]): Generator<Part | undefined> {
  const dash = values.length % 2 === 0 ? values : [...values, ...values];
  const cycle = dash.reduce((sum, value) => sum + value, 0);
  if (!(cycle > 0) || !Number.isFinite(cycle) || dash.some(value => !Number.isFinite(value) || value < 0)) {
    throw new Error('虚线周期必须是有限正数');
  }
  let phase = part.distance % cycle;
  let index = 0;
  while (phase > 0) {
    if (phase < dash[index]) { break; }
    phase -= dash[index];
    index = (index + 1) % dash.length;
  }
  let remaining = dash[index] - phase;
  let current: Part | undefined;
  let travelled = 0;
  let operations = 0;
  for (let vertex = 2; vertex < part.points.length; vertex += 2) {
    const start: Point = [part.points[vertex - 2], part.points[vertex - 1]];
    const end: Point = [part.points[vertex], part.points[vertex + 1]];
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
    let consumed = 0;
    const pointAt = (value: number): Point => length === 0 ? start : [
      start[0] + (end[0] - start[0]) * value / length,
      start[1] + (end[1] - start[1]) * value / length
    ];
    while (consumed < length) {
      // 周期总长为正，连续零段最多绕一圈；零长度实段仍由 round cap 画成点
      while (remaining === 0) {
        if (dash[index] === 0 && index % 2 === 0) {
          const point = pointAt(consumed);
          yield { points: [...point, ...point], distance: part.distance + travelled + consumed };
        }
        index = (index + 1) % dash.length;
        remaining = dash[index];
        if (index % 2 === 1 && remaining > 0 && current) { yield current; current = undefined; }
      }
      const amount = Math.min(remaining, length - consumed);
      if (!Number.isFinite(amount) || consumed + amount === consumed) {
        throw new Error('虚线长度小于当前画布坐标精度');
      }
      if (index % 2 === 0) {
        if (!current) {
          const point = pointAt(consumed);
          current = { points: [...point], distance: part.distance + travelled + consumed };
        }
        const point = pointAt(consumed + amount);
        current.points.push(point[0], point[1]);
      }
      consumed += amount;
      remaining = Math.max(0, remaining - amount);
      if (++operations % 256 === 0) { yield; }
    }
    travelled += length;
  }
  if (current) { yield current; }
}

function samePoint(first: Point, second: Point): boolean { return first[0] === second[0] && first[1] === second[1]; }

function inside([x, y]: Point, bounds: Bounds): boolean {
  return x >= bounds[0] && y >= bounds[1] && x <= bounds[2] && y <= bounds[3];
}

// 大多数段直接接纳或剔除，仅穿过裁剪边框的段调用现有几何库
function clipSegment(start: Point, end: Point, bounds: Bounds): readonly [Point, Point] | undefined {
  if ((start[0] < bounds[0] && end[0] < bounds[0]) || (start[0] > bounds[2] && end[0] > bounds[2]) ||
    (start[1] < bounds[1] && end[1] < bounds[1]) || (start[1] > bounds[3] && end[1] > bounds[3])) {
    return undefined;
  }
  if (inside(start, bounds) && inside(end, bounds)) { return [start, end]; }
  const result = bboxClip({ type: 'LineString', coordinates: [[...start], [...end]] }, bounds).geometry;
  if (result.type !== 'LineString' || result.coordinates.length < 2) { return undefined; }
  const [first, last] = [result.coordinates[0], result.coordinates.at(-1)!];
  return [[first[0], first[1]], [last[0], last[1]]];
}
