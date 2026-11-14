import { type RoutePath, type RoutePose, smoothAngle } from './route-path';

/** 朝向、俯仰向路线方向靠近的时间常数（秒，ADR 0083 第 3 节） */
export const ROUTE_SMOOTHING = 0.4;
// 转头最快每秒多少度；朝向比路线的方向偏 SLOW_FROM 度以上开始放慢，再偏 SLOW_RANGE 度时只按 MIN_PACE 的速度走：
// 掉头、急弯处先转过来再走，不原地甩头（ADR 0156 R.5）
const MAX_TURN_RATE = 60;
const SLOW_FROM = 15;
const SLOW_RANGE = 30;
const MIN_PACE = 0.15;
// 估算按这个帧率模拟
const TIMELINE_FPS = 60;

/** 从 from 转到 to 最近的角度差（度，-180～180） */
export const angleTo = (from: number, to: number) => ((((to - from) % 360) + 540) % 360) - 180;

/**
 * 路线漫游播放时这一帧以后走到哪（米）：朝向比路线的方向偏得多时放慢（ADR 0156 R.5）。
 * heading 是相机现在的朝向（度，不含暂停时转头的偏移）；dt 秒，speed 米/秒。播放（RouteRoamer）和估算（RouteTimeline）共用
 */
export function routeAdvance(path: RoutePath, distance: number, heading: number, dt: number, speed: number): number {
  const behind = Math.abs(angleTo(heading, path.pose(distance).heading));
  const pace = Math.max(MIN_PACE, Math.min(1, 1 - (behind - SLOW_FROM) / SLOW_RANGE));
  return Math.min(path.total, distance + dt * speed * pace);
}

/** 相机这一帧以后的朝向、俯仰（度）：平滑地转向 pose 的方向，转头限速（ADR 0083 第 3 节、ADR 0156 R.5） */
export function routeTurn(
  pose: RoutePose,
  heading: number,
  pitch: number,
  dt: number
): { readonly heading: number; readonly pitch: number } {
  const turn = angleTo(heading, smoothAngle(heading, pose.heading, dt, ROUTE_SMOOTHING));
  const limit = MAX_TURN_RATE * dt;
  return {
    heading: (heading + Math.max(-limit, Math.min(limit, turn)) + 360) % 360,
    pitch: pitch + (pose.pitch - pitch) * (1 - Math.exp(-dt / ROUTE_SMOOTHING))
  };
}

/**
 * 按播放的规则（routeAdvance、routeTurn）走这条路线要多久（ADR 0156 R.5，补充 ADR 0083 的"剩余时间按长度和速度算"）：
 * 从起点、朝着路线的方向，按 60 帧/秒模拟一遍，记下每一帧走到的米数。暂停时转过头、继续后转回来的那一两秒不算在内
 */
export class RouteTimeline {
  /** 走完全程的秒数 */
  readonly total: number;
  // 第 k 帧以后走到的米数（第 0 个是起点）
  readonly #distances: number[] = [0];

  constructor(path: RoutePath, speed: number) {
    if (!(speed > 0)) {
      throw new Error(`漫游速度不是正数：${speed}`);
    }
    const dt = 1 / TIMELINE_FPS;
    let distance = 0;
    let { heading, pitch } = path.pose(0);
    // 最慢按 MIN_PACE 走，多给 10 秒转身
    const limit = Math.ceil((path.total / (speed * MIN_PACE) + 10) * TIMELINE_FPS);
    while (distance < path.total && this.#distances.length <= limit) {
      distance = routeAdvance(path, distance, heading, dt, speed);
      this.#distances.push(distance);
      ({ heading, pitch } = routeTurn(path.pose(distance), heading, pitch, dt));
    }
    this.total = (this.#distances.length - 1) * dt;
  }

  /** 从 distance 米（路线上走过的三维长度）走到终点还要多少秒：按走到这里的那一帧插值 */
  remaining(distance: number): number {
    const distances = this.#distances;
    if (distance <= 0) {
      return this.total;
    }
    // 第一个走到 distance 的帧
    let low = 0;
    let high = distances.length - 1;
    if ((distances[high] ?? 0) <= distance) {
      return 0;
    }
    while (high - low > 1) {
      const middle = (low + high) >> 1;
      if ((distances[middle] ?? 0) < distance) {
        low = middle;
      } else {
        high = middle;
      }
    }
    const from = distances[low] ?? 0;
    const to = distances[high] ?? from;
    const frames = low + (to > from ? (distance - from) / (to - from) : 1);
    return Math.max(0, this.total - frames / TIMELINE_FPS);
  }
}
