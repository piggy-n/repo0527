import type { NavGrid, NavPoint } from './nav-grid';

export interface SpawnOptions {
  /** top：取不高于 below 的最上面一层室内地板（从地面下来，先到的是站厅这一层）；near：取离 target.z 最近的 */
  readonly mode?: 'top' | 'near';
  readonly below?: number;
  readonly maxRadius?: number;
  /** 四周这么大的范围内都要能站人 */
  readonly clearRadius?: number;
  /** 所在区域至少这么多格，避免落在柜顶、电梯轿厢里 */
  readonly minReach?: number;
}

/** 在 target 附近由近及远找一个适合出生的室内位置（需要已算好区域）；找不到返回 null */
export function findSpawn(
  grid: NavGrid,
  target: { readonly x: number; readonly y: number; readonly z: number },
  { mode = 'top', below = -2, maxRadius = 80, clearRadius = 0.6, minReach = 2500 }: SpawnOptions = {}
): NavPoint | null {
  const { cellSize, minX, minY } = grid.meta;
  const tx = Math.floor((target.x - minX) / cellSize);
  const ty = Math.floor((target.y - minY) / cellSize);
  const maxRing = Math.ceil(maxRadius / cellSize);
  const floors: number[] = [];
  const covered: boolean[] = [];
  const better = (floor: number, best: number | null) =>
    mode === 'top'
      ? floor <= below && (best === null || floor > best)
      : best === null || Math.abs(floor - target.z) < Math.abs(best - target.z);
  const tryCell = (cx: number, cy: number): NavPoint | null => {
    grid.floorsAtCell(cx, cy, floors, covered);
    let floor: number | null = null;
    floors.forEach((value, i) => {
      if (covered[i] && better(value, floor)) {
        floor = value;
      }
    });
    if (floor === null) {
      return null;
    }
    const [x, y] = grid.cellCenter(cx, cy);
    const big = grid.componentSize(grid.componentAt(x, y, floor)) >= minReach;
    return big && grid.isOpen(x, y, floor, clearRadius) ? { x, y, floor } : null;
  };
  for (let r = 0; r <= maxRing; r++) {
    for (let d = -r; d <= r; d++) {
      const candidates =
        r === 0
          ? [[tx, ty]]
          : [[tx + d, ty - r], [tx + d, ty + r], ...(Math.abs(d) < r ? [[tx - r, ty + d], [tx + r, ty + d]] : [])];
      for (const [cx, cy] of candidates) {
        const hit = tryCell(cx, cy);
        if (hit) {
          return hit;
        }
      }
    }
  }
  return null;
}
