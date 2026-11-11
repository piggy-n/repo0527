import type {
  BenchStats,
  LongTaskStats,
  PageSetup,
  PhaseResult,
  RasterStats,
  SceneSample,
  ShotCoverage,
  TileTotals
} from './bench-api.ts';
import type { ProfileSummary } from './profile.ts';
import type { BlurEvent, SharpnessComparison } from './sharpness.ts';
import type { RunKind } from './scenes.ts';

// 结果的结构：raw.json 就是它，报告和验收判断都从它算

export type RunStatus = 'ok' | 'timeout' | 'invalid' | 'failed';

export interface MemoryReadings {
  /** JS 堆（MB） */
  readonly heapPeakMB: number | null;
  /** GPU 进程的专用显存（MB） */
  readonly gpuAtStableMB: number | null;
  readonly gpuPeakMB: number | null;
  readonly gpuUnavailable: string | null;
  /** 渲染进程（页面和它的 Worker）的私有内存（MB）：泼溅的 CPU 内存看它（ADR 0149 第 5 节） */
  readonly rendererAtStableMB?: number | null;
  readonly rendererPeakMB?: number | null;
  /** GPU 进程的私有内存（MB）：驱动在内存里留的副本 */
  readonly gpuProcessPeakMB?: number | null;
}

/** 飞行结束到稳定 */
export interface SettleResult {
  readonly stable: boolean;
  /** 从飞行结束算 */
  readonly ms: number;
  readonly longTasks: LongTaskStats;
  /** 飞行结束后的读数，一直记到稳定以后再过一会儿 */
  readonly trace: readonly SceneSample[];
}

/** 进程累计的 CPU 秒数：渲染进程里有主线程和全部 Worker，两种引擎可以直接比 */
export interface CpuSample {
  readonly rendererS: number | null;
  readonly gpuProcessS: number | null;
}

/** 资源图层场景的读数（方案 B 的 PoC）：到稳定时和整遍结束时各一次，都是累计值 */
export interface ResourceReadings {
  readonly tilesAtStable: TileTotals;
  readonly tilesAtEnd: TileTotals;
  readonly rasterAtStable: RasterStats | null;
  readonly rasterAtEnd: RasterStats | null;
  readonly cpuAtStable: CpuSample;
  readonly cpuAtEnd: CpuSample;
  /** 第一张有内容的位图到达，从开始加载算（只有 Cesium） */
  readonly firstBitmapMs: number | null;
}

export interface RunResult {
  readonly id: string;
  readonly scene: string;
  readonly variant: string;
  readonly kind: RunKind;
  readonly repeat: number;
  status: RunStatus;
  notes: string[];
  error?: string;
  durationS?: number;
  setup?: PageSetup & { readonly engine: string; readonly config: Readonly<Record<string, unknown>> };
  load?: {
    readonly stable: boolean;
    /** 从开始加载模型算 */
    readonly ttStableMs: number;
    /** 从打开页面算 */
    readonly ttFromNavigationMs: number;
    readonly longTasks: LongTaskStats;
  };
  atStable?: BenchStats;
  static?: PhaseResult;
  image?: ShotCoverage;
  flightCold?: PhaseResult;
  settle?: SettleResult;
  flightWarm?: PhaseResult;
  recovery?: SettleResult;
  atRecovered?: BenchStats;
  memory?: MemoryReadings;
  quality?: QualityResult;
  profile?: { readonly load: ProfileSummary; readonly flight: ProfileSummary };
  resources?: ResourceReadings;
  pageErrors?: readonly string[];
  glErrors?: number;
}

/** 画质那一遍：截图的文件名、静止观察的结果 */
export interface QualityResult {
  /** 稳定后的截图、隐藏模型的、飞一圈回来稳定后的（相对结果目录） */
  readonly shot: string;
  readonly shotWithoutModel: string;
  readonly shotAfterFlight: string | null;
  readonly hold: {
    readonly seconds: number;
    /** 静止观察期间瓦片的加载、卸载次数：不是 0 说明在来回折腾 */
    readonly loaded: number;
    readonly unloaded: number;
    /** 画面变糊的次数和面积 */
    readonly blurEvents: readonly BlurEvent[];
  };
}

/** 一个场景的截图对比（MapLibre / Cesium） */
export interface SceneQuality {
  readonly scene: string;
  readonly stable: SharpnessComparison;
  readonly afterFlight: SharpnessComparison | null;
  /** 文件名（相对结果目录） */
  readonly heatmap: string;
  readonly worstCrops: string;
  readonly subject: string;
  readonly reference: string;
}

export interface Environment {
  readonly gpu: string;
  readonly software: boolean;
  readonly integrated: boolean;
  readonly browser: string;
  readonly adapters: readonly string[];
  readonly cpu: string;
  readonly memoryGB: number;
  readonly os: string;
  readonly node: string;
  readonly gpuTimer: boolean;
  /** 空页面的帧间隔（毫秒）：不等 fence、最多 1 帧在路上、最多 2 帧在路上 */
  readonly floorMs: Readonly<Record<string, number | null>>;
}

export interface MeasureResults {
  readonly meta: {
    startedAt: string;
    updatedAt: string;
    readonly commit: string | null;
    finished: boolean;
    readonly quick: boolean;
    readonly basemap: string;
    readonly viewport: { readonly width: number; readonly height: number };
    readonly repeat: number;
    readonly pacing: number;
    readonly fps: number | null;
    readonly antialias: boolean;
    readonly plannedTotal: number;
    /** 泼溅场景的模型从哪份清单读的；没有泼溅场景时不写 */
    readonly manifest?: string;
  };
  readonly environment: Environment;
  readonly warnings: string[];
  readonly scenes: readonly {
    readonly id: string;
    readonly title: string;
    readonly acceptance: boolean;
    /** 有泼溅：比较预算，不和 Cesium 比 */
    readonly splat?: boolean;
    /** 资源图层的场景（方案 B 的 PoC）：不做 3C.4 的验收判断，另列一节 */
    readonly resources?: boolean;
    /** 这个场景跑的方案；不写时是全部方案 */
    readonly variants?: readonly string[];
  }[];
  readonly variants: readonly { readonly id: string; readonly label: string }[];
  readonly runs: RunResult[];
  readonly quality: SceneQuality[];
}
