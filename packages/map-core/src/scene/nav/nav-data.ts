// 导航网格的存储格式与参数（ADR 0085）：主线程、Worker 共用

/**
 * 每层地板存成一个 Int16：高度按 2 厘米量化后左移一位，最低位是"头顶有遮盖"（室内）。
 * 可表示 ±327 米，足够覆盖地下空间；空位是 NAV_EMPTY
 */
export const NAV_EMPTY = -32768;
/** 1 米 = 50 个 2 厘米 */
export const HEIGHT_UNITS = 50;
/** 头顶 20 米内有几何体才算室内 */
export const COVER_RANGE = 20;
/** 稀疏存储的分块边长（格）：站外大片空白不占内存 */
export const CHUNK = 32;
/** 净空按 0.1 米量化存成 Uint8，最大 25.4 米；HEADROOM_OPEN 表示上方没有东西 */
export const HEADROOM_UNITS = 10;
export const HEADROOM_OPEN = 255;

/** 构建与行走用的参数 */
export interface NavOptions {
  /** 格子边长（米）：门洞一般 0.9 米以上，0.2 米能留出足够的可走格 */
  readonly cellSize: number;
  /** 地板上方至少要有这么高的净空才算能站人 */
  readonly agentHeight: number;
  /** 超过这个坡度的面不能站（扶梯约 30°，楼梯按踏面算） */
  readonly maxSlopeDeg: number;
  /** 合并区间时，两个顶面相差不超过这个值才互相继承"可站立" */
  readonly flagMergeThreshold: number;
  /** 每格最多记录几层地板 */
  readonly maxLevels: number;
  /** 身体半径：离墙最小距离；区域和行走碰撞用同一个值，两边判定才一致 */
  readonly agentRadius: number;
  /** 能直接跨上、跨下的高度，楼梯踏步一般 0.15～0.2 米 */
  readonly stepHeight: number;
}

export const NAV_DEFAULTS: NavOptions = {
  cellSize: 0.2,
  agentHeight: 1.8,
  maxSlopeDeg: 45,
  flagMergeThreshold: 0.2,
  maxLevels: 4,
  agentRadius: 0.3,
  stepHeight: 0.45
};

/** 网格的尺寸与统计 */
export interface NavMeta {
  readonly minX: number;
  readonly minY: number;
  readonly cellSize: number;
  readonly width: number;
  readonly height: number;
  readonly chunksX: number;
  readonly chunksY: number;
  readonly maxLevels: number;
  /** 有地板的格子数 */
  readonly floorCells: number;
  /** 超出 maxLevels 被丢掉的地板层数 */
  readonly droppedLevels: number;
}

/** 高度场：chunkIndex 是分块号 → 块号（-1 是空块），data、headroom 按块连续存放 */
export interface RawNavGrid {
  readonly meta: NavMeta;
  readonly chunkIndex: Int32Array;
  readonly data: Int16Array;
  readonly headroom: Uint8Array;
}

/** 加上区域：labels 与 data 一一对应，0 表示人站不住；sizes 是每个区域的格数（下标 0 不用） */
export interface NavGridData extends RawNavGrid {
  readonly agentRadius: number;
  readonly stepHeight: number;
  readonly labels: Uint16Array;
  readonly sizes: Uint32Array;
}
