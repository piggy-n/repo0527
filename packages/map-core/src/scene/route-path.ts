import type { RoutePoint } from './scene-content-model';

/** 眼高：视点在脚下地板上方的米数（ADR 0083 第 1 节） */
export const EYE_HEIGHT = 1.6;
// 朝向看前方这么远的点；俯仰不超过这么多度
const LOOK_AHEAD = 4;
const MAX_PITCH = 30;
// WGS84：长半轴、第一偏心率的平方
const A = 6378137;
const E2 = 0.00669437999014;

/** 路线上一点的视点：视点的椭球高，朝向（度，正北为 0、顺时针），俯仰（度，向下为负） */
export interface RoutePose {
  readonly lng: number;
  readonly lat: number;
  readonly height: number;
  readonly heading: number;
  readonly pitch: number;
}

interface LocalPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

const toDegrees = (radians: number) => (radians * 180) / Math.PI;

/**
 * 路线的几何（ADR 0083 第 3 节）：按起点的切平面把经纬度换成米（站内几百米，误差在厘米以下），
 * 累计三维长度（楼梯的高差也算）；走过的距离换成视点，朝向看前方 4 米的点
 */
export class RoutePath {
  /** 总长，米 */
  readonly total: number;
  readonly #lng0: number;
  readonly #lat0: number;
  readonly #metersPerLng: number;
  readonly #metersPerLat: number;
  readonly #points: readonly LocalPoint[];
  readonly #cumulative: readonly number[];

  constructor(path: readonly RoutePoint[]) {
    const [first] = path;
    if (!first || path.length < 2) {
      throw new Error('路线至少要有两个点');
    }
    const [lng0, lat0] = first;
    const phi = (lat0 * Math.PI) / 180;
    const sin2 = Math.sin(phi) ** 2;
    // 卯酉圈和子午圈的曲率半径
    const n = A / Math.sqrt(1 - E2 * sin2);
    const m = (A * (1 - E2)) / (1 - E2 * sin2) ** 1.5;
    this.#lng0 = lng0;
    this.#lat0 = lat0;
    this.#metersPerLng = (n * Math.cos(phi) * Math.PI) / 180;
    this.#metersPerLat = (m * Math.PI) / 180;
    this.#points = path.map(([lng, lat, floor]) => ({
      x: (lng - lng0) * this.#metersPerLng,
      y: (lat - lat0) * this.#metersPerLat,
      z: floor
    }));
    const cumulative = [0];
    for (let i = 1; i < this.#points.length; i++) {
      const a = this.#points[i - 1];
      const b = this.#points[i];
      const step = a && b ? Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) : 0;
      cumulative.push((cumulative[i - 1] ?? 0) + step);
    }
    this.#cumulative = cumulative;
    this.total = cumulative[cumulative.length - 1] ?? 0;
  }

  /** 走过 distance 米时的视点；超出 0～total 时按两端算 */
  pose(distance: number): RoutePose {
    const at = Math.min(Math.max(distance, 0), this.total);
    const here = this.#at(at);
    const ahead = this.#at(Math.min(at + LOOK_AHEAD, this.total));
    let dx = ahead.x - here.x;
    let dy = ahead.y - here.y;
    let dz = ahead.z - here.z;
    // 快到终点时前方没有路了：按最后一段的方向
    if (Math.hypot(dx, dy) < 0.5) {
      const last = this.#points[this.#points.length - 1];
      const before = this.#lastDistinct();
      dx = (last?.x ?? 0) - before.x;
      dy = (last?.y ?? 0) - before.y;
      dz = 0;
    }
    const pitch = toDegrees(Math.atan2(dz, Math.hypot(dx, dy)));
    return {
      lng: this.#lng0 + here.x / this.#metersPerLng,
      lat: this.#lat0 + here.y / this.#metersPerLat,
      height: here.z + EYE_HEIGHT,
      heading: (toDegrees(Math.atan2(dx, dy)) + 360) % 360,
      pitch: Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch))
    };
  }

  #at(distance: number): LocalPoint {
    const cumulative = this.#cumulative;
    let index = 1;
    while (index < cumulative.length - 1 && (cumulative[index] ?? 0) < distance) {
      index++;
    }
    const a = this.#points[index - 1];
    const b = this.#points[index];
    if (!a || !b) {
      throw new Error('路线没有点');
    }
    const start = cumulative[index - 1] ?? 0;
    const length = (cumulative[index] ?? 0) - start;
    const t = length > 0 ? (distance - start) / length : 0;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
  }

  // 最后一个和终点不重合的点
  #lastDistinct(): LocalPoint {
    const points = this.#points;
    const last = points[points.length - 1];
    for (let i = points.length - 2; i >= 0; i--) {
      const point = points[i];
      if (point && last && Math.hypot(last.x - point.x, last.y - point.y) > 0.01) {
        return point;
      }
    }
    return points[0] ?? { x: 0, y: 0, z: 0 };
  }
}

/** 角度（度）按时间常数 tau 秒向目标靠近，走最短的方向（359° 到 1° 是 +2°） */
export function smoothAngle(current: number, target: number, dt: number, tau: number): number {
  const difference = ((((target - current) % 360) + 540) % 360) - 180;
  const t = tau > 0 ? 1 - Math.exp(-dt / tau) : 1;
  return (current + difference * t + 360) % 360;
}
