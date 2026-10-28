// 按区域着色的平面图（ADR 0085 第 5 节）：正北朝上，区域按面积分配颜色、同一层不重复，同一区域按高度渐变
import { MIN_REGION_CELLS, type NavLevel, nodeOnLevel } from './levels';
import { NAV_EMPTY } from './nav-data';
import type { NavGrid } from './nav-grid';

export type Rgb = readonly [number, number, number];

/** 区域的颜色：从这个区域最低的地板到最高的地板渐变 */
export interface RegionColor {
  readonly low: Rgb;
  readonly high: Rgb;
}

/** 默认调色板，按面积从大到小分配（docs/design/color-and-typography.md 的"导航网格平面图"） */
export const DEFAULT_REGION_PALETTE: readonly RegionColor[] = [
  { low: [250, 225, 120], high: [235, 150, 90] },
  { low: [150, 170, 235], high: [200, 160, 235] },
  { low: [150, 215, 170], high: [80, 170, 140] },
  { low: [245, 180, 195], high: [215, 120, 165] },
  { low: [140, 210, 230], high: [80, 150, 205] },
  { low: [205, 225, 140], high: [160, 190, 90] },
  { low: [235, 200, 160], high: [200, 150, 110] },
  { low: [200, 180, 240], high: [150, 130, 215] },
  { low: [150, 225, 215], high: [90, 190, 185] },
  { low: [245, 190, 160], high: [220, 135, 110] }
];
/** 分不到颜色的区域、小区域 */
export const MINOR_REGION_COLOR: Rgb = [222, 228, 236];
/** 有地板但人站不下：贴墙半个身位、闸机、栏杆 */
export const OBSTACLE_COLOR: Rgb = [150, 150, 150];
/** 面积不小于这么多平方米的区域才分配调色板里的颜色 */
const MAJOR_AREA = 100;

/** 一个区域：格数、地板的高度范围、各层的格数 */
export interface RegionInfo {
  readonly id: number;
  readonly cells: number;
  readonly zMin: number;
  readonly zMax: number;
  /** 楼层序号 → 这一层的格数 */
  readonly levelCells: ReadonlyMap<number, number>;
  /** 调色板里的颜色，分不到时为 null */
  readonly color: RegionColor | null;
}

/** 整个网格的着色方案，按楼层分好 */
export interface RegionPlan {
  readonly regions: ReadonlyMap<number, RegionInfo>;
  readonly cellArea: number;
}

interface RegionDraft {
  cells: number;
  zMin: number;
  zMax: number;
  levelCells: Map<number, number>;
}

/** 统计各区域并分配颜色：面积从大到小，跳过同一层其他区域已用的颜色 */
export function planRegions(
  grid: NavGrid,
  levels: readonly NavLevel[],
  palette: readonly RegionColor[] = DEFAULT_REGION_PALETTE
): RegionPlan {
  const drafts = new Map<number, RegionDraft>();
  const { data } = grid;
  for (let i = 0; i < data.length; i++) {
    const id = data[i] === NAV_EMPTY ? 0 : grid.componentOf(i);
    if (!id || grid.componentSize(id) < MIN_REGION_CELLS) {
      continue;
    }
    const z = grid.nodeFloor(i);
    let draft = drafts.get(id);
    if (!draft) {
      draft = { cells: 0, zMin: z, zMax: z, levelCells: new Map() };
      drafts.set(id, draft);
    }
    draft.cells++;
    draft.zMin = Math.min(draft.zMin, z);
    draft.zMax = Math.max(draft.zMax, z);
    const level = levels.find(item => z >= item.from && z < item.to);
    if (level) {
      draft.levelCells.set(level.index, (draft.levelCells.get(level.index) ?? 0) + 1);
    }
  }
  const cellArea = grid.meta.cellSize ** 2;
  const colors = new Map<number, number>();
  const ordered = [...drafts.entries()].toSorted((a, b) => b[1].cells - a[1].cells || a[0] - b[0]);
  for (const [id, draft] of ordered) {
    if (draft.cells * cellArea < MAJOR_AREA) {
      continue;
    }
    const used = new Set<number>();
    for (const [otherId, other] of drafts) {
      const shared = [...draft.levelCells.keys()].some(level => other.levelCells.has(level));
      const color = colors.get(otherId);
      if (shared && color !== undefined) {
        used.add(color);
      }
    }
    const free = palette.findIndex((_, index) => !used.has(index));
    if (free !== -1) {
      colors.set(id, free);
    }
  }
  const regions = new Map<number, RegionInfo>();
  for (const [id, draft] of ordered) {
    const color = colors.get(id);
    regions.set(id, { id, ...draft, color: color === undefined ? null : palette[color] });
  }
  return { regions, cellArea };
}

/** 区域在高度 z 的颜色 */
export function regionColorAt(region: RegionInfo, z: number): Rgb {
  if (!region.color) {
    return MINOR_REGION_COLOR;
  }
  const { low, high } = region.color;
  const t = region.zMax > region.zMin ? (z - region.zMin) / (region.zMax - region.zMin) : 0;
  return [
    Math.round(low[0] + (high[0] - low[0]) * t),
    Math.round(low[1] + (high[1] - low[1]) * t),
    Math.round(low[2] + (high[2] - low[2]) * t)
  ];
}

/** 图上的一块：左上角在正北朝上的平面里的坐标（米，原点同局部系），每像素多少米 */
export interface FloorMapView {
  readonly left: number;
  readonly top: number;
  readonly res: number;
  /** 局部 y 轴的方位角（度，navigationFrame 的 north） */
  readonly north: number;
}

/** 画布的像素，同 ImageData */
export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

/** 平面 (east, north) → 局部系 (x, y) */
export function planeToLocal(east: number, north: number, bearing: number): [number, number] {
  const theta = (bearing * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return [east * cos - north * sin, east * sin + north * cos];
}

/** 局部系 (x, y) → 平面 (east, north) */
export function localToPlane(x: number, y: number, bearing: number): [number, number] {
  const theta = (bearing * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return [x * cos + y * sin, -x * sin + y * cos];
}

// 格子在这一层上不能站、但有台阶内的室内地板：小区域是中性色，人站不下是灰色
function blockedColor(grid: NavGrid, base: number, level: NavLevel): Rgb | null {
  for (let i = 0; i < grid.meta.maxLevels && grid.data[base + i] !== NAV_EMPTY; i++) {
    const z = grid.nodeFloor(base + i);
    if (z >= level.from && z < level.to && grid.nodeCovered(base + i)) {
      return grid.componentOf(base + i) ? MINOR_REGION_COLOR : OBSTACLE_COLOR;
    }
  }
  return null;
}

/** 把这一层画进 image：区域按着色方案，人站不下的灰色，其他透明；第 0 行在最北边 */
export function renderFloorMap(
  grid: NavGrid,
  plan: RegionPlan,
  level: NavLevel,
  image: RgbaImage,
  { left, top, res, north }: FloorMapView
): void {
  const { minX, minY, cellSize } = grid.meta;
  const { width, height, data } = image;
  for (let row = 0; row < height; row++) {
    const n = top - (row + 0.5) * res;
    for (let col = 0; col < width; col++) {
      const [x, y] = planeToLocal(left + (col + 0.5) * res, n, north);
      const cx = Math.floor((x - minX) / cellSize);
      const cy = Math.floor((y - minY) / cellSize);
      const offset = (row * width + col) * 4;
      const node = nodeOnLevel(grid, cx, cy, level);
      const region = node === -1 ? undefined : plan.regions.get(grid.componentOf(node));
      let color: Rgb | null = null;
      if (region) {
        color = regionColorAt(region, grid.nodeFloor(node));
      } else {
        const base = grid.cellBase(cx, cy);
        color = base === -1 ? null : blockedColor(grid, base, level);
      }
      if (color) {
        data[offset] = color[0];
        data[offset + 1] = color[1];
        data[offset + 2] = color[2];
        data[offset + 3] = 255;
      } else {
        data[offset + 3] = 0;
      }
    }
  }
}

/** 这一层的范围在正北朝上的平面里（米）：由局部系的范围四角旋转得到 */
export function planeBounds(
  bounds: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number },
  north: number
): { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number } {
  const corners = [
    localToPlane(bounds.minX, bounds.minY, north),
    localToPlane(bounds.maxX, bounds.minY, north),
    localToPlane(bounds.minX, bounds.maxY, north),
    localToPlane(bounds.maxX, bounds.maxY, north)
  ];
  return {
    left: Math.min(...corners.map(([east]) => east)),
    right: Math.max(...corners.map(([east]) => east)),
    bottom: Math.min(...corners.map(([, n]) => n)),
    top: Math.max(...corners.map(([, n]) => n))
  };
}

/** 图例：这一层出现的区域，按这一层的面积从大到小 */
export function levelLegend(
  plan: RegionPlan,
  level: NavLevel
): readonly { readonly region: RegionInfo; readonly area: number }[] {
  return [...plan.regions.values()]
    .map(region => ({ region, area: (region.levelCells.get(level.index) ?? 0) * plan.cellArea }))
    .filter(({ area }) => area > 0)
    .toSorted((a, b) => b.area - a.area);
}
