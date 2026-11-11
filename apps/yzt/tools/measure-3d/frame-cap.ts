/**
 * 帧率封顶：测量页解除了 vsync，帧间隔长短交替，帧数也比用户的显示器多。上传预算按帧算，帧多了每秒传得也多，
 * 要看用户看到的飞行中画得多细时按真实的帧率跑（--fps 60）
 */
export class FrameCap {
  readonly #intervalMs: number;
  #next = 0;

  constructor(fps: number | null) {
    this.#intervalMs = fps === null ? 0 : 1000 / fps;
  }

  /** 这一刻能不能开始新的一帧；能的话算下一帧的时刻 */
  ready(now: number): boolean {
    if (this.#intervalMs === 0) {
      return true;
    }
    if (now < this.#next) {
      return false;
    }
    // 按目标时刻往后排，平均才是这个帧率；卡了一下以后不连续补帧，只有一帧缩短，不短于一半
    this.#next = Math.max(this.#next + this.#intervalMs, now + this.#intervalMs / 2);
    return true;
  }
}
