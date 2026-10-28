import type { Point3 } from './nav-frame';
import type { NavGrid, NavPoint } from './nav-grid';
import type { Walker, WalkView } from './walker';

const DEG = Math.PI / 180;
// 俯仰的范围：第三人称比第一人称窄，不会钻到地板下仰拍；进站、回到出生点、切到第三人称时的俯仰
// （第三人称至少俯看 18°，人不挡画面中间）
const PITCH_RANGE: Readonly<Record<WalkView, readonly [number, number]>> = {
  first: [-80 * DEG, 80 * DEG],
  third: [-75 * DEG, 25 * DEG]
};
const START_PITCH: Readonly<Record<WalkView, number>> = { first: -6 * DEG, third: -18 * DEG };
// 第三人称相机离人的距离：滚轮、中键拖动在范围内调，每像素滚动量
const THIRD_DISTANCE = 4;
const MIN_DISTANCE = 1.5;
const MAX_DISTANCE = 8;
const DISTANCE_SENSITIVITY = 0.0015;
// 相机绕的点比眼睛高这么多，人落在画面中下方
const PIVOT_LIFT = 0.25;
// 弹簧臂逐段检查的步长（半格）；相机离墙、地板、顶板至少这么远，近裁剪面不会切进去；挡的东西过去后臂放回去的快慢
const ARM_STEP = 0.1;
const ARM_CLEARANCE = 0.25;
const ARM_EASE = 6;
// 相机离人从这么近到这么远，人从全透明到不透明
const FADE_NEAR = 0.6;
const FADE_FAR = 1.4;
// 第三人称里人转向行进方向的速度（每秒）
const BODY_TURN_SPEED = 540 * DEG;
// 一帧挪了 1 米以上是闪切，不算走路
const TELEPORT_STEP = 1;
// 人物（连同摆动的手臂）占的范围：拾取点落在里面算点在人身上；穿过人物后沿视线逐段找表面的步长、最远找多远（米）
const AVATAR_RADIUS = 0.5;
const AVATAR_HEIGHT = 1.9;
const SEE_THROUGH_STEP = 0.05;
const SEE_THROUGH_MAX = 60;
// 步态：一个动画周期（左右各迈一步）前进的距离（米）；两腿交错的时刻每半个周期一次，从 0.25 开始；
// 停下后把这一步走完的快慢（周期/秒）
const STRIDE = 1.5;
const PASSING_PHASE = 0.25;
const SETTLE_SPEED = 1.5;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

// 换到 (-π, π]
const wrapAngle = (angle: number) => angle - 2 * Math.PI * Math.ceil((angle - Math.PI) / (2 * Math.PI));

/** 进站、回到出生点时的俯仰 */
export function startPitch(view: WalkView): number {
  return START_PITCH[view];
}

/**
 * 步行的相机挂法（ADR 0090 第 2 节）：第一人称相机就在眼睛上；第三人称挂在绕点（头顶略高处）后方的弹簧臂上，
 * 臂碰到墙、柱子、顶板就缩短，人朝走的方向限速转身，相机贴近时人淡出。第一人称就是臂长为 0，切换人称时相机沿臂滑出、收回
 */
export class WalkRig {
  readonly #walker: Walker;
  #view: WalkView;
  #arm = 0;
  #distance = THIRD_DISTANCE;
  #bodyYaw: number;
  #settling = false;

  /** 臂从 0 开始：进站时相机从眼睛处拉出去 */
  constructor(walker: Walker, view: WalkView) {
    this.#walker = walker;
    this.#view = view;
    this.#bodyYaw = walker.yaw;
    walker.limitPitch(...PITCH_RANGE[view]);
  }

  get view(): WalkView {
    return this.#view;
  }

  /** 弹簧臂现在的长度（米）：第一人称为 0 */
  get arm(): number {
    return this.#arm;
  }

  /** 第三人称想要的臂长（米） */
  get distance(): number {
    return this.#distance;
  }

  /** 人面朝的方向（局部系的偏航） */
  get bodyYaw(): number {
    return this.#bodyYaw;
  }

  /** 人的不透明度：0 看不见（第一人称、相机贴着人），1 不透明 */
  get avatarAlpha(): number {
    return clamp((this.#arm - FADE_NEAR) / (FADE_FAR - FADE_NEAR), 0, 1);
  }

  /** 上一次 step 后臂还在伸缩 */
  get settling(): boolean {
    return this.#settling;
  }

  /** 相机的位置（局部系）：绕点沿视线反方向 arm 米；第一人称就是眼睛 */
  get eye(): Point3 {
    const walker = this.#walker;
    const { x, y } = walker.position;
    const { yaw, pitch } = walker;
    const arm = this.#arm;
    const flat = Math.cos(pitch) * arm;
    return [
      x - Math.sin(yaw) * flat,
      y - Math.cos(yaw) * flat,
      walker.eye + PIVOT_LIFT * Math.min(1, arm) - Math.sin(pitch) * arm
    ];
  }

  /** 换人称：俯仰换成这个人称的范围；切到第三人称时人面朝刚才看的方向，至少俯看 18° */
  setView(view: WalkView): void {
    if (view === this.#view) {
      return;
    }
    const walker = this.#walker;
    this.#view = view;
    walker.limitPitch(...PITCH_RANGE[view]);
    if (view === 'third') {
      this.#bodyYaw = walker.yaw;
      walker.look(walker.yaw, Math.min(walker.pitch, START_PITCH.third));
    }
  }

  /** 调第三人称的远近：pixels 是滚轮或中键拖动的像素，往下为正（拉远）；第一人称不管 */
  zoom(pixels: number): void {
    if (this.#view === 'third') {
      this.#distance = clamp(this.#distance * Math.exp(pixels * DISTANCE_SENSITIVITY), MIN_DISTANCE, MAX_DISTANCE);
    }
  }

  /** 回到出生点、闪切后：人面朝视线方向 */
  faceView(): void {
    this.#bodyYaw = this.#walker.yaw;
  }

  /**
   * 每帧（人挪过以后）：from 是这一帧开始时脚下的位置。第一人称人面朝视线方向，第三人称走动时限速转向行进方向
   * （往后走会转过身来）；弹簧臂被挡时立即缩短，挡的东西过去了再慢慢放回去。返回这一帧走过的距离，闪切不算
   */
  step(from: NavPoint, dt: number): number {
    const { x, y } = this.#walker.position;
    const dx = x - from.x;
    const dy = y - from.y;
    const length = Math.hypot(dx, dy);
    const moved = length < TELEPORT_STEP ? length : 0;
    if (this.#view === 'first') {
      this.#bodyYaw = this.#walker.yaw;
    } else if (moved > 1e-4) {
      const turn = wrapAngle(Math.atan2(dx, dy) - this.#bodyYaw);
      const limit = BODY_TURN_SPEED * dt;
      this.#bodyYaw = wrapAngle(this.#bodyYaw + clamp(turn, -limit, limit));
    }
    this.#stretchArm(dt);
    return moved;
  }

  #stretchArm(dt: number): void {
    const want = this.#view === 'third' ? this.#distance : 0;
    if (want === 0 && this.#arm === 0) {
      this.#settling = false;
      return;
    }
    // 切回第一人称时臂也是慢慢收回，收的过程中照样防穿模
    const reach = this.#reach(Math.max(want, this.#arm));
    const target = Math.min(want, reach);
    if (reach < this.#arm) {
      this.#arm = reach;
    } else {
      this.#arm += (target - this.#arm) * Math.min(1, dt * ARM_EASE);
    }
    if (Math.abs(target - this.#arm) < (want === 0 ? 0.02 : 1e-3)) {
      this.#arm = target;
    }
    this.#settling = this.#arm !== target;
  }

  // 从绕点沿视线反方向每半格检查一次，碰到墙、柱子、顶板、地板（导航网格的净空，四周留出余量）就停在它前面；不超过 length
  #reach(length: number): number {
    const walker = this.#walker;
    const { grid } = walker;
    const { x, y } = walker.position;
    const { yaw, pitch } = walker;
    const [bx, by, bz] = [-Math.sin(yaw) * Math.cos(pitch), -Math.cos(yaw) * Math.cos(pitch), -Math.sin(pitch)];
    const z0 = walker.eye + PIVOT_LIFT;
    const r = ARM_CLEARANCE;
    const clear = (px: number, py: number, pz: number) =>
      grid.isFree(px, py, pz, r) &&
      grid.isFree(px + r, py, pz, r) &&
      grid.isFree(px - r, py, pz, r) &&
      grid.isFree(px, py + r, pz, r) &&
      grid.isFree(px, py - r, pz, r);
    for (let s = ARM_STEP; s <= length + 1e-6; s += ARM_STEP) {
      if (!clear(x + bx * s, y + by * s, z0 + bz * s)) {
        return s - ARM_STEP;
      }
    }
    return length;
  }
}

/**
 * 第三人称里人就挡在正前方的地面上，深度拾取拿到的是人身上的点（ADR 0090 第 2 节）：拾取点落在人身上时，
 * 从相机 camera 顺着视线穿过人物，在导航网格里逐段往前找第一个不是空处的地方（地板、墙、柱子），就是被人挡住的表面。
 * 不在人身上原样返回，穿过去一直没碰到东西返回 null；都是局部系的点
 */
export function seeThroughAvatar(grid: NavGrid, feet: NavPoint, camera: Point3, picked: Point3): Point3 | null {
  const [px, py, pz] = picked;
  if (
    Math.hypot(px - feet.x, py - feet.y) > AVATAR_RADIUS ||
    pz < feet.floor + 0.05 ||
    pz > feet.floor + AVATAR_HEIGHT
  ) {
    return picked;
  }
  const [dx, dy, dz] = [px - camera[0], py - camera[1], pz - camera[2]];
  const length = Math.hypot(dx, dy, dz);
  if (length < 1e-6) {
    return null;
  }
  for (let s = SEE_THROUGH_STEP; s <= SEE_THROUGH_MAX; s += SEE_THROUGH_STEP) {
    const point: Point3 = [px + (dx / length) * s, py + (dy / length) * s, pz + (dz / length) * s];
    if (!grid.isFree(...point)) {
      return point;
    }
  }
  return null;
}

/**
 * 人物的步态（ADR 0090 第 2 节）：行走动画的相位按走过的距离推进，走多快腿就迈多快，脚下不打滑；
 * 模型只有行走动画，停下时先把这一步走完（到两腿交错的时刻）再站定，不定格在跨步中间
 */
export class WalkCycle {
  #phase = 0;
  #walking = false;

  /** 动画相位（周期数） */
  get phase(): number {
    return this.#phase;
  }

  /** 在放行走动画：走着，或者在把这一步走完 */
  get walking(): boolean {
    return this.#walking;
  }

  /** 每帧：moved 是这一帧走过的距离（米）；返回是否还在放行走动画 */
  advance(moved: number, dt: number): boolean {
    if (moved > 1e-4) {
      this.#phase += moved / STRIDE;
      this.#walking = true;
      return true;
    }
    if (!this.#walking) {
      return false;
    }
    const passing = Math.ceil((this.#phase - PASSING_PHASE) * 2 - 1e-6) / 2 + PASSING_PHASE;
    this.#phase = Math.min(passing, this.#phase + SETTLE_SPEED * dt);
    if (this.#phase >= passing - 1e-6) {
      this.#walking = false;
    }
    return this.#walking;
  }
}
