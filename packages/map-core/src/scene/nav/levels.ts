// 楼层（ADR 0085 第 4 节）：从导航网格自动分楼层、找某层上能站的节点；只依赖导航网格，不认识具体场景
import { CHUNK, NAV_EMPTY } from './nav-data';
import type { NavGrid, NavPoint } from './nav-grid';

/** 小于这么大（平方米）的区域不上地图：闸机柜顶、设备顶、电梯轿厢 */
export const MIN_REGION_AREA = 10;
/** 分楼层时高度直方图的步长（米） */
const BIN = 0.1;
// 同一高度的地面面积要达到最大那一片的这个比例（且不少于 5 平方米）才参与分层：楼梯、扶梯、坡道每个高度只有几平米，
// 不能让它们把上下两层连成一片
const MAJOR_BIN_RATIO = 0.05;
const MIN_BIN_AREA = 5;
/** 两片地面高差超过这么多算不同楼层（层高一般 3 米以上） */
const LEVEL_GAP = 2;
/** 一层至少这么大（平方米），更小的（屋面设备平台之类）并入相邻楼层 */
const MIN_LEVEL_AREA = 200;
// 上下叠着的地面：在一组里切一刀能把这么多（平方米）、而且占切开的两半里小的那一半 STACK_SHARE 以上的地面和它正上方的
// 地面分到两边，就切开（splitStacked）。夹在中间的地面（室外的广场）会把高差都在 LEVEL_GAP 以内的上下两层连成一组
const STACK_AREA = 20;
const STACK_SHARE = 0.2;
// 几处切口分开的地面差不多时（不少于最多的这个比例），切在高差最大的空档
const STACK_NEAR_BEST = 0.5;
/** 一组的高度跨度不到这么多（米）时不找叠着的地面 */
const MIN_STACK_SPAN = 1;
// 数叠着的地面时横竖各隔这么多格取一格，计数乘回去：门槛是几十平方米，站点几乎每格都有两三层，逐格数要多花七八十毫秒
const STACK_STRIDE = 2;
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

/** 一组高度档：[档, 格数]，从低到高 */
type Bins = readonly (readonly [number, number])[];

interface Cluster {
  zMin: number;
  zMax: number;
  cells: number;
  peak: number;
  height: number;
}

/** 区域上不上地图（不是小平台）：按区域编号查 */
function mappedRegions(grid: NavGrid): Uint8Array {
  const sizes = grid.sizes ?? new Uint32Array(0);
  return Uint8Array.from(sizes, (_, id) => (id > 0 && grid.componentArea(id) >= MIN_REGION_AREA ? 1 : 0));
}

/** 各高度档能站的地面格数，只算上地图的区域 */
function floorBins(grid: NavGrid, mapped: Uint8Array): Map<number, number> {
  const { labels } = grid;
  const bins = new Map<number, number>();
  if (!labels) {
    return bins;
  }
  for (let i = 0; i < labels.length; i++) {
    if (mapped[labels[i]]) {
      const bin = Math.round(grid.nodeFloor(i) / BIN);
      bins.set(bin, (bins.get(bin) ?? 0) + 1);
    }
  }
  return bins;
}

// 分块里横竖各隔 STACK_STRIDE 格取一格：下一个取样的格子的第一层地板的下标
function nextSample(base: number, blockSize: number, maxLevels: number): number {
  const block = Math.floor(base / blockSize);
  const cell = (base - block * blockSize) / maxLevels;
  const column = (cell % CHUNK) + STACK_STRIDE;
  if (column < CHUNK) {
    return base + STACK_STRIDE * maxLevels;
  }
  const row = Math.floor(cell / CHUNK) + STACK_STRIDE;
  return row < CHUNK ? block * blockSize + row * CHUNK * maxLevels : (block + 1) * blockSize;
}

/**
 * 每组里同一格上下叠着的两档：下面那档 → 上面那档 → 格数（按 STACK_STRIDE 取样估算）。同一格的两层地板至少隔一个身高
 * （扫描模型 1.2 米），跨度不到 MIN_STACK_SPAN 的组里不会有，不扫；要扫时所有组一起扫一遍，只有一层地板的格子跳过
 */
function stackedBins(grid: NavGrid, groups: readonly Bins[], mapped: Uint8Array): Map<number, Map<number, number>>[] {
  const stacked = groups.map(() => new Map<number, Map<number, number>>());
  const { labels } = grid;
  const spans = groups.map(group => [group[0][0], group[group.length - 1][0]] as const);
  const wide = spans.map(([bottom, top]) => (top - bottom) * BIN >= MIN_STACK_SPAN);
  if (!labels || !wide.includes(true)) {
    return stacked;
  }
  // 档 → 落在哪一组的跨度里（只看要扫的组），没有为 -1
  const first = spans[0][0];
  const groupOf = new Int16Array(spans[spans.length - 1][1] - first + 1).fill(-1);
  spans.forEach(([bottom, top], k) => {
    if (wide[k]) {
      groupOf.fill(k, bottom - first, top - first + 1);
    }
  });
  const { maxLevels } = grid.meta;
  const { blockSize } = grid;
  const cellBins = new Int32Array(maxLevels);
  const cellGroups = new Int16Array(maxLevels);
  const weight = STACK_STRIDE ** 2;
  // 按分块取样：一格的几层地板在 data 里连着放、从低到高
  for (let base = 0; base < labels.length; base = nextSample(base, blockSize, maxLevels)) {
    if (maxLevels < 2 || grid.data[base + 1] === NAV_EMPTY) {
      continue;
    }
    let count = 0;
    for (let i = base; i < base + maxLevels && grid.data[i] !== NAV_EMPTY; i++) {
      if (mapped[labels[i]]) {
        const bin = Math.round(grid.nodeFloor(i) / BIN);
        cellBins[count] = bin;
        cellGroups[count++] = bin >= first && bin - first < groupOf.length ? groupOf[bin - first] : -1;
      }
    }
    for (let low = 0; low < count; low++) {
      const group = cellGroups[low];
      if (group === -1) {
        continue;
      }
      for (let high = low + 1; high < count; high++) {
        if (cellGroups[high] === group) {
          const above = stacked[group].get(cellBins[low]) ?? new Map<number, number>();
          stacked[group].set(cellBins[low], above);
          above.set(cellBins[high], (above.get(cellBins[high]) ?? 0) + weight);
        }
      }
    }
  }
  return stacked;
}

/**
 * 把一组里上下叠着的地面分到不同的楼层：每个空档（相邻两个参与分层的高度档之间）算切开以后有多少格在下面一半、正上方是
 * 上面一半的地面，取分开得多的（STACK_NEAR_BEST）里高差最大的空档，切在两片地面之间、不切进一片地面里；分开的够多
 * （STACK_AREA、STACK_SHARE）才切，切完两半各自再看
 */
function splitStacked(
  group: Bins,
  bins: ReadonlyMap<number, number>,
  stacked: ReadonlyMap<number, ReadonlyMap<number, number>>,
  cellArea: number
): Bins[] {
  if (group.length < 2) {
    return [group];
  }
  const bottom = group[0][0];
  const top = group[group.length - 1][0];
  // 高度档在 low～high 里的地面格数，不参与分层的楼梯、坡道也算
  const cellsIn = (low: number, high: number) => {
    let cells = 0;
    bins.forEach((count, bin) => {
      if (bin >= low && bin <= high) {
        cells += count;
      }
    });
    return cells;
  };
  // 切在 below、above 两档之间时分到两边的叠着的格数
  const across = (below: number, above: number) => {
    let cells = 0;
    stacked.forEach((highs, low) => {
      if (low >= bottom && low <= below) {
        highs.forEach((count, high) => {
          if (high >= above && high <= top) {
            cells += count;
          }
        });
      }
    });
    return cells;
  };
  const cuts = group.slice(1).map(([above], k) => ({ k, gap: above - group[k][0], cells: across(group[k][0], above) }));
  const most = Math.max(...cuts.map(({ cells }) => cells));
  const cut = cuts
    .filter(({ cells }) => cells >= most * STACK_NEAR_BEST)
    .reduce((best, candidate) => (candidate.gap > best.gap ? candidate : best));
  const lower = cellsIn(bottom, group[cut.k][0]);
  const upper = cellsIn(group[cut.k + 1][0], top);
  if (cut.cells * cellArea < STACK_AREA || cut.cells < Math.min(lower, upper) * STACK_SHARE) {
    return [group];
  }
  return [
    ...splitStacked(group.slice(0, cut.k + 1), bins, stacked, cellArea),
    ...splitStacked(group.slice(cut.k + 1), bins, stacked, cellArea)
  ];
}

/**
 * 自动分楼层（从上到下）：按高度统计能站的地面面积，成片的地面高差在 LEVEL_GAP 以内的并成一组，组里上下叠着的地面再切开
 * （splitStacked）；每层的高度范围延伸到与上下层的中点，楼梯半截画在上一层、半截画在下一层；最上、最下一层不设上、下限。
 * 名称：知道地面高度时，地面以下从上往下 -1F、-2F……，地面及以上从下往上 1F、2F……；不知道时从上往下"楼层 1、2……"
 */
export function detectLevels(grid: NavGrid, { groundHeight, names = [] }: LevelOptions = {}): readonly NavLevel[] {
  const mapped = mappedRegions(grid);
  const bins = floorBins(grid, mapped);
  const cellArea = grid.meta.cellSize ** 2;
  const minCells = Math.max(MIN_BIN_AREA / cellArea, Math.max(0, ...bins.values()) * MAJOR_BIN_RATIO);
  const groups: [number, number][][] = [];
  [...bins.entries()]
    .filter(([, cells]) => cells >= minCells)
    .toSorted((a, b) => a[0] - b[0])
    .forEach(entry => {
      const last = groups.at(-1);
      const previous = last?.at(-1);
      if (last && previous && entry[0] * BIN - previous[0] * BIN <= LEVEL_GAP) {
        last.push(entry);
      } else {
        groups.push([entry]);
      }
    });
  const stacked = stackedBins(grid, groups, mapped);
  const clusters = groups
    .flatMap((group, k) => splitStacked(group, bins, stacked[k], cellArea))
    .map((group): Cluster => {
      const [peakBin, peak] = group.reduce((best, entry) => (entry[1] > best[1] ? entry : best));
      return {
        zMin: group[0][0] * BIN,
        zMax: group[group.length - 1][0] * BIN,
        cells: group.reduce((sum, [, cells]) => sum + cells, 0),
        peak,
        height: peakBin * BIN
      };
    });
  const kept = clusters.filter(cluster => cluster.cells * cellArea >= MIN_LEVEL_AREA).toReversed();
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
    if (label && grid.componentArea(label) >= MIN_REGION_AREA && z >= level.from && z < level.to) {
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
      if (grid.data[i] === NAV_EMPTY || !label || grid.componentArea(label) < MIN_REGION_AREA) {
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
