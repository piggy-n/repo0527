// 测量脚本（Node）和测量页（浏览器）之间的接口：只有类型，两边都能导入

/** 和 MapLibre 的相机参数相同 */
export interface BenchCamera {
  readonly center: readonly [number, number];
  readonly zoom: number;
  readonly bearing: number;
  readonly pitch: number;
}

/** MapLibre 引擎的瓦片队列：哪一步排着队，就是哪一步跟不上 */
export interface TileQueues {
  /** 等下载和下载中的 */
  readonly downloading: number;
  readonly parsing: number;
  /** 这一帧因为相机走得快没有请求的 */
  readonly culled: number;
  /** 这一帧在用的，和其中视野外的：REPLACE 的节点要等全部子节点，视野外的也算 */
  readonly used: number;
  readonly usedOutOfView: number;
}

/** MapLibre 引擎放宽屏幕误差的依据和动着不请求的窗口 */
export interface BudgetReadings {
  /** 需求（在用的加上还要加载的估计）、其中还要加载的、再其中没请求的（MB） */
  readonly demandMB: number;
  readonly pendingMB: number;
  readonly culledMB: number;
  /** 累计：因为装满、因为停着估计放不下而放宽的帧数 */
  readonly raisedFull: number;
  readonly raisedPredicted: number;
  /** 动着不请求的窗口（秒，各瓦片集里最长的）；动着也请求时为 null */
  readonly cullWindow: number | null;
}

/** 高斯泼溅的读数（MapLibre 引擎，ADR 0149 第 5 节）：库自己估计的数，各份加起来 */
export interface SplatReadings {
  /** 渲染器的总预算（高斯个数） */
  readonly budget: number;
  /** 画着的高斯个数：到不了预算说明这个视角要不了这么多 */
  readonly visible: number;
  readonly residentChunks: number;
  readonly loadingChunks: number;
  /** 当前视角要的细节到了多少，0～1，取各份里最低的 */
  readonly loadProgress: number;
  /** 库估计的 CPU 缓存、GPU 存储、还没放进存储的副本（MB） */
  readonly cpuMB: number;
  readonly gpuMB: number;
  readonly pendingMB: number;
  /** 累计下载（MB） */
  readonly downloadedMB: number;
  /** 解码用的 WASM 内存的峰值（MB），不在 cpuMB 里 */
  readonly peakWasmMB: number;
}

/** 两种引擎统一的读数；引擎没有的项是 null */
export interface BenchStats {
  readonly tilesVisible: number;
  readonly triangles: number;
  /** 引擎自己估算的模型显存（MB） */
  readonly cacheMB: number;
  /** 实际用的屏幕误差（清单不写时基准是 8，变大说明放不下） */
  readonly errorTarget: number;
  /** 缓存满了没能排队的瓦片；Cesium 没有这一项 */
  readonly refused: number | null;
  /** 累计：瓦片加载完成、被卸载、加载失败的次数 */
  readonly loaded: number;
  readonly unloaded: number;
  readonly failed: number;
  /** 还在下载、解析、上传的瓦片 */
  readonly loading: number;
  /** 等待上传的瓦片、累计提前上传的字节（MB）；Cesium 没有这两项 */
  readonly uploadPending: number | null;
  readonly uploadedMB: number | null;
  /** 锁在当前姿态（MapLibre 引擎）；Cesium 没有这一项 */
  readonly locked: boolean | null;
  /** Cesium 没有这一项 */
  readonly queues: TileQueues | null;
  /** Cesium 没有这一项 */
  readonly budget: BudgetReadings | null;
  /** 没有泼溅时（和 Cesium）是 null */
  readonly splats: SplatReadings | null;
}

export interface Summary {
  readonly samples: number;
  readonly mean: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
}

export interface LongTaskStats {
  readonly count: number;
  readonly maxMs: number;
  readonly totalMs: number;
  readonly over100: number;
  readonly over200: number;
  readonly over500: number;
  /** 这段时间里创建 WebGL 上下文花的时间 */
  readonly contextMs: number;
  /** 最长的任务，减去其中创建 WebGL 上下文的部分：那部分和瓦片无关，只看驱动和机器 */
  readonly maxWithoutContextMs: number;
}

/** 上传量在这个范围的帧，它们的 GPU 耗时：用来判断尖峰是不是上传造成的 */
export interface UploadBucket {
  readonly label: string;
  readonly frames: number;
  readonly gpuP50: number | null;
  readonly gpuP95: number | null;
}

export interface UploadStats {
  readonly textureMB: number;
  readonly bufferMB: number;
  readonly mipmaps: number;
  readonly framesWithUpload: number;
  /** 上传最多的一帧（MB） */
  readonly maxFrameMB: number;
  readonly buckets: readonly UploadBucket[];
}

/** 一个长任务：页面时钟（performance.now） */
export interface LongTaskWindow {
  readonly startTime: number;
  readonly duration: number;
}

/** 某一刻的读数：看飞行中和飞行后画面怎样变化 */
export interface SceneSample {
  /** 离这一段开始的毫秒数（飞行中从飞行开始算，飞行后从飞行结束算） */
  readonly t: number;
  readonly tiles: number;
  readonly triangles: number;
  readonly errorTarget: number;
  readonly loading: number;
  readonly uploadPending: number | null;
  readonly cacheMB: number;
  readonly loaded: number;
  readonly queues: TileQueues | null;
  readonly budget: BudgetReadings | null;
  readonly splats: SplatReadings | null;
}

/** 一段时间的统计（静止、飞行） */
export interface PhaseResult {
  /** 这段时间结束的时刻（performance.now）：统计本身还要等一会儿，飞行后的计时要从这里算 */
  readonly endedAt: number;
  readonly durationMs: number;
  readonly frames: number;
  readonly renders: number;
  /** 实际的帧间隔 */
  readonly interval: Summary | null;
  /** 每帧主线程耗时 */
  readonly js: Summary | null;
  /** 每帧 GPU 耗时（计时查询，只包住这一帧的回调） */
  readonly gpu: Summary | null;
  /** 每帧工作量：JS 加 GPU，不受帧间隔下限影响 */
  readonly work: Summary | null;
  readonly gpuUnavailable: string | null;
  readonly fenceTimeouts: number;
  readonly over: {
    readonly ms33: number;
    readonly ms50: number;
    readonly ms100: number;
    readonly ms200: number;
  };
  readonly longTasks: LongTaskStats;
  readonly uploads: UploadStats;
  /** 飞行中的读数：帧时间和上传量比的是工作量，这个看同样的工作量画得多细 */
  readonly trace?: readonly SceneSample[];
}

export interface StableResult {
  readonly stable: boolean;
  /** performance.now 的时刻：连续稳定的第一次 */
  readonly at: number;
  readonly waitedMs: number;
}

export interface PageSetup {
  readonly renderer: string;
  readonly vendor: string;
  readonly drawingBuffer: readonly [number, number];
  readonly cssSize: readonly [number, number];
  readonly devicePixelRatio: number;
  readonly samples: number;
  readonly gpuTimer: boolean;
  readonly pacing: number;
}

/** 画面分析（在页面里解码）：模型覆盖了多少，画面是不是空白 */
export interface ShotCoverage {
  readonly blank: boolean;
  readonly modelCoveragePct: number;
  /** 模型的像素里接近白色的比例（%）：泼溅的亮处偏白（ADR 0149 风险），同一相机下软件渲染和显卡比；没有模型像素时为 null */
  readonly brightPct: number | null;
}
