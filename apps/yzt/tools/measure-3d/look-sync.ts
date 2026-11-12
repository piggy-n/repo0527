import type { BenchCamera } from './bench-api.ts';

// --look 的相机同步：几个窗口里用户动了哪一个，其余的跟到它的相机。只有判断，读写相机在 look.ts

// 读回来的相机和设下去的有舍入，差这么多以内算没动
const DEGREES = 1e-7;
const ZOOM = 1e-4;
const ANGLE = 1e-3;

const angleGap = (a: number, b: number) => Math.abs(((((a - b) % 360) + 540) % 360) - 180);

/** 两个相机是否相同（方位按角度比，359.9° 和 -0.1° 相同） */
export function sameCamera(a: BenchCamera, b: BenchCamera): boolean {
  return (
    Math.abs(a.center[0] - b.center[0]) <= DEGREES &&
    Math.abs(a.center[1] - b.center[1]) <= DEGREES &&
    Math.abs(a.zoom - b.zoom) <= ZOOM &&
    Math.abs(a.pitch - b.pitch) <= ANGLE &&
    angleGap(a.bearing, b.bearing) <= ANGLE
  );
}

/**
 * 跟随窗口的相机：从 from 到 to 线性插值，t 是 0～1；方位走近的那一边（350° 到 10° 经过 0°）。
 * 跟随窗口一帧一帧地走，不瞬移：瞬移之间相机是停着的，引擎会按"停下"请求、放宽，和被拖动的窗口不一样
 */
export function interpolateCamera(from: BenchCamera, to: BenchCamera, t: number): BenchCamera {
  const lerp = (a: number, b: number) => a + (b - a) * t;
  const turn = ((((to.bearing - from.bearing) % 360) + 540) % 360) - 180;
  return {
    center: [lerp(from.center[0], to.center[0]), lerp(from.center[1], to.center[1])],
    zoom: lerp(from.zoom, to.zoom),
    pitch: lerp(from.pitch, to.pitch),
    bearing: from.bearing + turn * t
  };
}

// 每一段走的时间是两次同步间隔的这么多倍：下一段到之前这一段还没走完，领头的窗口一直动时跟随的窗口不停
const SEGMENT_RATIO = 1.5;
const MIN_SEGMENT_MS = 150;
const MAX_SEGMENT_MS = 600;

/** 跟随窗口这一段走多久（毫秒）：intervalMs 是这次和上次同步之间的时间 */
export const segmentMs = (intervalMs: number): number =>
  Math.min(MAX_SEGMENT_MS, Math.max(MIN_SEGMENT_MS, intervalMs * SEGMENT_RATIO));

/**
 * 跟随中（busy）的窗口在自己走：记下的相机换成这一轮读到的，它就不会被当成用户动过。
 * busy 由页面报告（这一轮或上一轮在跟随、在重新稳定），不按 Node 的时钟估计：页面忙的时候命令会晚到
 */
export const ignoreBusy = (
  known: readonly (BenchCamera | null)[],
  current: readonly (BenchCamera | null)[],
  busy: readonly boolean[]
): (BenchCamera | null)[] => known.map((camera, index) => (busy[index] ? (current[index] ?? null) : camera));

/** 一轮同步的结果：跟谁（没有窗口被动过时为 null），要跟到的相机，哪些窗口要设成它 */
export interface SyncStep {
  readonly leader: number | null;
  readonly target: BenchCamera | null;
  readonly followers: readonly number[];
}

const others = (current: readonly (BenchCamera | null)[], target: BenchCamera, accept: (index: number) => boolean) =>
  current.flatMap((camera, index) => (accept(index) && camera !== null && !sameCamera(camera, target) ? [index] : []));

/**
 * current 是这一轮读到的各窗口的相机（还没就绪的为 null），known 是上一轮记下的（还没就绪的为 null），
 * last 是上一次跟过去的相机，driving 是页面报告的"用户在操作这个窗口"。和记下的不同就是被动过：
 * 用户在操作的窗口优先，其次是第一个，其余和它不同的都跟过去（用户在操作的不跟）；
 * 没有窗口被动过时，刚就绪的窗口跟到 last（别的窗口已经动过了）
 */
export function syncStep(
  current: readonly (BenchCamera | null)[],
  known: readonly (BenchCamera | null)[],
  last: BenchCamera | null,
  driving: readonly boolean[] = []
): SyncStep {
  const moved = (index: number) => {
    const camera = current[index];
    const before = known[index];
    return camera !== null && camera !== undefined && before !== null && before !== undefined && !sameCamera(camera, before);
  };
  const indices = current.map((_, index) => index);
  const leader = indices.find(index => driving[index] && moved(index)) ?? indices.find(moved);
  const target = leader === undefined ? undefined : current[leader];
  const free = (index: number) => !driving[index];
  if (leader !== undefined && target) {
    return { leader, target, followers: others(current, target, index => index !== leader && free(index)) };
  }
  const followers = last ? others(current, last, index => (known[index] ?? null) === null && free(index)) : [];
  return { leader: null, target: followers.length > 0 ? last : null, followers };
}
