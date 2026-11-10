import { type FloorGrid, cellAt, floorBelow, heightExtent } from './floor-grid.ts';
import { samplePath, type Vec3 } from './lcc2-data.ts';

// 轨迹和碰撞网格之间的平移：扫描仪拿在手里，轨迹点离脚下最近的表面有一定高度。
// 平移后满足的点越多越好；思路和 2026-11-09 的调查（ADR 0149 背景）相同，这里只求平移、不求旋转

/** 轨迹点离脚下最近的表面的高度范围（米） */
export interface HeightWindow {
  readonly min: number;
  readonly max: number;
}

/** 水平粗搜用宽的窗口：手持的高度、坡道、台阶、蹲下都留余量；竖直方向在这个窗口里能平移将近 2 米，定不下来 */
export const FIT_WINDOW: HeightWindow = { min: 0.3, max: 2.5 };

/** 手持扫描仪离地的高度：竖直平移和水平的细调按它定，轨迹核对也按它查 */
export const SCANNER_WINDOW: HeightWindow = { min: 1, max: 1.5 };

export interface FitOptions {
  /** 粗搜的水平步长（米），也是粗搜时轨迹的取样间隔 */
  readonly coarseStep?: number;
  /** 细搜时轨迹的取样间隔（米） */
  readonly sampleSpacing?: number;
}

export interface Fit {
  /** 加到轨迹上、把它放进网格局部系的平移（米，局部系的 x、y、z） */
  readonly shift: Vec3;
  /** 宽窗口、扫描仪高度的窗口下满足的轨迹点的比例 */
  readonly score: number;
  readonly scannerScore: number;
}

/** 平移 shift 后，离脚下最近的表面的高度在 window 里的轨迹点的比例 */
export function scoreShift(points: readonly Vec3[], grid: FloorGrid, shift: Vec3, window: HeightWindow): number {
  if (points.length === 0) {
    return 0;
  }
  let hits = 0;
  for (const [x, y, z] of points) {
    const height = z + shift[2];
    const floor = floorBelow(grid, x + shift[0], y + shift[1], height);
    if (floor !== undefined && height - floor >= window.min && height - floor <= window.max) {
      hits++;
    }
  }
  return hits / points.length;
}

interface HeightRange {
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

/** 按竖直平移分档计数 */
class HeightSearch {
  readonly range: HeightRange;
  readonly counts: Int32Array;

  constructor(range: HeightRange) {
    this.range = range;
    this.counts = new Int32Array(Math.floor((range.max - range.min) / range.step) + 1);
  }

  /**
   * 水平平移固定为 (tx, ty) 时最好的竖直平移。一个点以第 k 层为"脚下最近的表面"并满足窗口，
   * 竖直平移要在 [f_k + min, min(f_k + max, f_k+1)) - z 里；各层的区间不重叠，每个点在一档里最多算一次
   */
  best(points: readonly Vec3[], grid: FloorGrid, tx: number, ty: number, window: HeightWindow) {
    const { counts, range } = this;
    const { offsets, heights } = grid;
    counts.fill(0);
    for (const [x, y, z] of points) {
      const cell = cellAt(grid, x + tx, y + ty);
      if (cell < 0) {
        continue;
      }
      const end = offsets[cell + 1];
      for (let k = offsets[cell]; k < end; k++) {
        const floor = heights[k];
        const top = k + 1 < end ? Math.min(floor + window.max, heights[k + 1]) : floor + window.max;
        const first = Math.max(0, Math.ceil((floor + window.min - z - range.min) / range.step));
        const last = Math.min(counts.length - 1, Math.floor((top - z - range.min) / range.step));
        for (let bin = first; bin <= last; bin++) {
          counts[bin]++;
        }
      }
    }
    // 最高的常是连续的几档（地面平），取第一段的中间
    let hits = 0;
    let first = -1;
    let last = -1;
    counts.forEach((count, bin) => {
      if (count > hits) {
        hits = count;
        first = bin;
        last = bin;
      } else if (count === hits && hits > 0 && bin === last + 1) {
        last = bin;
      }
    });
    return { tz: range.min + ((first + last) / 2) * range.step, hits };
  }
}

function extent(values: readonly number[]): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return { min, max };
}

interface Candidate {
  readonly tx: number;
  readonly ty: number;
  readonly tz: number;
  readonly hits: number;
}

/**
 * 在 center 周围 ±radius 内按 step 搜水平平移。地面平时峰是平的，得分最高的连成一片：
 * 取和第一个最高的连在一起的那一片的平均，远处偶然同分的不算
 */
function refine(
  points: readonly Vec3[],
  grid: FloorGrid,
  center: Candidate,
  radius: number,
  step: number,
  search: HeightSearch,
  window: HeightWindow
): Candidate {
  const steps = Math.round(radius / step);
  const size = 2 * steps + 1;
  const candidates: Candidate[] = [];
  let best = -1;
  let top = -1;
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      const tx = center.tx + (i - steps) * step;
      const ty = center.ty + (j - steps) * step;
      const candidate = { tx, ty, ...search.best(points, grid, tx, ty, window) };
      candidates.push(candidate);
      if (candidate.hits > top) {
        top = candidate.hits;
        best = candidates.length - 1;
      }
    }
  }
  const plateau = new Set([best]);
  const queue = [best];
  for (let index = queue.pop(); index !== undefined; index = queue.pop()) {
    const i = Math.floor(index / size);
    const j = index % size;
    for (const [ni, nj] of [
      [i - 1, j],
      [i + 1, j],
      [i, j - 1],
      [i, j + 1]
    ]) {
      const neighbor = ni * size + nj;
      if (ni >= 0 && nj >= 0 && ni < size && nj < size && !plateau.has(neighbor) && candidates[neighbor].hits === top) {
        plateau.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  const members = [...plateau].map((index) => candidates[index]);
  const mean = (key: 'tx' | 'ty' | 'tz') => members.reduce((sum, member) => sum + member[key], 0) / members.length;
  return { tx: mean('tx'), ty: mean('ty'), tz: mean('tz'), hits: top };
}

/**
 * 求轨迹到网格的平移：在两者的范围能重叠的所有水平平移上按宽窗口粗搜，在最好的附近细搜；
 * 最后按扫描仪离地的高度（窄窗口）定竖直平移、再细调水平：宽窗口在 1 米内几乎是平的，窄窗口对路缘、台阶敏感
 */
export function fitShift(trajectory: readonly Vec3[], grid: FloorGrid, options: FitOptions = {}): Fit {
  const coarseStep = options.coarseStep ?? 2;
  const coarsePoints = samplePath(trajectory, coarseStep);
  const points = samplePath(trajectory, options.sampleSpacing ?? 0.5);
  if (points.length === 0 || grid.heights.length === 0) {
    return { shift: [0, 0, 0], score: 0, scannerScore: 0 };
  }

  const pointX = extent(points.map((point) => point[0]));
  const pointY = extent(points.map((point) => point[1]));
  const pointZ = extent(points.map((point) => point[2]));
  const floorZ = heightExtent(grid);
  const gridMaxX = grid.minX + grid.columns * grid.cellSize;
  const gridMaxY = grid.minY + grid.rows * grid.cellSize;

  const search = new HeightSearch({
    min: floorZ.min + FIT_WINDOW.min - pointZ.max,
    max: floorZ.max + FIT_WINDOW.max - pointZ.min,
    step: 0.25
  });
  let coarse: Candidate = { tx: 0, ty: 0, tz: 0, hits: -1 };
  for (let tx = grid.minX - pointX.max; tx <= gridMaxX - pointX.min; tx += coarseStep) {
    for (let ty = grid.minY - pointY.max; ty <= gridMaxY - pointY.min; ty += coarseStep) {
      const { tz, hits } = search.best(coarsePoints, grid, tx, ty, FIT_WINDOW);
      if (hits > coarse.hits) {
        coarse = { tx, ty, tz, hits };
      }
    }
  }
  const wide = refine(points, grid, coarse, coarseStep * 1.5, coarseStep / 2, search, FIT_WINDOW);

  // 宽窗口里竖直方向能平移的范围不超过窗口的宽度，在它两边找窄窗口最好的位置
  const span = FIT_WINDOW.max - FIT_WINDOW.min;
  const vertical = new HeightSearch({ min: wide.tz - span, max: wide.tz + span, step: 0.02 });
  const narrow = refine(points, grid, wide, 1, 0.25, vertical, SCANNER_WINDOW);
  const fine = refine(points, grid, narrow, 0.25, 0.05, vertical, SCANNER_WINDOW);
  const shift: Vec3 = [fine.tx, fine.ty, fine.tz];
  return {
    shift,
    score: scoreShift(points, grid, shift, FIT_WINDOW),
    scannerScore: scoreShift(points, grid, shift, SCANNER_WINDOW)
  };
}
