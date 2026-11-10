import { SCANNER_WINDOW } from './fit.ts';
import { type FloorGrid, floorBelow } from './floor-grid.ts';
import type { Vec3 } from './lcc2-data.ts';

// 轨迹核对：轨迹点（已换到网格的局部系）离脚下最近的表面应当是手持扫描仪的高度。
// 每个点只和自己脚下的那一层比，地下、台阶上的轨迹按各自的地面算

/** 离脚下的表面 1～1.5 米的点至少占取样点的这个比例，才算通过 */
export const CHECK_PASS_RATIO = 0.8;

const HISTOGRAM_STEP = 0.25;
const HISTOGRAM_TOP = 3;

export interface TrajectoryCheck {
  /** 取样的轨迹点数 */
  readonly sampled: number;
  /** 脚下有表面的点数 */
  readonly withFloor: number;
  /** 离脚下的表面的高度在扫描仪窗口里的点数 */
  readonly inWindow: number;
  /** 脚下有表面的点离表面高度的中位数（米） */
  readonly median: number | undefined;
  /** 高度的分布：每档 0.25 米，最后一档是 3 米以上 */
  readonly histogram: readonly { readonly from: number; readonly count: number }[];
  readonly passed: boolean;
}

export function checkTrajectory(points: readonly Vec3[], grid: FloorGrid): TrajectoryCheck {
  const heights: number[] = [];
  for (const [x, y, z] of points) {
    const floor = floorBelow(grid, x, y, z);
    if (floor !== undefined) {
      heights.push(z - floor);
    }
  }
  heights.sort((a, b) => a - b);
  const inWindow = heights.filter((height) => height >= SCANNER_WINDOW.min && height <= SCANNER_WINDOW.max).length;
  const bins = Math.round(HISTOGRAM_TOP / HISTOGRAM_STEP) + 1;
  const histogram = Array.from({ length: bins }, (_, index) => ({ from: index * HISTOGRAM_STEP, count: 0 }));
  for (const height of heights) {
    const bin = histogram[Math.min(bins - 1, Math.floor(height / HISTOGRAM_STEP))];
    if (bin) {
      bin.count++;
    }
  }
  return {
    sampled: points.length,
    withFloor: heights.length,
    inWindow,
    median: heights.length > 0 ? heights[Math.floor(heights.length / 2)] : undefined,
    histogram,
    passed: points.length > 0 && inWindow / points.length >= CHECK_PASS_RATIO
  };
}
