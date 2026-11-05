import {
  detectLevels,
  levelBounds,
  levelOf,
  localToPlane,
  type Navigation,
  type NavGrid,
  type NavLevel,
  type NavPoint,
  nearestOnLevel,
  planeBounds,
  planeToLocal,
  planRegions,
  type RegionPlan,
  renderFloorMap,
  type RgbaImage,
  type WalkPlayer
} from '@yzt/map-core';

/** 室内地图（ADR 0087）：导航网格分好的楼层和按区域的着色；north 是局部 y 轴的方位角，画图时按它旋转、正北朝上 */
export interface IndoorMap {
  readonly grid: NavGrid;
  readonly north: number;
  readonly levels: readonly NavLevel[];
  readonly plan: RegionPlan;
}

/** 地图上的人：就是视图报告的步行中的人（导航网格的局部系） */
export type MapPlayer = WalkPlayer;

/** 正北朝上的平面里的一块图：左上角在平面里的坐标（米）、每像素多少米 */
export interface PlaneRaster {
  readonly image: RgbaImage;
  readonly left: number;
  readonly top: number;
  readonly res: number;
}

/** 小地图的显示范围（边长，米），+/− 逐档切换 */
export const MINIMAP_RANGES: readonly number[] = [20, 40, 80, 160];
export const DEFAULT_MINIMAP_RANGE = 40;

// 整层底图四周留白（米）；最细 0.2 米一像素（网格精度），像素不超过 200 万，楼层太大就粗一些
const PADDING = 6;
const MIN_RES = 0.2;
const MAX_SAMPLES = 2_000_000;
// 小地图的底图边长是显示范围的 1.5 倍，人走出 1/5 才重新采样；缩小时最多 128 像素一个显示范围
const MINIMAP_MARGIN = 1.5;
const MINIMAP_RESAMPLE = 0.2;
const MINIMAP_PIXELS = 128;
// 完整地图上双击处站不了人时，在这么大范围（米）内找最近的能站位置
const PICK_RADIUS = 30;

// 楼层划分、着色和各层底图只和导航网格有关，按网格缓存，重进步行、再打开地图不用重算
const maps = new WeakMap<Navigation, IndoorMap>();
const levelRasters = new WeakMap<IndoorMap, Map<number, PlaneRaster | null>>();

/** 导航网格的室内地图：楼层按地面高度命名（-1F、-2F……），区域按面积分配颜色；没有识别出楼层时 levels 为空 */
export function indoorMapOf(navigation: Navigation): IndoorMap {
  const cached = maps.get(navigation);
  if (cached) {
    return cached;
  }
  const { grid, frame } = navigation;
  const levels = detectLevels(grid, { groundHeight: frame.ground });
  const map: IndoorMap = { grid, north: frame.north, levels, plan: planRegions(grid, levels) };
  maps.set(navigation, map);
  return map;
}

/** 人所在的楼层 */
export function playerLevel(map: IndoorMap, player: MapPlayer): NavLevel | null {
  return levelOf(map.levels, player.floor);
}

/** 局部系的点换到正北朝上的平面里 */
export function toPlane(map: IndoorMap, x: number, y: number): [east: number, north: number] {
  return localToPlane(x, y, map.north);
}

/** 人在平面里的方位角（弧度，从正北顺时针）：画布按它旋转，箭头就朝着人看的方向 */
export function planeHeading(map: IndoorMap, player: MapPlayer): number {
  return player.yaw + (map.north * Math.PI) / 180;
}

// 平面里左上角在 (left, top)、宽高（米）的一块，按 res 米一像素画这一层
function rasterOf(
  map: IndoorMap,
  level: NavLevel,
  { left, top, width, height, res }: Readonly<Record<'left' | 'top' | 'width' | 'height' | 'res', number>>
): PlaneRaster {
  const columns = Math.max(1, Math.ceil(width / res));
  const rows = Math.max(1, Math.ceil(height / res));
  const image = { width: columns, height: rows, data: new Uint8ClampedArray(columns * rows * 4) };
  renderFloorMap(map.grid, map.plan, level, image, { left, top, res, north: map.north });
  return { image, left, top, res };
}

/** 整层的底图（完整地图）：这一层地面的范围四周留 6 米；这一层没有能站的地面时为 null。第一次画后按楼层缓存 */
export function levelRaster(map: IndoorMap, level: NavLevel): PlaneRaster | null {
  let cache = levelRasters.get(map);
  if (!cache) {
    cache = new Map();
    levelRasters.set(map, cache);
  }
  if (cache.has(level.index)) {
    return cache.get(level.index) ?? null;
  }
  const bounds = levelBounds(map.grid, level);
  let raster: PlaneRaster | null = null;
  if (bounds) {
    const { left, top, right, bottom } = planeBounds(bounds, map.north);
    const width = right - left + PADDING * 2;
    const height = top - bottom + PADDING * 2;
    const res = Math.max(MIN_RES, Math.sqrt((width * height) / MAX_SAMPLES));
    raster = rasterOf(map, level, { left: left - PADDING, top: top + PADDING, width, height, res });
  }
  cache.set(level.index, raster);
  return raster;
}

/** 小地图的底图：以平面里的 center 为中心、边长是显示范围 1.5 倍；放大时 0.2 米一像素，缩小时粗一些 */
export function minimapRaster(
  map: IndoorMap,
  level: NavLevel,
  [east, north]: readonly [number, number],
  range: number
): PlaneRaster {
  const meters = range * MINIMAP_MARGIN;
  const res = Math.max(MIN_RES, range / MINIMAP_PIXELS);
  return rasterOf(map, level, { left: east - meters / 2, top: north + meters / 2, width: meters, height: meters, res });
}

/** 小地图要不要重新采样：换了楼层、显示范围，或者人离上次采样的中心超过显示范围的 1/5 */
export function minimapStale(
  sampled: { readonly level: number; readonly range: number; readonly center: readonly [number, number] } | null,
  level: NavLevel,
  range: number,
  [east, north]: readonly [number, number]
): boolean {
  return (
    !sampled ||
    sampled.level !== level.index ||
    sampled.range !== range ||
    Math.hypot(east - sampled.center[0], north - sampled.center[1]) > range * MINIMAP_RESAMPLE
  );
}

/** 完整地图上双击处：这一层 30 米内离它最近的能站位置；没有时为 null */
export function pickOnLevel(map: IndoorMap, level: NavLevel, east: number, north: number): NavPoint | null {
  const [x, y] = planeToLocal(east, north, map.north);
  const spot = nearestOnLevel(map.grid, level, x, y, PICK_RADIUS);
  return spot ? { x: spot.x, y: spot.y, floor: spot.floor } : null;
}
