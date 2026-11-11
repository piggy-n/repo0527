import type {
  BenchCamera,
  SceneSample,
  LongTaskStats,
  LongTaskWindow,
  PageSetup,
  PhaseResult,
  ShotCoverage,
  StableResult,
  Summary,
  UploadBucket,
  UploadStats
} from '../bench-api.ts';
import { FrameCap } from '../frame-cap.ts';
import { longTaskStats } from '../long-task-stats.ts';
import { shotCoverage } from '../shot-coverage.ts';
import { texture3dBytes } from '../upload-bytes.ts';
import { blankPixels, decodeShot } from './shots.ts';

// 测量探针：要最先执行（bench.ts 的第一个导入），接管 requestAnimationFrame。两种引擎用同一份代码量，
// 只依赖 rAF、PerformanceObserver 和 WebGL，不碰引擎内部。来自 ADR 0147 的 PoC，改了三处：
// 帧间隔的下限（允许几帧在路上）、每帧工作量（JS 加 GPU）、每帧的上传量

const MAX_FRAMES = 200000;
// 等 GPU 最多等这么久：上下文丢失或驱动异常时不至于卡死页面
const FENCE_TIMEOUT_MS = 15000;
const MB = 1048576;
// 在路上的帧数上限：解除 vsync 后 JS 提交得比 GPU 快，不等的话命令堆积，一串 2 毫秒的帧之后主线程被堵几秒。
// PoC 等上一帧执行完（1），帧间隔有约 20 毫秒的下限；0 是不等
const pacing = Number(new URLSearchParams(location.search).get('pacing') ?? 2);
const fpsText = new URLSearchParams(location.search).get('fps');
const frameCap = new FrameCap(fpsText === null ? null : Number(fpsText));

const frames = {
  intervals: new Float32Array(MAX_FRAMES),
  js: new Float32Array(MAX_FRAMES),
  gpu: new Float32Array(MAX_FRAMES).fill(Number.NaN),
  textureBytes: new Float32Array(MAX_FRAMES),
  bufferBytes: new Float32Array(MAX_FRAMES),
  mipmaps: new Uint16Array(MAX_FRAMES),
  count: 0,
  total: 0,
  lastStart: 0,
  jsAccum: 0,
  recording: false
};

// 这一帧到目前为止的上传量：回调外的上传也算进这一帧
const uploads = { texture: 0, buffer: 0, mipmaps: 0 };

function sizeFromArgs(args: readonly unknown[], widthIndex: number): number {
  const source = args.at(-1) as { readonly width?: number; readonly height?: number } | null;
  // 最后一个参数是图片时（6、7 个参数的写法）尺寸在它上面，是数组时尺寸在 widthIndex 上
  if (args.length < 9 && source?.width && source.height) {
    return source.width * source.height * 4;
  }
  const width = args[widthIndex];
  const height = args[widthIndex + 1];
  return typeof width === 'number' && typeof height === 'number' && source ? width * height * 4 : 0;
}

function watchUploads(): void {
  const proto = WebGL2RenderingContext.prototype;
  const methods = proto as unknown as Record<string, (...args: unknown[]) => unknown>;
  const wrap = (name: string, tally: (args: unknown[]) => void) => {
    const original = methods[name];
    if (!original) {
      throw new Error(`WebGL2 没有 ${name}`);
    }
    methods[name] = function (this: WebGL2RenderingContext, ...args: unknown[]) {
      tally(args);
      return original.apply(this, args);
    };
  };
  wrap('texImage2D', args => {
    uploads.texture += sizeFromArgs(args, 3);
  });
  wrap('texSubImage2D', args => {
    uploads.texture += sizeFromArgs(args, 4);
  });
  wrap('texImage3D', args => {
    uploads.texture += texture3dBytes(args, 3, 7);
  });
  wrap('texSubImage3D', args => {
    uploads.texture += texture3dBytes(args, 5, 8);
  });
  wrap('generateMipmap', () => {
    uploads.mipmaps += 1;
  });
  wrap('bufferData', args => {
    const data = args[1];
    uploads.buffer += typeof data === 'number' ? data : ((data as ArrayBufferView | null)?.byteLength ?? 0);
  });
}
watchUploads();

// 页面最后创建的 WebGL2 上下文就是引擎用的
let context: WebGL2RenderingContext | null = null;
// 创建 WebGL 上下文的时段：加载期最长的任务常常就是它，和瓦片无关
const contextWindows: LongTaskWindow[] = [];
// oxlint-disable-next-line typescript/unbound-method -- 下面用 call 带上 this
const nativeGetContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
  const startTime = performance.now();
  const result = (nativeGetContext as (...args: unknown[]) => RenderingContext | null).call(this, type, ...rest);
  if (type.startsWith('webgl')) {
    contextWindows.push({ startTime, duration: performance.now() - startTime });
  }
  if (type === 'webgl2' && result) {
    context = result as WebGL2RenderingContext;
  }
  return result;
} as typeof nativeGetContext;

// ---------- GPU 计时 ----------

interface TimerExtension {
  readonly TIME_ELAPSED_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
}

const gpu: {
  gl: WebGL2RenderingContext | null;
  extension: TimerExtension | null;
  reason: string | null;
  active: WebGLQuery | null;
  activeFrame: number;
  pending: { query: WebGLQuery; frame: number }[];
  pool: WebGLQuery[];
} = { gl: null, extension: null, reason: '没有绑定 WebGL 上下文', active: null, activeFrame: 0, pending: [], pool: [] };

function collectGpuResults(): void {
  const { gl, extension } = gpu;
  if (!gl || !extension) {
    return;
  }
  for (let next = gpu.pending[0]; next; next = gpu.pending[0]) {
    const { query, frame } = next;
    if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) {
      return;
    }
    const disjoint = gl.getParameter(extension.GPU_DISJOINT_EXT) as boolean;
    const nanoseconds = gl.getQueryParameter(query, gl.QUERY_RESULT) as number;
    gpu.pending.shift();
    gpu.pool.push(query);
    if (!disjoint && frame < MAX_FRAMES) {
      frames.gpu[frame] = nanoseconds / 1e6;
    }
  }
}

// 只包住这一帧的回调：命令是成批提交的，这样基本是 GPU 的执行时间
function gpuFrameStart(): void {
  const { gl, extension } = gpu;
  if (!gl || !extension) {
    return;
  }
  try {
    collectGpuResults();
    if (frames.recording && gpu.pending.length < 16) {
      const query = gpu.pool.pop() ?? gl.createQuery();
      gl.beginQuery(extension.TIME_ELAPSED_EXT, query);
      gpu.active = query;
      gpu.activeFrame = frames.count;
    }
  } catch (error) {
    gpu.reason = `GPU 计时出错：${String(error).slice(0, 120)}`;
    gpu.extension = null;
  }
}

function gpuFrameEnd(): void {
  const { gl, extension, active } = gpu;
  if (!gl || !extension || !active) {
    return;
  }
  try {
    gl.endQuery(extension.TIME_ELAPSED_EXT);
    gpu.pending.push({ query: active, frame: gpu.activeFrame });
  } catch (error) {
    gpu.reason = `GPU 计时出错：${String(error).slice(0, 120)}`;
    gpu.extension = null;
  }
  gpu.active = null;
}

// ---------- 接管 rAF ----------

const fences: { sync: WebGLSync; gl: WebGL2RenderingContext; since: number }[] = [];
let fenceTimeouts = 0;

function canStartFrame(): boolean {
  if (pacing === 0) {
    return true;
  }
  for (let first = fences[0]; first; first = fences[0]) {
    const { gl, sync, since } = first;
    let done: boolean;
    try {
      done = gl.isContextLost() || gl.getSyncParameter(sync, gl.SYNC_STATUS) === gl.SIGNALED;
    } catch {
      done = true;
    }
    if (!done && performance.now() - since > FENCE_TIMEOUT_MS) {
      fenceTimeouts += 1;
      done = true;
    }
    if (!done) {
      break;
    }
    try {
      gl.deleteSync(sync);
    } catch {
      // 上下文丢失时删除会失败，不影响后面
    }
    fences.shift();
  }
  return fences.length < pacing;
}

function placeFence(): void {
  const gl = gpu.gl ?? context;
  if (pacing === 0 || !gl || gl.isContextLost()) {
    return;
  }
  const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  if (sync) {
    fences.push({ sync, gl, since: performance.now() });
    gl.flush();
  }
}

function frameBoundary(now: number): void {
  if (frames.recording && frames.lastStart > 0 && frames.count < MAX_FRAMES) {
    frames.intervals[frames.count] = now - frames.lastStart;
    frames.js[frames.count] = frames.jsAccum;
    frames.textureBytes[frames.count] = uploads.texture;
    frames.bufferBytes[frames.count] = uploads.buffer;
    frames.mipmaps[frames.count] = uploads.mipmaps;
    frames.count += 1;
  }
  uploads.texture = 0;
  uploads.buffer = 0;
  uploads.mipmaps = 0;
  frames.total += 1;
  frames.jsAccum = 0;
  frames.lastStart = now;
}

const nativeRaf = window.requestAnimationFrame.bind(window);
let queue: { id: number; callback: FrameRequestCallback }[] = [];
let nextCallbackId = 1;
let tickScheduled = false;

function scheduleTick(): void {
  if (!tickScheduled) {
    tickScheduled = true;
    nativeRaf(tick);
  }
}

function tick(stamp: number): void {
  tickScheduled = false;
  if (queue.length === 0) {
    return;
  }
  if (!canStartFrame() || !frameCap.ready(performance.now())) {
    scheduleTick();
    return;
  }
  const callbacks = queue;
  queue = [];
  const start = performance.now();
  frameBoundary(start);
  gpuFrameStart();
  for (const { callback } of callbacks) {
    try {
      callback(stamp);
    } catch (error) {
      reportError(error);
    }
  }
  gpuFrameEnd();
  frames.jsAccum = performance.now() - start;
  placeFence();
  if (queue.length > 0) {
    scheduleTick();
  }
}

window.requestAnimationFrame = callback => {
  const id = nextCallbackId;
  nextCallbackId += 1;
  queue.push({ id, callback });
  scheduleTick();
  return id;
};
window.cancelAnimationFrame = id => {
  queue = queue.filter(item => item.id !== id);
};

// ---------- 长任务 ----------

const longTasks: PerformanceEntry[] = [];
new PerformanceObserver(list => {
  for (const entry of list.getEntries()) {
    if (longTasks.length < 20000) {
      longTasks.push(entry);
    }
  }
}).observe({ type: 'longtask', buffered: true });

const longTasksBetween = (from: number, to: number): LongTaskStats => longTaskStats(longTasks, contextWindows, from, to);

// ---------- 飞行中和飞行后的读数 ----------

// 飞行中隔这么久记一次：读数只有几十微秒，这个频率不影响帧时间
const FLIGHT_SAMPLE_MS = 250;
// 飞行后隔这么久记一次：这段不量帧时间，要看清楚画面怎样变化
const FILL_SAMPLE_MS = 50;
const fill: { timer: ReturnType<typeof setInterval> | null; samples: SceneSample[]; from: number } = { timer: null, samples: [], from: 0 };

function sceneSample(from: number): SceneSample | null {
  const stats = window.bench?.stats();
  return stats
    ? {
        t: performance.now() - from,
        tiles: stats.tilesVisible,
        triangles: stats.triangles,
        errorTarget: stats.errorTarget,
        loading: stats.loading,
        uploadPending: stats.uploadPending,
        cacheMB: stats.cacheMB,
        loaded: stats.loaded,
        queues: stats.queues,
        budget: stats.budget,
        splats: stats.splats
      }
    : null;
}

function sampleInto(samples: SceneSample[], from: number): void {
  const sample = sceneSample(from);
  if (sample) {
    samples.push(sample);
  }
}

function startFillTrace(): void {
  if (fill.timer !== null) {
    clearInterval(fill.timer);
  }
  fill.samples = [];
  fill.from = performance.now();
  sampleInto(fill.samples, fill.from);
  fill.timer = setInterval(() => sampleInto(fill.samples, fill.from), FILL_SAMPLE_MS);
}

// ---------- 统计 ----------

function percentile(sorted: Float64Array, p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
}

function summarize(values: ArrayLike<number>): Summary | null {
  const sorted = Float64Array.from(Array.from(values).filter(value => !Number.isNaN(value))).toSorted();
  if (sorted.length === 0) {
    return null;
  }
  return {
    samples: sorted.length,
    mean: sorted.reduce((total, value) => total + value, 0) / sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1] ?? 0
  };
}

// 按这一帧的上传量（MB）分桶：尖峰是不是上传造成的，看 GPU 耗时随上传量怎么变
const BUCKETS: readonly (readonly [string, number])[] = [
  ['0', 0],
  ['≤1', 1],
  ['≤8', 8],
  ['≤16', 16],
  ['≤32', 32],
  ['≤64', 64],
  ['>64', Number.POSITIVE_INFINITY]
];

function uploadStats(count: number): UploadStats {
  let textureMB = 0;
  let bufferMB = 0;
  let mipmaps = 0;
  let framesWithUpload = 0;
  let maxFrameMB = 0;
  const groups = BUCKETS.map((): number[] => []);
  for (let index = 0; index < count; index++) {
    const texture = (frames.textureBytes[index] ?? 0) / MB;
    const buffer = (frames.bufferBytes[index] ?? 0) / MB;
    const total = texture + buffer;
    textureMB += texture;
    bufferMB += buffer;
    mipmaps += frames.mipmaps[index] ?? 0;
    // 地图自己每帧有几 KB 的动态缓冲，不算上传
    if (total > 0.05) {
      framesWithUpload += 1;
    }
    maxFrameMB = Math.max(maxFrameMB, total);
    const bucket = total <= 0.05 ? 0 : BUCKETS.findIndex(([, limit], position) => position > 0 && total <= limit);
    const ms = frames.gpu[index] ?? Number.NaN;
    if (!Number.isNaN(ms)) {
      groups[bucket]?.push(ms);
    }
  }
  const buckets = BUCKETS.map(([label], index): UploadBucket => {
    const summary = summarize(groups[index] ?? []);
    return { label, frames: summary?.samples ?? 0, gpuP50: summary?.p50 ?? null, gpuP95: summary?.p95 ?? null };
  });
  return { textureMB, bufferMB, mipmaps, framesWithUpload, maxFrameMB, buckets };
}

let phase: { start: number; renders: number } | null = null;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function beginPhase(): void {
  frames.count = 0;
  frames.lastStart = 0;
  frames.gpu.fill(Number.NaN);
  frames.recording = true;
  phase = { start: performance.now(), renders: window.bench?.renders() ?? 0 };
  const keepAlive = () => {
    if (frames.recording) {
      window.requestAnimationFrame(keepAlive);
    }
  };
  window.requestAnimationFrame(keepAlive);
}

async function endPhase(): Promise<PhaseResult> {
  const end = performance.now();
  const started = phase ?? { start: end, renders: 0 };
  const renders = (window.bench?.renders() ?? 0) - started.renders;
  frames.recording = false;
  const { count } = frames;
  // 等已经结束的 GPU 查询出结果；longtask 的回调也要到下一个任务才来
  const deadline = performance.now() + 400;
  while (performance.now() < deadline && gpu.pending.length + (gpu.active ? 1 : 0) > 0) {
    // oxlint-disable-next-line no-await-in-loop -- 一帧一帧地等查询结果
    await new Promise(resolve => window.requestAnimationFrame(resolve));
  }
  await sleep(120);
  const intervals = frames.intervals.subarray(0, count);
  const js = frames.js.subarray(0, count);
  const gpuMs = frames.gpu.subarray(0, count);
  const work = Float32Array.from(js, (value, index) => value + (gpuMs[index] ?? Number.NaN));
  const over = (limit: number) => intervals.reduce((n, value) => n + (value >= limit ? 1 : 0), 0);
  const gpuSummary = summarize(gpuMs);
  return {
    endedAt: end,
    durationMs: end - started.start,
    frames: count,
    renders,
    interval: summarize(intervals),
    js: summarize(js),
    gpu: gpu.extension ? gpuSummary : null,
    work: summarize(work),
    gpuUnavailable: gpu.extension ? (gpuSummary ? null : '计时查询没有返回结果') : gpu.reason,
    fenceTimeouts,
    over: { ms33: over(33.3), ms50: over(50), ms100: over(100), ms200: over(200) },
    longTasks: longTasksBetween(started.start, end + 1),
    uploads: uploadStats(count)
  };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// 按时间走：慢的引擎丢帧但走的路一样，下载和解析的压力也一样
function fly(keyframes: readonly BenchCamera[], durationMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const last = keyframes.length - 1;
    const step = () => {
      try {
        const progress = (performance.now() - start) / durationMs;
        const final = keyframes[last];
        if (progress >= 1 && final) {
          window.bench?.setCamera(final);
          resolve();
          return;
        }
        const position = progress * last;
        const index = Math.floor(position);
        const from = keyframes[index];
        const to = keyframes[index + 1];
        if (from && to) {
          const t = position - index;
          window.bench?.setCamera({
            center: [lerp(from.center[0], to.center[0], t), lerp(from.center[1], to.center[1], t)],
            zoom: lerp(from.zoom, to.zoom, t),
            bearing: lerp(from.bearing, to.bearing, t),
            pitch: lerp(from.pitch, to.pitch, t)
          });
        }
        window.requestAnimationFrame(step);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    };
    window.requestAnimationFrame(step);
  });
}

async function waitFrames(count: number, timeoutMs = 20000): Promise<boolean> {
  const target = frames.total + count;
  const start = performance.now();
  while (frames.total < target && performance.now() - start < timeoutMs) {
    window.bench?.tick();
    // oxlint-disable-next-line no-await-in-loop -- 一帧一帧地等
    await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, 200);
      window.requestAnimationFrame(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  return frames.total >= target;
}

export interface Probe {
  attach(): PageSetup;
  waitStable(timeoutMs: number, streak?: number, intervalMs?: number): Promise<StableResult>;
  waitBasemap(timeoutMs: number): Promise<{ idle: boolean; waitedMs: number }>;
  waitFrames(count: number): Promise<boolean>;
  longTasks(from: number, to: number): LongTaskStats;
  longTaskWindows(): LongTaskWindow[];
  /** 再看 watchMs 毫秒（期间继续请求帧），结束飞行后的记录 */
  finishFillTrace(watchMs: number): Promise<SceneSample[]>;
  now(): number;
  record(durationMs: number): Promise<PhaseResult>;
  flight(keyframes: readonly BenchCamera[], durationMs: number): Promise<PhaseResult>;
  analyzeShots(withModel: string, withoutModel: string): Promise<ShotCoverage>;
}

export const probe: Probe = {
  attach() {
    const gl = context;
    if (!gl) {
      throw new Error('页面还没有创建 WebGL2 上下文');
    }
    gpu.gl = gl;
    gpu.extension = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExtension | null;
    gpu.reason = gpu.extension ? null : '浏览器没有提供 EXT_disjoint_timer_query_webgl2';
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const canvas = gl.canvas as HTMLCanvasElement;
    return {
      renderer: String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER)),
      vendor: String(gl.getParameter(debug ? debug.UNMASKED_VENDOR_WEBGL : gl.VENDOR)),
      drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      cssSize: [canvas.clientWidth, canvas.clientHeight],
      devicePixelRatio: window.devicePixelRatio,
      samples: gl.getParameter(gl.SAMPLES) as number,
      gpuTimer: Boolean(gpu.extension),
      pacing
    };
  },

  // 连续 streak 次都稳定才算；到稳定的时刻取这一串的第一次
  async waitStable(timeoutMs, streak = 5, intervalMs = 200) {
    const start = performance.now();
    let hits = 0;
    let first = 0;
    while (performance.now() - start < timeoutMs) {
      window.bench?.tick();
      if (window.bench?.isStable()) {
        if (hits === 0) {
          first = performance.now();
        }
        hits += 1;
        if (hits >= streak) {
          return { stable: true, at: first, waitedMs: first - start };
        }
      } else {
        hits = 0;
      }
      // oxlint-disable-next-line no-await-in-loop -- 按固定间隔轮询
      await sleep(intervalMs);
    }
    return { stable: false, at: performance.now(), waitedMs: performance.now() - start };
  },

  async waitBasemap(timeoutMs) {
    const start = performance.now();
    while (performance.now() - start < timeoutMs) {
      window.bench?.tick();
      if (window.bench?.basemapIdle()) {
        return { idle: true, waitedMs: performance.now() - start };
      }
      // oxlint-disable-next-line no-await-in-loop -- 按固定间隔轮询
      await sleep(200);
    }
    return { idle: false, waitedMs: performance.now() - start };
  },

  waitFrames,

  longTasks: longTasksBetween,

  longTaskWindows: () => longTasks.map(({ startTime, duration }) => ({ startTime, duration })),

  async finishFillTrace(watchMs) {
    const end = performance.now() + watchMs;
    while (performance.now() < end) {
      window.bench?.tick();
      // oxlint-disable-next-line no-await-in-loop -- 按固定间隔请求帧
      await sleep(200);
    }
    if (fill.timer !== null) {
      clearInterval(fill.timer);
      fill.timer = null;
    }
    return fill.samples;
  },

  now: () => performance.now(),

  async record(durationMs) {
    beginPhase();
    await sleep(durationMs);
    return endPhase();
  },

  async flight(keyframes, durationMs) {
    beginPhase();
    const trace: SceneSample[] = [];
    const from = performance.now();
    const timer = setInterval(() => sampleInto(trace, from), FLIGHT_SAMPLE_MS);
    await fly(keyframes, durationMs);
    clearInterval(timer);
    startFillTrace();
    return { ...(await endPhase()), trace };
  },

  // 模型显示和隐藏各拍一张，比较后才知道模型是不是真的画出来了；模型的像素里再数接近白色的（泼溅的亮处偏白）
  async analyzeShots(withModel, withoutModel) {
    const [a, b] = await Promise.all([decodeShot(withModel), decodeShot(withoutModel)]);
    return { blank: blankPixels(a), ...shotCoverage(a, b) };
  }
};

declare global {
  interface Window {
    benchProbe?: Probe;
    bench?: import('./bench.ts').BenchApi;
    benchReady?: boolean;
  }
}
