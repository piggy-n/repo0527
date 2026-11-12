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
 * last 是上一次跟过去的相机。和记下的不同就是被动过：取第一个，其余和它不同的都跟过去；
 * 没有窗口被动过时，刚就绪的窗口跟到 last（别的窗口已经动过了）
 */
export function syncStep(
  current: readonly (BenchCamera | null)[],
  known: readonly (BenchCamera | null)[],
  last: BenchCamera | null
): SyncStep {
  const leader = current.findIndex((camera, index) => {
    const before = known[index];
    return camera !== null && before !== null && before !== undefined && !sameCamera(camera, before);
  });
  const moved = current[leader];
  if (leader >= 0 && moved) {
    return { leader, target: moved, followers: others(current, moved, index => index !== leader) };
  }
  const followers = last ? others(current, last, index => (known[index] ?? null) === null) : [];
  return { leader: null, target: followers.length > 0 ? last : null, followers };
}
