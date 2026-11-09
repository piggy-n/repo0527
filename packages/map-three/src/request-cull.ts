// 相机动得比瓦片快时不请求这块瓦片（同 Cesium 的 cullRequestsWhileMoving）：等它到了相机已经走了，白占网络和显存。
// 经开区 z16 倾斜飞一圈，不这样要加载 2125 MB，Cesium 只加载 128 MB，见 docs/modules/map-three.md"动着的时候不请求"

const MIN_DIAMETER_METERS = 1;
// 速度平滑的时间常数：相机更新和画面不在同一时刻，一帧算出的速度会抖（实测 150 米/秒时有一帧算成 54），
// 抖一下就会把看到的瓦片全请求了。相机停下后约 0.2 秒开始放行，大的瓦片先放行
const SMOOTH_MS = 100;

type Position = readonly [number, number, number];

/** 只有判断：输入每一帧的相机位置，回答这么大的瓦片现在要不要请求 */
export class RequestCull {
  readonly #windowSeconds: number;
  #position: Position | null = null;
  #at = 0;
  // 平滑后的速度（米/秒）
  #speed = 0;

  /** 相机 windowSeconds 秒走的路达到瓦片的直径就不请求 */
  constructor(windowSeconds: number) {
    this.#windowSeconds = windowSeconds;
  }

  /** 一帧的相机：位置（米，直角坐标）和时刻（毫秒） */
  update(position: Position, nowMs: number): void {
    const last = this.#position;
    if (!last) {
      // 第一帧还不知道相机动不动：先不请求，下一帧就知道了。边飞边打开模型时，不然一进来就把看到的全请求了
      this.#position = position;
      this.#at = nowMs;
      this.#speed = Number.POSITIVE_INFINITY;
      return;
    }
    const elapsedMs = nowMs - this.#at;
    if (elapsedMs <= 0) {
      return;
    }
    const current = Math.hypot(position[0] - last[0], position[1] - last[1], position[2] - last[2]) / (elapsedMs / 1000);
    this.#speed = Number.isFinite(this.#speed) ? this.#speed + (current - this.#speed) * (1 - Math.exp(-elapsedMs / SMOOTH_MS)) : current;
    this.#position = position;
    this.#at = nowMs;
  }

  /** 这个半径（米）的瓦片现在不请求 */
  culls(radiusMeters: number): boolean {
    return this.#speed * this.#windowSeconds >= Math.max(radiusMeters * 2, MIN_DIAMETER_METERS);
  }
}
