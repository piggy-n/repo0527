import { EYE_HEIGHT } from '../route-path';
import type { Point3 } from './nav-frame';
import type { NavGrid, NavPoint } from './nav-grid';
import { findSpawn } from './spawn';

/** 步行速度的档位（米/秒），面板上逐档调 */
export const WALK_SPEEDS: readonly number[] = [0.5, 1, 1.6, 2.5, 4, 6, 8];
export const DEFAULT_WALK_SPEED = 1.6;
/** 键盘行走、转向用到的键（KeyboardEvent.code） */
export const WALK_KEYS: ReadonlySet<string> = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight'
]);

// 视点相对"地板 + 眼高"允许的偏差：上楼时平滑跟随会滞后，不夹住的话快速上扶梯时相机会切进台阶；
// 上限不超过净空（1.8 米）减去近裁剪距离，不会顶进低矮的顶板
const EYE_LAG_BELOW = 0.4;
const EYE_LAG_ABOVE = 0.15;
const EYE_FOLLOW = 12;
const MAX_PITCH = (80 * Math.PI) / 180;
// 每挪 0.1 米（半格）做一次碰撞，不会一步跨过一格
const SUBSTEP = 0.1;
// 前方被挡时依次尝试偏转这些角度（弧度），斜墙也能顺着滑过去
const SLIDE_ANGLES = [0, 0.5, -0.5, 1, -1];
// 走不到的（隔着闸机、栏杆）：同一层、离得近、中间只隔一小段站不住的地方，并且视点高度没东西挡着，
// 就直线滑过去（闸机柜体顺着通道方向就有 1.5～2 米长）；否则闪切
const THROUGH_MAX_DISTANCE = 10;
const THROUGH_MAX_BLOCKED = 3;
const THROUGH_MAX_RISE = 0.5;
// 点击移动寻路最多展开这么多节点（约 25 万格的范围），同一区域里再远也够用；万一不够就闪切
const PATH_MAX_NODES = 1_500_000;
// 小于这么多格（100 平方米）的区域：脱困不去（电梯轿厢之类）；和脚下不在同一高度的，点击也不去（闸机、设备柜的顶面）
const MIN_REGION = 2500;
const UNSTUCK_RADIUS = 30;
// "开阔"：周围这么大范围内都能站人
const OPEN_RADIUS = 0.6;
// 进站时的出生点：相机贴近地面（椭球面以上不到这么高）时，从画布中心对着的地方下去
const NEAR_GROUND = 200;

/** 站的位置和朝向：yaw 是局部系里的偏航（弧度，从局部 y 轴顺时针） */
export interface WalkPose extends NavPoint {
  readonly yaw: number;
}

/** 沿点击移动的路径走一段的结果 */
export type RouteStep = 'moving' | 'arrived' | 'blocked';

interface WalkRoute {
  readonly points: readonly NavPoint[];
  index: number;
  readonly length: number;
  travelled: number;
  // 穿过闸机的直线：本来就要穿过一小段站不住的地方，不做碰撞，地板高度按走过的比例过渡
  readonly through: boolean;
  readonly fromFloor: number;
}

function pathLength(points: readonly NavPoint[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return length;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** 清单的朝向（度，正北为 0、顺时针）换成局部系的偏航（弧度）；north 是局部 y 轴的方位角 */
export function headingToYaw(heading: number, north: number): number {
  return ((heading - north) * Math.PI) / 180;
}

/** 局部系的偏航换成方位角（度，0～360） */
export function yawToHeading(yaw: number, north: number): number {
  return ((((yaw * 180) / Math.PI + north) % 360) + 360) % 360;
}

/** 按下的键换成行走的方向：W/S、↑/↓ 前后，A/D 左右平移，←/→ 转向；都是 -1、0 或 1 */
export function walkAxes(keys: ReadonlySet<string>): { forward: number; strafe: number; turn: number } {
  const axis = (positive: readonly string[], negative: readonly string[]) =>
    (positive.some(code => keys.has(code)) ? 1 : 0) - (negative.some(code => keys.has(code)) ? 1 : 0);
  return {
    forward: axis(['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']),
    strafe: axis(['KeyD'], ['KeyA']),
    turn: axis(['ArrowRight'], ['ArrowLeft'])
  };
}

/**
 * 第一人称的步行者（ADR 0086 第 3 节）：在导航网格的局部系里，持有脚下的位置、视点高度和朝向。
 * 键盘行走和点击移动都按 moveFloor 逐段碰撞：墙、柱子、站台边缘挡住，楼梯按每格地板高度逐级爬升
 */
export class Walker {
  readonly grid: NavGrid;
  #x = 0;
  #y = 0;
  #floor = 0;
  #eye = 0;
  #yaw = 0;
  #pitch = 0;
  #route: WalkRoute | null = null;

  constructor(grid: NavGrid, pose: WalkPose) {
    this.grid = grid;
    this.placeAt(pose);
    this.#yaw = pose.yaw;
  }

  get position(): NavPoint {
    return { x: this.#x, y: this.#y, floor: this.#floor };
  }

  /** 视点在局部系里的高度 */
  get eye(): number {
    return this.#eye;
  }

  get yaw(): number {
    return this.#yaw;
  }

  get pitch(): number {
    return this.#pitch;
  }

  /** 点击移动的终点；没在沿路径走时为 null */
  get destination(): NavPoint | null {
    const route = this.#route;
    return route ? route.points[route.points.length - 1] : null;
  }

  /** 直接站到这里（出生点、脱困、闪切），视点随即到位；打断点击移动 */
  placeAt({ x, y, floor }: NavPoint): void {
    this.#route = null;
    this.#x = x;
    this.#y = y;
    this.#floor = floor;
    this.#eye = floor + EYE_HEIGHT;
  }

  /** 设朝向：俯仰限制在 ±80° */
  look(yaw: number, pitch: number): void {
    this.#yaw = yaw;
    this.#pitch = clamp(pitch, -MAX_PITCH, MAX_PITCH);
  }

  turn(yaw: number, pitch: number): void {
    this.look(this.#yaw + yaw, this.#pitch + pitch);
  }

  /** 键盘行走：forward、strafe 按 walkAxes，挪 distance 米；被挡时顺着墙滑，滑不动就停下。返回是否挪动了 */
  walk(forward: number, strafe: number, distance: number): boolean {
    if (forward === 0 && strafe === 0) {
      return false;
    }
    this.#route = null;
    const sin = Math.sin(this.#yaw);
    const cos = Math.cos(this.#yaw);
    const dx = forward * sin + strafe * cos;
    const dy = forward * cos - strafe * sin;
    const length = Math.hypot(dx, dy);
    let moved = false;
    for (let remaining = distance; remaining > 1e-6; remaining -= SUBSTEP) {
      if (!this.#stepToward(dx / length, dy / length, Math.min(SUBSTEP, remaining))) {
        break;
      }
      moved = true;
    }
    return moved;
  }

  /** 开始沿路径走（点击移动）：第一个点是当前位置 */
  startRoute(points: readonly NavPoint[], through: boolean): void {
    this.#route = { points, index: 1, length: pathLength(points), travelled: 0, through, fromFloor: this.#floor };
  }

  cancelRoute(): void {
    this.#route = null;
  }

  /** 沿路径走 distance 米：普通路径每半格做一次和步行相同的碰撞，受阻就停下；只挪位置，朝向不变 */
  follow(distance: number): RouteStep {
    const route = this.#route;
    if (!route) {
      return 'arrived';
    }
    let budget = distance;
    while (budget > 1e-6 && route.index < route.points.length) {
      const target = route.points[route.index];
      const dx = target.x - this.#x;
      const dy = target.y - this.#y;
      const gap = Math.hypot(dx, dy);
      if (gap < 1e-3) {
        route.index++;
        continue;
      }
      const step = Math.min(SUBSTEP, budget, gap);
      const x = this.#x + (dx / gap) * step;
      const y = this.#y + (dy / gap) * step;
      const floor = route.through
        ? route.fromFloor +
          (target.floor - route.fromFloor) * Math.min(1, (route.travelled + step) / Math.max(route.length, 1e-6))
        : this.grid.moveFloor(this.#x, this.#y, this.#floor, x, y);
      if (floor === null) {
        // 路径是按同一套碰撞拉直的，正常走不到这里；万一受阻就停下，不硬穿
        this.#route = null;
        return 'blocked';
      }
      this.#x = x;
      this.#y = y;
      this.#floor = floor;
      budget -= step;
      route.travelled += step;
    }
    if (route.index < route.points.length) {
      return 'moving';
    }
    if (route.through) {
      this.#floor = route.points[route.points.length - 1].floor;
    }
    this.#route = null;
    return 'arrived';
  }

  /** 视点高度平滑地跟着地板，上下楼梯不抖；返回是否还没到位 */
  settleEye(dt: number): boolean {
    const target = this.#floor + EYE_HEIGHT;
    const eased = this.#eye + (target - this.#eye) * Math.min(1, dt * EYE_FOLLOW);
    this.#eye = clamp(eased, target - EYE_LAG_BELOW, target + EYE_LAG_ABOVE);
    if (Math.abs(target - this.#eye) < 1e-3) {
      this.#eye = target;
      return false;
    }
    return true;
  }

  #stepToward(dx: number, dy: number, length: number): boolean {
    for (const angle of SLIDE_ANGLES) {
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const x = this.#x + (dx * cos - dy * sin) * length * cos;
      const y = this.#y + (dx * sin + dy * cos) * length * cos;
      const floor = this.grid.moveFloor(this.#x, this.#y, this.#floor, x, y);
      if (floor !== null) {
        this.#x = x;
        this.#y = y;
        this.#floor = floor;
        return true;
      }
    }
    return false;
  }
}

/** 点中的落点：index 是导航网格的节点；direct 是直接点在地板上，不是点墙根反推出来的 */
export interface WalkTarget extends NavPoint {
  readonly index: number;
  readonly direct: boolean;
}

/** 去不了的原因：没点到能站的地面；落点被挡住了 */
export type ClickRefusal = 'not-standable' | 'hidden';

export type ClickResolution =
  | { readonly kind: 'go'; readonly target: WalkTarget; readonly reachable: boolean }
  | { readonly kind: 'refuse'; readonly reason: ClickRefusal };

/** 从当前视点看过去，point（局部系）前面有没有不透明的东西挡着：差 tolerance 米以内算看得见 */
export type VisibilityTest = (point: Point3, tolerance: number) => boolean;

/**
 * 点击处能去哪儿（ADR 0086 第 4 节）：picked 是深度拾取到的表面（局部系），就是用户看到并点中的那个；
 * reachable 是和脚下同一区域、能走过去。点击点附近有高度差不多的地板算直接点中，否则（扶梯侧板、墙根这类竖直面）
 * 在点击点下 0.6 米到上 0.3 米之间找最近的地板，这种落点去别的区域前还要看得见，免得点墙根就穿墙。
 * 悬停光标和点击移动都用它，光标显示能去的地方点了就一定去得了
 */
export function resolveClick(walker: Walker, picked: Point3 | null, visible: VisibilityTest): ClickResolution {
  const { grid } = walker;
  const here = walker.position;
  const component = grid.componentOf(grid.standNode(here.x, here.y, here.floor));
  if (!picked) {
    return { kind: 'refuse', reason: 'not-standable' };
  }
  const [x, y, z] = picked;
  // 优先找和脚下同一区域的
  const nearest = (height: number, maxRadius: number, tolerance: number) =>
    (component !== 0 && grid.nearestWalkable(x, y, height, { maxRadius, tolerance, component })) ||
    grid.nearestWalkable(x, y, height, { maxRadius, tolerance });
  const onFloor = nearest(z, 0.8, 0.2);
  const nearby = onFloor ? null : nearest(z - 0.15, 0.6, 0.45);
  const found = onFloor ?? nearby;
  if (!found) {
    return { kind: 'refuse', reason: 'not-standable' };
  }
  const target: WalkTarget = { ...found, direct: onFloor !== null };
  const targetComponent = grid.componentOf(target.index);
  if (targetComponent === component) {
    return { kind: 'go', target, reachable: true };
  }
  if (Math.abs(target.floor - here.floor) > THROUGH_MAX_RISE && grid.componentSize(targetComponent) < MIN_REGION) {
    return { kind: 'refuse', reason: 'not-standable' };
  }
  if (!target.direct && !visible([target.x, target.y, target.floor + 0.05], 0.4)) {
    return { kind: 'refuse', reason: 'hidden' };
  }
  return { kind: 'go', target, reachable: false };
}

/** 怎么过去：沿路径走、直线穿过闸机、闪切 */
export type MovePlan =
  | { readonly kind: 'route'; readonly points: readonly NavPoint[] }
  | { readonly kind: 'through'; readonly points: readonly NavPoint[] }
  | { readonly kind: 'teleport'; readonly spot: NavPoint };

/**
 * 点中能去的地面以后怎么过去：同一区域里寻路后沿路径走；走不到的（隔着闸机、栏杆、楼板开口，或在别的楼层）
 * 同一层、离得近、中间站不住的只有一小段，并且视点高度这一段没东西挡着，就直线滑过去，否则闪切
 */
export function planMove(walker: Walker, target: WalkTarget, reachable: boolean, visible: VisibilityTest): MovePlan {
  const { grid } = walker;
  const here = walker.position;
  const spot: NavPoint = { x: target.x, y: target.y, floor: target.floor };
  if (!reachable) {
    const through =
      Math.abs(spot.floor - here.floor) <= THROUGH_MAX_RISE &&
      Math.hypot(spot.x - here.x, spot.y - here.y) <= THROUGH_MAX_DISTANCE &&
      grid.blockedLength(here, spot) <= THROUGH_MAX_BLOCKED &&
      visible([spot.x, spot.y, spot.floor + EYE_HEIGHT], 0.2);
    return through ? { kind: 'through', points: [here, spot] } : { kind: 'teleport', spot };
  }
  const path = grid.findPath(grid.standNode(here.x, here.y, here.floor), target.index, { maxNodes: PATH_MAX_NODES });
  if (!path) {
    // 同一区域按理总能找到路；寻路规模超限时兜底
    return { kind: 'teleport', spot };
  }
  // 从当前位置而不是格子中心出发
  path[0] = here;
  return { kind: 'route', points: grid.smoothPath(path) };
}

/** 脱困：当前位置本来就开阔（open）、挪到附近的开阔地面（move）、附近没有（none） */
export type UnstuckResult =
  | { readonly kind: 'open' }
  | { readonly kind: 'move'; readonly spot: NavPoint }
  | { readonly kind: 'none' };

/** 被挤在闸机通道、墙角里转不开身时：挪到附近最近的一块开阔地面（四周都能站人、所在区域足够大） */
export function unstuckSpot(walker: Walker): UnstuckResult {
  const { grid } = walker;
  const { x, y, floor } = walker.position;
  const here = grid.standNode(x, y, floor);
  if (
    here !== -1 &&
    grid.componentSize(grid.componentOf(here)) >= MIN_REGION &&
    grid.isOpen(x, y, floor, OPEN_RADIUS)
  ) {
    return { kind: 'open' };
  }
  const spot = findSpawn(
    grid,
    { x, y, z: floor },
    { mode: 'near', maxRadius: UNSTUCK_RADIUS, clearRadius: OPEN_RADIUS, minReach: MIN_REGION }
  );
  return spot ? { kind: 'move', spot } : { kind: 'none' };
}

/** 选出生点用到的相机和清单（都在局部系里） */
export interface SpawnContext {
  /** 相机的位置 */
  readonly eye: Point3;
  /** 相机在椭球面以上的高度（米） */
  readonly eyeHeight: number;
  /** 画布中心对着的地面点；没打到时为 null */
  readonly ground: Point3 | null;
  /** 相机的朝向 */
  readonly yaw: number;
  /** 清单里的出生点：脚下的地板和朝向 */
  readonly preferred: { readonly point: Point3; readonly yaw: number } | null;
  /** 地面在局部系里的高度 */
  readonly groundHeight: number;
}

/**
 * 进站的出生点（ADR 0086 第 3 节），依次：相机已经在站内地下，就落到脚下附近的地板；贴近地面、画布中心对着模型，
 * 从那里下到最上面一层室内空间；清单的出生点；模型中心附近最上面一层。找不到返回 null
 */
export function chooseSpawn(
  grid: NavGrid,
  { eye, eyeHeight, ground, yaw, preferred, groundHeight }: SpawnContext
): WalkPose | null {
  const below = groundHeight - 2;
  const [ex, ey, ez] = eye;
  if (ez < groundHeight - 1 && grid.cellOf(ex, ey)) {
    const spot = findSpawn(grid, { x: ex, y: ey, z: ez - EYE_HEIGHT }, { mode: 'near', maxRadius: 30 });
    if (spot) {
      return { ...spot, yaw };
    }
  }
  if (eyeHeight < NEAR_GROUND && ground && grid.cellOf(ground[0], ground[1])) {
    const spot = findSpawn(grid, { x: ground[0], y: ground[1], z: ground[2] }, { mode: 'top', below, maxRadius: 40 });
    if (spot) {
      return { ...spot, yaw };
    }
  }
  if (preferred) {
    const [px, py, pz] = preferred.point;
    const spot = findSpawn(grid, { x: px, y: py, z: pz }, { mode: 'near', maxRadius: 30 });
    if (spot) {
      return { ...spot, yaw: preferred.yaw };
    }
  }
  const { minX, minY, cellSize, width, height } = grid.meta;
  const center = { x: minX + (width * cellSize) / 2, y: minY + (height * cellSize) / 2, z: groundHeight };
  const spot = findSpawn(grid, center, { mode: 'top', below, maxRadius: 300 });
  return spot ? { ...spot, yaw } : null;
}
