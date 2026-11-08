import type { BenchStats, SceneSample, LongTaskStats, PageSetup, PhaseResult, ShotCoverage } from './bench-api.ts';
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
    readonly antialias: boolean;
    readonly plannedTotal: number;
  };
  readonly environment: Environment;
  readonly warnings: string[];
  readonly scenes: readonly { readonly id: string; readonly title: string; readonly acceptance: boolean }[];
  readonly variants: readonly { readonly id: string; readonly label: string }[];
  readonly runs: RunResult[];
  readonly quality: SceneQuality[];
}
