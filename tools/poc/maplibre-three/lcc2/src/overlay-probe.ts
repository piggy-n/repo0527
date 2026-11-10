// 叠画布页的测量工具：每个上下文的 GPU 耗时、等 GPU 画完再开始下一帧、帧记录、按颜色找标记的质心

interface TimerExtension {
  readonly TIME_ELAPSED_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
}

/** 一个上下文里一段 GL 调用的 GPU 耗时（毫秒）；没有扩展时什么都不做 */
export class GpuTimer {
  readonly samples: number[] = [];
  readonly #gl: WebGL2RenderingContext;
  readonly #ext: TimerExtension | null;
  readonly #pending: WebGLQuery[] = [];
  #active: WebGLQuery | null = null;

  constructor(gl: WebGL2RenderingContext, enabled: boolean) {
    this.#gl = gl;
    this.#ext = enabled ? (gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExtension | null) : null;
  }

  get available(): boolean {
    return this.#ext !== null;
  }

  begin(): void {
    if (!this.#ext || this.#active) {
      return;
    }
    const query = this.#gl.createQuery();
    if (query) {
      this.#gl.beginQuery(this.#ext.TIME_ELAPSED_EXT, query);
      this.#active = query;
    }
  }

  end(): void {
    if (!this.#ext || !this.#active) {
      return;
    }
    this.#gl.endQuery(this.#ext.TIME_ELAPSED_EXT);
    this.#pending.push(this.#active);
    this.#active = null;
  }

  /** 取回已经出结果的查询；GPU 中途被打断（disjoint）的那批作废 */
  poll(): void {
    if (!this.#ext) {
      return;
    }
    const gl = this.#gl;
    const disjoint = gl.getParameter(this.#ext.GPU_DISJOINT_EXT) as boolean;
    while (this.#pending.length > 0 && (gl.getQueryParameter(this.#pending[0], gl.QUERY_RESULT_AVAILABLE) as boolean)) {
      const query = this.#pending.shift() as WebGLQuery;
      if (!disjoint) {
        this.samples.push((gl.getQueryParameter(query, gl.QUERY_RESULT) as number) / 1e6);
      }
      gl.deleteQuery(query);
    }
  }
}

// 等上一帧最多等这么久，上下文丢失时不至于卡死
const FENCE_TIMEOUT_MS = 2000;

/** 解除 vsync 后命令会在 GPU 上堆积：等几个上下文的上一帧都执行完才开始下一帧，帧间隔才等于 JS 加 GPU */
export class FencePacer {
  timeouts = 0;
  readonly #contexts: readonly WebGL2RenderingContext[];
  #syncs: (WebGLSync | null)[] = [];
  #since = 0;

  constructor(contexts: readonly WebGL2RenderingContext[]) {
    this.#contexts = contexts;
  }

  /** 上一帧在所有上下文上都执行完了 */
  ready(): boolean {
    if (this.#syncs.length === 0) {
      return true;
    }
    const expired = performance.now() - this.#since > FENCE_TIMEOUT_MS;
    let done = true;
    this.#contexts.forEach((gl, index) => {
      const sync = this.#syncs[index];
      if (!sync) {
        return;
      }
      const status = gl.clientWaitSync(sync, 0, 0);
      if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED || status === gl.WAIT_FAILED || expired) {
        gl.deleteSync(sync);
        this.#syncs[index] = null;
      } else {
        done = false;
      }
    });
    if (expired) {
      this.timeouts += 1;
    }
    if (done) {
      this.#syncs = [];
    }
    return done;
  }

  mark(): void {
    this.#syncs = this.#contexts.map(gl => {
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      return sync;
    });
    this.#since = performance.now();
  }
}

export interface FrameRecord {
  readonly intervalMs: number;
  readonly cesiumMs: number;
  readonly overlayMs: number;
  readonly cesiumRendered: boolean;
  readonly overlayRendered: boolean;
}

function quantile(sorted: readonly number[], q: number): number | null {
  if (sorted.length === 0) {
    return null;
  }
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

export function summarize(values: readonly number[]): { n: number; p50: number | null; p95: number | null; max: number | null } {
  const sorted = [...values].sort((a, b) => a - b);
  const round = (value: number | null) => (value === null ? null : Number(value.toFixed(2)));
  return { n: sorted.length, p50: round(quantile(sorted, 0.5)), p95: round(quantile(sorted, 0.95)), max: round(sorted.at(-1) ?? null) };
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

type Matcher = (r: number, g: number, b: number, a: number) => boolean;

// 只认纯色：泼溅和模型里也有偏青、偏品红的像素
export const isMagenta: Matcher = (r, g, b, a) => a > 240 && r > 240 && b > 240 && g < 16;
export const isCyan: Matcher = (r, g, b, a) => a > 240 && r < 16 && g > 240 && b > 240;

let scratch: CanvasRenderingContext2D | null = null;

/**
 * 在一块 WebGL 画布上找某种颜色的质心（绘图缓冲的像素，原点在左上）。每个期望位置只看周围 radius 像素；
 * 要在画完的同一个任务里调用，这时绘图缓冲还在
 */
export function centroids(source: HTMLCanvasElement, match: Matcher, expected: readonly (Point | null)[], radius = 40): (Point | null)[] {
  if (!scratch) {
    scratch = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  }
  const context = scratch;
  if (!context) {
    return expected.map(() => null);
  }
  const size = radius * 2;
  if (context.canvas.width !== size) {
    context.canvas.width = size;
    context.canvas.height = size;
  }
  return expected.map(point => {
    if (!point) {
      return null;
    }
    const left = Math.round(point.x) - radius;
    const top = Math.round(point.y) - radius;
    if (left < 0 || top < 0 || left + size > source.width || top + size > source.height) {
      return null;
    }
    context.clearRect(0, 0, size, size);
    context.drawImage(source, left, top, size, size, 0, 0, size, size);
    const { data } = context.getImageData(0, 0, size, size);
    let count = 0;
    let sumX = 0;
    let sumY = 0;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const i = (y * size + x) * 4;
        if (match(data[i], data[i + 1], data[i + 2], data[i + 3])) {
          count += 1;
          sumX += x + 0.5;
          sumY += y + 0.5;
        }
      }
    }
    return count === 0 ? null : { x: left + sumX / count, y: top + sumY / count };
  });
}
