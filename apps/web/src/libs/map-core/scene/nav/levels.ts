// 楼层（ADR 0085 第 4 节）：从导航网格自动分楼层、找某层上能站的节点；只依赖导航网格，不认识具体场景
import { NAV_EMPTY } from './nav-data';
import type { NavGrid, NavPoint } from './nav-grid';

/** 小于这么多格（10 平方米）的区域不上地图：闸机柜顶、设备顶、电梯轿厢 */
export const MIN_REGION_CELLS = 250;
/** 分楼层时高度直方图的步长（米） */
const BIN = 0.1;
// 同一高度的地面面积要达到最大那一片的这个比例（且不少于 5 平方米）才参与分层：楼梯、扶梯、坡道每个高度只有几平米，
// 不能让它们把上下两层连成一片
const MAJOR_BIN_RATIO = 0.05;
const MIN_BIN_CELLS = 125;
/** 两片地面高差超过这么多算不同楼层（层高一般 3 米以上） */
const LEVEL_GAP = 2;
/** 一层至少这么多格（200 平方米），更小的（屋面设备平台之类）并入相邻楼层 */
const MIN_LEVEL_CELLS = 5000;
/** 场景配置的楼层名按高度匹配时的容差 */
const NAME_TOLERANCE = 0.5;
/** 比地面低不到这么多的楼层还算首层（1F），再往下才是地下层 */
const GROUND_MARGIN = 0.5;

/** 一个楼层：height 是这层面积最大的地面高度，from～to 是归这一层的高度范围（与上下层首尾相接） */
export interface NavLevel {
  readonly index: number;
  readonly name: string;
  readonly height: number;
  /** 相对地面的高度 */
  readonly elevation: number;
  readonly from: number;
  readonly to: number;
}

export interface LevelOptions {
  /** 地面在局部系里的高度（navigationFrame 的 ground） */
  readonly groundHeight?: number;
  /** 场景自己的楼层名，height 落在哪层就叫什么 */
  readonly names?: readonly { readonly name: string; readonly height: number }[];
}

interface Cluster {
  zMin: number;
  zMax: number;
  cells: number;
  peak: number;
  height: number;
}

/**
 * 自动分楼层（从上到下）：按高度统计能站的地面面积，成片的地面高差在 LEVEL_GAP 以内的并成一层；每层的高度范围延伸到
 * 与上下层的中点，楼梯半截画在上一层、半截画在下一层；最上、最下一层不设上、下限。
 * 名称：知道地面高度时，地面以下从上往下 -1F、-2F……，地面及以上从下往上 1F、2F……；不知道时从上往下"楼层 1、2……"
 */
export function detectLevels(grid: NavGrid, { groundHeight, names = [] }: LevelOptions = {}): readonly NavLevel[] {
  const { labels } = grid;
  const bins = new Map<number, number>();
  if (labels) {
    for (let i = 0; i < labels.length; i++) {
      const label = labels[i];
      if (label && grid.componentSize(label) >= MIN_REGION_CELLS) {
        const bin = Math.round(grid.nodeFloor(i) / BIN);
        bins.set(bin, (bins.get(bin) ?? 0) + 1);
      }
    }
  }
  const clusters: Cluster[] = [];
  const minCells = Math.max(MIN_BIN_CELLS, Math.max(0, ...bins.values()) * MAJOR_BIN_RATIO);
  [...bins.entries()]
    .filter(([, cells]) => cells >= minCells)
    .toSorted((a, b) => a[0] - b[0])
    .forEach(([bin, cells]) => {
      const z = bin * BIN;
      const last = clusters.at(-1);
      if (last && z - last.zMax <= LEVEL_GAP) {
        last.zMax = z;
        last.cells += cells;
        if (cells > last.peak) {
          last.peak = cells;
          last.height = z;
        }
      } else {
        clusters.push({ zMin: z, zMax: z, cells, peak: cells, height: z });
      }
    });
  const kept = clusters.filter(cluster => cluster.cells >= MIN_LEVEL_CELLS).toReversed();
  const ground = groundHeight ?? null;
  const underground = ground === null ? [] : kept.filter(cluster => cluster.height < ground - GROUND_MARGIN);
  const aboveGround = ground === null ? [] : kept.filter(cluster => !underground.includes(cluster));
  const defaultName = (cluster: Cluster, index: number) => {
    if (ground === null) {
      return `楼层 ${index + 1}`;
    }
    const basement = underground.indexOf(cluster);
    return basement === -1 ? `${aboveGround.length - aboveGround.indexOf(cluster)}F` : `-${basement + 1}F`;
  };
  return kept.map((cluster, index) => {
    const above = index > 0 ? kept[index - 1] : null;
    const below = index < kept.length - 1 ? kept[index + 1] : null;
    const named = names.find(
      item => item.height >= cluster.zMin - NAME_TOLERANCE && item.height <= cluster.zMax + NAME_TOLERANCE
    );
    return {
      index,
      name: named?.name ?? defaultName(cluster, index),
      height: Math.round(cluster.height * 100) / 100,
      elevation: Math.round((cluster.height - (ground ?? 0)) * 10) / 10,
      from: below ? (below.zMax + cluster.zMin) / 2 : -Infinity,
      to: above ? (cluster.zMax + above.zMin) / 2 : Infinity
    };
  });
}

/** 高度 z 所在的楼层（范围首尾相接，有楼层就总能找到） */
export function levelOf(levels: readonly NavLevel[], z: number): NavLevel | null {
  return levels.find(level => z >= level.from && z < level.to) ?? levels.at(0) ?? null;
}

/** 某格在这一层上能站的节点：高度在本层范围内、所在区域不是小平台；有几层就取最接近本层高度的；没有返回 -1 */
export function nodeOnLevel(grid: NavGrid, cx: number, cy: number, level: NavLevel): number {
  const base = grid.cellBase(cx, cy);
  if (base === -1) {
    return -1;
  }
  let best = -1;
  let bestDiff = Infinity;
  for (let i = 0; i < grid.meta.maxLevels && grid.data[base + i] !== NAV_EMPTY; i++) {
    const index = base + i;
    const label = grid.componentOf(index);
    const z = grid.nodeFloor(index);
    if (label && grid.componentSize(label) >= MIN_REGION_CELLS && z >= level.from && z < level.to) {
      const diff = Math.abs(z - level.height);
      if (diff < bestDiff) {
        best = index;
        bestDiff = diff;
      }
    }
  }
  return best;
}

/** 这一层的地面范围（按网格分块粗算，最多宽出一块 6.4 米）；没有返回 null */
export function levelBounds(
  grid: NavGrid,
  level: NavLevel
): { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number } | null {
  const { chunksX, maxLevels, minX, minY, cellSize } = grid.meta;
  const { blockSize, blockChunks } = grid;
  const chunk = Math.round(Math.sqrt(blockSize / maxLevels));
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let block = 0; block < blockChunks.length; block++) {
    const start = block * blockSize;
    for (let i = start; i < start + blockSize; i++) {
      const label = grid.componentOf(i);
      if (grid.data[i] === NAV_EMPTY || !label || grid.componentSize(label) < MIN_REGION_CELLS) {
        continue;
      }
      const z = grid.nodeFloor(i);
      if (z >= level.from && z < level.to) {
        const index = blockChunks[block];
        const cx = (index % chunksX) * chunk;
        const cy = Math.floor(index / chunksX) * chunk;
        x0 = Math.min(x0, minX + cx * cellSize);
        y0 = Math.min(y0, minY + cy * cellSize);
        x1 = Math.max(x1, minX + (cx + chunk) * cellSize);
        y1 = Math.max(y1, minY + (cy + chunk) * cellSize);
        break;
      }
    }
  }
  return x0 === Infinity ? null : { minX: x0, minY: y0, maxX: x1, maxY: y1 };
}

/** 这一层上离 (x, y) 最近的能站位置（按格子由近到远一圈圈找，maxRadius 米内）；点在能站的地面上就是它所在的格子 */
export function nearestOnLevel(
  grid: NavGrid,
  level: NavLevel,
  x: number,
  y: number,
  maxRadius: number
): (NavPoint & { readonly index: number }) | null {
  const { minX, minY, cellSize } = grid.meta;
  const cx0 = Math.floor((x - minX) / cellSize);
  const cy0 = Math.floor((y - minY) / cellSize);
  const rings = Math.ceil(maxRadius / cellSize);
  let bestNode = -1;
  let bestDistance = Infinity;
  let bestCx = 0;
  let bestCy = 0;
  for (let r = 0; r <= rings; r++) {
    for (let dy = -r; dy <= r; dy++) {
      const edge = dy === -r || dy === r;
      for (let dx = -r; dx <= r; dx += edge || r === 0 ? 1 : 2 * r) {
        const node = nodeOnLevel(grid, cx0 + dx, cy0 + dy, level);
        const distance = dx * dx + dy * dy;
        if (node !== -1 && distance < bestDistance) {
          bestNode = node;
          bestDistance = distance;
          bestCx = cx0 + dx;
          bestCy = cy0 + dy;
        }
      }
    }
    // 第 r 圈之外的格子距离都不小于 r，已经找到更近的就不用再往外找
    if (bestDistance <= r * r) {
      break;
    }
  }
  if (bestNode === -1) {
    return null;
  }
  const [bx, by] = grid.cellCenter(bestCx, bestCy);
  return { index: bestNode, x: bx, y: by, floor: grid.nodeFloor(bestNode) };
}
