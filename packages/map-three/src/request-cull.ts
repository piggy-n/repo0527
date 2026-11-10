// 动着的时候不请求（docs/modules/map-three.md"动着的时候不请求"）：相机在一块瓦片加载完之前走的路达到瓦片的直径，就不请求它
type Position = readonly [number, number, number];

/** 窗口：固定的秒数，或者 'auto' 按实测的加载时间 */
export type CullWindow = number | 'auto';

// 很小的瓦片直径按这么多米算：相机几乎不动时照样请求
const MIN_DIAMETER_METERS = 1;
// 速度的平滑：时间常数（毫秒）
const SMOOTH_MS = 100;
// 一帧走的路不到这么多米算停下了：停下的那一帧起全部请求，不等平滑的速度降下来
const STILL_METERS = 0.001;
// 按实测时窗口的范围（秒），和还没有实测时用的值（同 Cesium：60 帧的路）
const MIN_WINDOW_SECONDS = 0.2;
const MAX_WINDOW_SECONDS = 2;
const INITIAL_WINDOW_SECONDS = 1;
// 加载时间取最近这么多块的中位数，个别卡住的请求不带偏；不到 MIN_SAMPLES 块时用初始值
const SAMPLES = 32;
const MIN_SAMPLES = 3;

/** 相机这一路的速度，和由它决定的不请求哪些瓦片；每帧选瓦片之前 update 一次 */
export class RequestCull {
  readonly #window: CullWindow;
  #position: Position | null = null;
  #at = 0;
  // 米/秒；第一帧还不知道相机动不动，是无穷大
  #speed = 0;
  #still = false;
  // 动着时请求的瓦片从请求到能画用的毫秒数：环形缓冲
  readonly #samples: number[] = [];
  #nextSample = 0;
  #windowSeconds: number;

  constructor(window: CullWindow) {
    this.#window = window;
    this.#windowSeconds = window === 'auto' ? INITIAL_WINDOW_SECONDS : window;
  }

  /** 现在用的窗口（秒） */
  get windowSeconds(): number {
    return this.#windowSeconds;
  }

  /** 相机在动：这时请求的瓦片要记加载时间 */
  get moving(): boolean {
    return this.#position !== null && !this.#still;
  }

  update(position: Position, nowMs: number): void {
    this.#windowSeconds = this.#measuredWindow();
    const last = this.#position;
    if (!last) {
      this.#position = position;
      this.#at = nowMs;
      this.#speed = Number.POSITIVE_INFINITY;
      return;
    }
    const elapsedMs = nowMs - this.#at;
    if (elapsedMs <= 0) {
      return;
    }
    const meters = Math.hypot(position[0] - last[0], position[1] - last[1], position[2] - last[2]);
    const current = meters / (elapsedMs / 1000);
    this.#still = meters < STILL_METERS;
    this.#speed = Number.isFinite(this.#speed)
      ? this.#speed + (current - this.#speed) * (1 - Math.exp(-elapsedMs / SMOOTH_MS))
      : current;
    this.#position = position;
    this.#at = nowMs;
  }

  /** 一块相机动着时请求的瓦片能画了：从请求到这时用了 ms 毫秒。窗口按它们的中位数算，下一帧生效 */
  recordLoad(ms: number): void {
    if (this.#samples.length < SAMPLES) {
      this.#samples.push(ms);
    } else {
      this.#samples[this.#nextSample] = ms;
      this.#nextSample = (this.#nextSample + 1) % SAMPLES;
    }
  }

  culls(radiusMeters: number): boolean {
    if (this.#still) {
      return false;
    }
    return this.#speed * this.#windowSeconds >= Math.max(radiusMeters * 2, MIN_DIAMETER_METERS);
  }

  #measuredWindow(): number {
    if (this.#window !== 'auto') {
      return this.#window;
    }
    if (this.#samples.length < MIN_SAMPLES) {
      return INITIAL_WINDOW_SECONDS;
    }
    const sorted = this.#samples.toSorted((a, b) => a - b);
    const middle = sorted.length >> 1;
    const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    return Math.min(MAX_WINDOW_SECONDS, Math.max(MIN_WINDOW_SECONDS, median / 1000));
  }
}
