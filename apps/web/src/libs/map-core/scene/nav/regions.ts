import { HEIGHT_UNITS, NAV_DEFAULTS, NAV_EMPTY, type NavGridData, type RawNavGrid } from './nav-data';
import { NavGrid } from './nav-grid';

const NEIGHBORS4: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1]
];
/** 区域编号存 Uint16，0 表示站不住 */
const MAX_REGIONS = 65535;

/**
 * 算出"人能站住的节点"及其步行区域（ADR 0085）。能站住 = 这层地板在室内，且身体半径的圆盘覆盖到的每一格
 * 都有落差在台阶内的室内地板；按格子判定，不在圆周上采点（采样点落在格子边界上时会漏掉薄墙、细柱子）。
 * 相邻格落差不超过一级台阶就连通；闸机、站台边缘、电梯井壁把空间切成不同区域
 */
export function labelRegions(
  raw: RawNavGrid,
  { agentRadius = NAV_DEFAULTS.agentRadius, stepHeight = NAV_DEFAULTS.stepHeight } = {}
): NavGridData {
  const grid = new NavGrid({ ...raw, agentRadius, stepHeight });
  const { data } = raw;
  const { maxLevels, cellSize } = raw.meta;
  const total = data.length;
  // 0 未算，1 能站，-1 不能
  const walkState = new Int8Array(total);
  const labels = new Uint16Array(total);
  const sizes = [0];
  const queue = new Int32Array(total);
  // 圆盘覆盖到的格子：格子里离中心最近的点在半径以内
  const disk: [number, number][] = [];
  const reach = Math.ceil(agentRadius / cellSize + 0.5);
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const nx = Math.max(0, Math.abs(dx) - 0.5) * cellSize;
      const ny = Math.max(0, Math.abs(dy) - 0.5) * cellSize;
      if ((dx || dy) && nx * nx + ny * ny < agentRadius * agentRadius - 1e-9) {
        disk.push([dx, dy]);
      }
    }
  }
  const hasIndoorFloorNear = (cx: number, cy: number, z: number) => {
    const base = grid.cellBase(cx, cy);
    if (base === -1) {
      return false;
    }
    for (let i = 0; i < maxLevels && data[base + i] !== NAV_EMPTY; i++) {
      const value = data[base + i];
      if (value & 1 && Math.abs((value >> 1) / HEIGHT_UNITS - z) <= stepHeight) {
        return true;
      }
    }
    return false;
  };
  const walkable = (index: number) => {
    if (walkState[index] === 0) {
      const floor = grid.nodeFloor(index);
      const { cx, cy } = grid.decode(index);
      const fits = grid.nodeCovered(index) && disk.every(([ox, oy]) => hasIndoorFloorNear(cx + ox, cy + oy, floor));
      walkState[index] = fits ? 1 : -1;
    }
    return walkState[index] === 1;
  };
  for (let start = 0; start < total; start++) {
    if (data[start] === NAV_EMPTY || labels[start] || !walkable(start)) {
      continue;
    }
    const id = Math.min(sizes.length, MAX_REGIONS);
    let head = 0;
    let tail = 0;
    labels[start] = id;
    queue[tail++] = start;
    while (head < tail) {
      const index = queue[head++];
      for (const [dx, dy] of NEIGHBORS4) {
        const next = grid.stepNode(index, dx, dy);
        if (next !== -1 && !labels[next] && walkable(next)) {
          labels[next] = id;
          queue[tail++] = next;
        }
      }
    }
    if (id < sizes.length) {
      sizes[id] += tail;
    } else {
      sizes.push(tail);
    }
  }
  return { ...raw, agentRadius, stepHeight, labels, sizes: Uint32Array.from(sizes) };
}
