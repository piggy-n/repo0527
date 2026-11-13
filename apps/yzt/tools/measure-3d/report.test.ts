// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { BenchStats, PhaseResult, SceneSample, SplatReadings } from './bench-api.ts';
import { renderManual, renderQualityPage, renderReport, splatFill } from './report.ts';
import type { MeasureResults, QualityResult, RunResult, SceneQuality } from './results.ts';

const SPLATS: SplatReadings = {
  budget: 3_000_000,
  visible: 2_950_000,
  residentChunks: 12,
  loadingChunks: 0,
  loadProgress: 1,
  cpuMB: 437,
  gpuMB: 226,
  pendingMB: 0,
  downloadedMB: 132,
  peakWasmMB: 64
};

const stats = (splats: SplatReadings | null, refused = 0): BenchStats => ({
  tilesVisible: 0,
  triangles: 0,
  cacheMB: 0,
  errorTarget: 8,
  refused,
  loaded: 0,
  unloaded: 0,
  failed: 0,
  loading: 0,
  uploadPending: 0,
  uploadedMB: 0,
  releasedMB: 0,
  locked: false,
  detail: { sharp: 0, relaxed: 0, waiting: 0, finest: 0, additive: 0 },
  queues: { downloading: 0, parsing: 0, culled: 0, used: 0, usedOutOfView: 0 },
  budget: { limitMB: 2048, demandMB: 0, pendingMB: 0, culledMB: 0, raisedFull: 0, raisedPredicted: 0, cullWindow: null },
  levels: [],
  splats
});

const run = (variant: string, splats: SplatReadings): RunResult => ({
  id: `splat-pc-z18/${variant}/perf-1`,
  scene: 'splat-pc-z18',
  variant,
  kind: 'perf',
  repeat: 0,
  status: 'ok',
  notes: [],
  atStable: stats(splats),
  memory: {
    heapPeakMB: 80,
    gpuAtStableMB: 900,
    gpuPeakMB: 1100,
    gpuUnavailable: null,
    rendererAtStableMB: 1500,
    rendererPeakMB: 1800,
    gpuProcessPeakMB: 400
  }
});

const SPLAT_SCENE = { id: 'splat-pc-z18', title: '彭城广场 LCC2 z18', byDefault: false, splat: true, variants: ['maplibre-splat3m', 'maplibre-splat10m'] };
const TILESET_SCENE = { id: 'oblique-z19', title: '倾斜摄影 z19', byDefault: true, splat: false, variants: ['maplibre', 'maplibre-no-budget'] };

// 一段统计：每帧工作量给四个不同的数，读错字段时单元格对不上
const phase = (work: readonly [number, number, number, number], longTasks: { readonly count: number; readonly maxMs: number }): PhaseResult =>
  ({
    work: { p50: work[0], p95: work[1], p99: work[2], max: work[3] },
    gpu: { p50: 1, p95: 2, p99: 3, max: 4 },
    over: { ms33: 7, ms50: 8, ms100: 9, ms200: 0 },
    longTasks,
    uploads: { textureMB: 10, bufferMB: 1, maxFrameMB: 2 }
  }) as unknown as PhaseResult;

const flight = (count: number, maxMs: number) => phase([5, 5, 5, 5], { count, maxMs });
const LONG_TASKS = { count: 0, maxMs: 0, totalMs: 0, over100: 0, over200: 0, over500: 0, contextMs: 0, maxWithoutContextMs: 0 };
const tilesetRun = (variant: string, refused = 0): RunResult => ({
  ...run(variant, SPLATS),
  id: `oblique-z19/${variant}/perf-1`,
  scene: 'oblique-z19',
  atStable: stats(null, refused)
});

const SHOTS: QualityResult = {
  shot: 'shots/oblique-z19__maplibre__quality.png',
  shotWithoutModel: 'shots/oblique-z19__maplibre__quality-no-model.png',
  shotAfterFlight: 'shots/oblique-z19__maplibre__quality-after-flight.png',
  hold: { seconds: 30, loaded: 0, unloaded: 0, blurEvents: [] }
};

const qualityRun = (shots: QualityResult = SHOTS, variant = 'maplibre'): RunResult => ({
  id: `oblique-z19/${variant}/quality`,
  scene: 'oblique-z19',
  variant,
  kind: 'quality',
  repeat: 0,
  status: 'ok',
  notes: [],
  quality: shots
});

const COMPARED: SceneQuality = {
  scene: 'oblique-z19',
  variant: 'maplibre',
  afterFlight: {
    comparison: { cells: 120, medianRatio: 1.01, worstDecileRatio: 0.96, ratios: [1, null, 0.88, 1.02] },
    heatmap: 'shots/oblique-z19__maplibre-heatmap.png',
    worstCrops: 'shots/oblique-z19__maplibre-worst.png'
  },
  versusDefault: null
};

// 缓存上限 6 GB 这一档：自己的截图，和默认值比的结果
const TIER = 'maplibre-cache6g';
const TIER_SHOTS: QualityResult = {
  ...SHOTS,
  shot: 'shots/oblique-z19__maplibre-cache6g__quality.png',
  shotAfterFlight: 'shots/oblique-z19__maplibre-cache6g__quality-after-flight.png'
};
const TIER_COMPARED: SceneQuality = {
  scene: 'oblique-z19',
  variant: TIER,
  afterFlight: null,
  versusDefault: {
    comparison: { cells: 100, medianRatio: 0.91, worstDecileRatio: 0.72, ratios: [0.9, 0.65, null] },
    heatmap: 'shots/oblique-z19__maplibre-cache6g-versus-default-heatmap.png',
    worstCrops: 'shots/oblique-z19__maplibre-cache6g-versus-default-worst.png'
  }
};
const TIER_SCENE = { ...TILESET_SCENE, variants: ['maplibre', TIER] };

// 经开区一层瓦片的实际大小
const level = (depth: number, loads: number, averageMB: number) => ({ model: 'wuxi/3dtiles/经开区/tileset.json', depth, loads, averageMB });

// 定位后放大一级（这一档）：首屏估计放宽 3 帧，放大以后累计到 zoomedRaised（默认又估计放宽了 4 帧），移开再移回没有再放宽；
// nudgedError 为 null 时没有移回来
const zoomRun = (
  zoomedError: number,
  nudgedError: number | null,
  zoomedRaised = { raisedFull: 0, raisedPredicted: 7 }
): RunResult => {
  const settle = { stable: true, ms: 4200, longTasks: LONG_TASKS, trace: [] };
  const raised = (raisedPredicted: number) => ({ ...stats(null).budget, raisedPredicted });
  return {
    id: `oblique-z19/${TIER}/zoom`,
    scene: 'oblique-z19',
    variant: TIER,
    kind: 'zoom',
    repeat: 0,
    status: 'ok',
    notes: [],
    zoom: {
      before: { ...stats(null), errorTarget: 9.4, locked: true, budget: raised(3) },
      camera: { center: [120.41, 31.51], zoom: 20, pitch: 55, bearing: 20 },
      zoomed: {
        settle,
        at: { ...stats(null), errorTarget: zoomedError, locked: true, cacheMB: 2500, budget: { ...stats(null).budget, ...zoomedRaised, demandMB: 3000, limitMB: 4096 } },
        shot: 'shots/oblique-z19__maplibre-cache6g__zoom-zoomed.png'
      },
      nudged:
        nudgedError === null
          ? null
          : {
              settle,
              at: { ...stats(null), errorTarget: nudgedError, budget: { ...stats(null).budget, ...zoomedRaised } },
              shot: 'shots/oblique-z19__maplibre-cache6g__zoom-nudged.png'
            }
    }
  };
};

// 画布实际画了这么多像素的一遍
const canvasRun = (width: number, height: number): RunResult => ({
  ...tilesetRun('maplibre'),
  setup: {
    renderer: 'gpu',
    vendor: 'v',
    drawingBuffer: [width, height],
    cssSize: [width, height],
    devicePixelRatio: 1,
    samples: 0,
    gpuTimer: true,
    pacing: 2,
    config: {}
  }
});

// 某一刻累计放宽的帧（装满、估计）
const budgetAt = (t: number, raisedFull: number, raisedPredicted: number): SceneSample => ({
  ...sample(t, 0, 0),
  budget: { ...stats(null).budget, raisedFull, raisedPredicted }
});

// 恢复后停在粗的一级：放宽了的、等着的瓦片，需求低于上限
const coarse = (locked: boolean): RunResult => ({
  ...tilesetRun('maplibre'),
  atRecovered: {
    ...stats(null),
    locked,
    detail: { sharp: 40, relaxed: 12, waiting: 3, finest: 1, additive: 0 },
    budget: { ...stats(null).budget, limitMB: 2048, demandMB: 1400 }
  }
});

// 飞行后的一份读数：只有放宽了的、等着的块数不同
const sample = (t: number, relaxed: number, waiting: number): SceneSample => ({
  t,
  tiles: 0,
  triangles: 0,
  errorTarget: 8,
  loading: 0,
  uploadPending: 0,
  cacheMB: 0,
  loaded: 0,
  locked: true,
  detail: { sharp: 0, relaxed, waiting, finest: 0, additive: 0 },
  queues: stats(null).queues,
  budget: stats(null).budget,
  splats: null
});

function results(runs: RunResult[], scenes: MeasureResults['scenes'] = [SPLAT_SCENE], quality: SceneQuality[] = []): MeasureResults {
  return {
    meta: {
      startedAt: '2026-11-10T00:00:00Z',
      updatedAt: '2026-11-10T00:10:00Z',
      commit: 'abc1234',
      finished: true,
      quick: false,
      basemap: 'none',
      viewport: { width: 1600, height: 900 },
      repeat: 1,
      pacing: 2,
      fps: null,
      antialias: false,
      plannedTotal: runs.length,
      manifest: '本地清单 local/3dt/manifest.json'
    },
    environment: {
      gpu: 'NVIDIA GeForce RTX 3060',
      software: false,
      integrated: false,
      browser: 'chrome',
      adapters: [],
      cpu: 'cpu',
      memoryGB: 16,
      os: 'Windows',
      node: 'v24',
      gpuTimer: true,
      floorMs: {}
    },
    warnings: [],
    scenes,
    variants: [
      { id: 'maplibre', label: 'MapLibre' },
      { id: 'maplibre-no-budget', label: 'MapLibre，不提前上传' },
      { id: 'maplibre-splat3m', label: 'MapLibre，泼溅预算 300 万' },
      { id: 'maplibre-splat10m', label: 'MapLibre，泼溅预算 1,000 万' },
      { id: TIER, label: 'MapLibre，缓存上限 6 GB' }
    ],
    runs,
    quality
  };
}

describe('高斯泼溅的预算（ADR 0149 L.3）', () => {
  const filled = run('maplibre-splat3m', SPLATS);
  const short = run('maplibre-splat10m', { ...SPLATS, budget: 10_000_000, visible: 6_000_000 });

  it('可见的高斯占预算的比例', () => {
    expect(splatFill([filled])).toBeCloseTo(0.983, 3);
    expect(splatFill([short])).toBeCloseTo(0.6, 3);
    expect(splatFill([{ ...filled, atStable: stats(null) }])).toBeNull();
  });

  it('只有泼溅场景时：标题换成 L.3，按预算并排，不出检查表', () => {
    const report = renderReport(results([filled, short]));
    expect(report).toContain('# 高斯泼溅的预算实测（ADR 0149 L.3）');
    expect(report).not.toContain('## 检查');
    expect(report).toContain('| 指标 | MapLibre，泼溅预算 300 万 | MapLibre，泼溅预算 1,000 万 |');
    expect(report).toContain('295 / 300，用满');
    expect(report).toContain('600 / 1,000，**没用满（60%）**');
    expect(report).toContain('1,500 / 1,800，400');
    expect(report).toContain('模型来自本地清单 local/3dt/manifest.json');
  });

  it('ADR 要的帧时间、显存和库的估计各读各的字段', () => {
    const report = renderReport(results([{ ...filled, static: phase([5.1, 5.2, 5.3, 5.4], { count: 0, maxMs: 0 }), flightCold: phase([6.1, 6.2, 6.3, 6.4], { count: 0, maxMs: 0 }), image: { blank: false, modelCoveragePct: 25, brightPct: 0.6 } }]));
    expect(report).toContain('| 静止：每帧工作量 p50 / p95 / p99 / 最长 | 5.1 / 5.2 / 5.3 / 5.4 |');
    expect(report).toContain('| 第一遍飞行：每帧工作量 | 6.1 / 6.2 / 6.3 / 6.4 |');
    expect(report).toContain('| 第一遍飞行：≥33 / ≥50 / ≥100 毫秒的帧 | 7 / 8 / 9 |');
    expect(report).toContain('| 显存（GPU 进程专用）：稳定时 / 峰值（MB） | 900 / 1,100 |');
    expect(report).toContain('| 库估计：GPU / CPU / WASM 峰值（MB，稳定时） | 226 / 437 / 64 |');
    expect(report).toContain('| 模型占画面 / 其中接近白色（%） | 25.0 / 0.6 |');
  });

  it('长任务的"最长"取各遍最大的：两遍的中点可能是不存在的长任务', () => {
    const report = renderReport(results([{ ...filled, flightCold: flight(2, 55) }, { ...filled, flightCold: flight(0, 0) }]));
    expect(report).toContain('| 第一遍飞行：长任务 次数（中位数）/ 最长（各遍最大） | 1 / 55 |');
  });

  it('没用满只说稳定时的行，飞行和峰值的行仍然算数', () => {
    expect(renderReport(results([short]))).toContain('稳定时的行不代表这个预算的开销');
  });

  it('人工检查只列泼溅要看的', () => {
    const manual = renderManual(results([filled]));
    expect(manual).toContain('/dev/splat-watch');
    expect(manual).toContain('亮处偏白');
    expect(manual).not.toContain('quality.html');
  });
});

describe('有瓦片集场景的报告', () => {
  const tilesetRuns = [tilesetRun('maplibre'), tilesetRun('maplibre-no-budget'), qualityRun()];

  it('只有瓦片集：三维实测的标题、检查和各个方案的列，人工检查看 quality.html', () => {
    const scenes = [TILESET_SCENE];
    const report = renderReport(results(tilesetRuns, scenes));
    expect(report).toContain('# 三维实测（MapLibre 引擎）');
    expect(report).toContain('## 检查');
    expect(report).toContain('### 倾斜摄影 z19：全部通过');
    expect(report).toContain('| 画质 | 稳定时没有被拒绝的瓦片 | 0 块 | 通过 |');
    expect(report).toContain('| 振荡 | 静止观察期间没有瓦片加载、卸载 | 0 次 | 通过 |');
    expect(report).toContain('| 指标 | MapLibre | MapLibre，不提前上传 |');
    expect(report).not.toContain('## 高斯泼溅的预算');
    expect(renderManual(results(tilesetRuns, scenes))).toContain('quality.html');
  });

  it('检查不通过的写在场景的标题上', () => {
    const report = renderReport(results([tilesetRun('maplibre', 3), qualityRun()], [TILESET_SCENE]));
    expect(report).toContain('### 倾斜摄影 z19：没有全部通过');
    expect(report).toContain('| 画质 | 稳定时没有被拒绝的瓦片 | 3 块 | **不通过** |');
  });

  it('飞一圈回来的清晰度：比过以后写进检查一节，最差一格不算空的格子', () => {
    const report = renderReport(results(tilesetRuns, [TILESET_SCENE], [COMPARED]));
    expect(report).toContain('**飞一圈回来的清晰度（和飞行前比）：** 比了 120 格，中位数 1.01，最差 10% 0.96，最差一格 0.88');
    expect(renderReport(results(tilesetRuns, [TILESET_SCENE]))).not.toContain('**飞一圈回来的清晰度');
  });

  it('显示的瓦片按细不细分、需求对上限和锁定，各读各的字段；锁定按遍数', () => {
    const report = renderReport(results([coarse(true), coarse(true), coarse(false)], [TILESET_SCENE]));
    expect(report).toContain('| 恢复后：显示的瓦片 够细 / 放宽了才停在这一级 / 等更细的 / 已是最细（块） | 40 / 12 / 3 / 1 |');
    expect(report).toContain('| 恢复后：需求 / 缓存上限（MB），锁定 | 1,400 / 2,048，锁定 2 / 3 遍 |');
  });

  it('释放的贴图、上下文丢失、代理出错各一行；丢失和出错取各遍最多的', () => {
    const quiet: RunResult = { ...tilesetRun('maplibre'), context: { lost: 0, restored: 0 }, proxy: { timeouts: 0, failures: 0 } };
    const troubled: RunResult = {
      ...tilesetRun('maplibre'),
      atRecovered: { ...stats(null), releasedMB: 1234 },
      context: { lost: 2, restored: 1 },
      proxy: { timeouts: 3, failures: 1 }
    };
    const report = renderReport(results([quiet, troubled], [TILESET_SCENE]));
    expect(report).toContain('| WebGL 上下文 丢失 / 恢复（次，各遍最多） | 2 / 1 |');
    expect(report).toContain('| 经代理的请求 超时 / 失败（次，各遍最多） | 3 / 1 |');
    expect(renderReport(results([troubled], [TILESET_SCENE]))).toContain('| 上传后释放的贴图（MB，累计到恢复后） | 1,234 |');
  });

  it('画布实际画的像素：和视口不同时标出来', () => {
    expect(renderReport(results([canvasRun(1600, 900)], [TILESET_SCENE]))).toContain('| 画布（实际画的像素） | 1600×900，和视口相同 |');
    expect(renderReport(results([canvasRun(1536, 864)], [TILESET_SCENE]))).toContain('| 画布（实际画的像素） | **1536×864，和视口 1600×900 不同** |');
  });

  it('ADD 的瓦片不分，有的时候写在后面；加载到稳定放宽的原因单独一行', () => {
    const additive: RunResult = {
      ...tilesetRun('maplibre'),
      atStable: {
        ...stats(null),
        detail: { sharp: 5, relaxed: 0, waiting: 0, finest: 0, additive: 7 },
        budget: { ...stats(null).budget, raisedFull: 3, raisedPredicted: 11 }
      }
    };
    const report = renderReport(results([additive], [TILESET_SCENE]));
    expect(report).toContain('| 稳定时：显示的瓦片 够细 / 放宽了才停在这一级 / 等更细的 / 已是最细（块） | 5 / 0 / 0 / 0（另有 ADD 的 7 块不分） |');
    expect(report).toContain('| 加载到稳定：放宽的帧 装满 / 估计 | 3 / 11 |');
  });

  it('需求低于上限、锁着不再判成"锁在粗的一级"：放宽以后缓存在上限停止接收，看不出放不放得下；放宽的原因指到各段的那几行', () => {
    // 带飞行后的轨迹，飞行后的表格和它的说明才会出来
    const locked: RunResult = {
      ...coarse(true),
      settle: { stable: true, ms: 900, longTasks: LONG_TASKS, trace: [sample(0, 0, 30), sample(3500, 12, 0)] }
    };
    const report = renderReport(results([locked], [TILESET_SCENE]));
    expect(report).toContain('**飞行后显示的瓦片（第一遍）：**');
    expect(report).not.toContain('锁在了粗的一级');
    expect(report).not.toContain('需求又低于上限');
    // 放宽会一直带下去：要从加载到稳定看起；段与段之间的空档不在任何一行里
    expect(report).toContain('第一遍飞行之后要从"加载到稳定"看起，加上"第一遍飞行""飞行后"');
    expect(report).toContain('第二遍飞行之后再加"第二遍飞行""画面恢复"');
    expect(report).toContain('段与段之间的空档不在任何一行里');
    expect(report).toContain('细一级放不放得下看更大一档');
  });

  it('飞行后、画面恢复各一行放宽的原因：只数那一段新增的', () => {
    const recovered: RunResult = {
      ...tilesetRun('maplibre'),
      settle: { stable: true, ms: 900, longTasks: LONG_TASKS, trace: [budgetAt(0, 2, 0), budgetAt(800, 2, 5)] },
      recovery: { stable: true, ms: 700, longTasks: LONG_TASKS, trace: [budgetAt(0, 4, 5), budgetAt(600, 9, 8)] }
    };
    const report = renderReport(results([recovered], [TILESET_SCENE]));
    expect(report).toContain('| 飞行后：窗口（秒，中位）/ 放宽的帧 装满 / 估计 | — / 0 / 5 |');
    expect(report).toContain('| 画面恢复：窗口（秒，中位）/ 放宽的帧 装满 / 估计 | — / 5 / 3 |');
  });

  it('飞行后显示的瓦片：每个时刻放宽了的、等着的块数；有 ADD 的写在后面', () => {
    const settled: RunResult = {
      ...tilesetRun('maplibre'),
      settle: { stable: true, ms: 900, longTasks: LONG_TASKS, trace: [sample(0, 0, 30), sample(400, 7, 2), sample(3500, 9, 0)] }
    };
    const report = renderReport(results([settled], [TILESET_SCENE]));
    expect(report).toContain('**飞行后显示的瓦片（第一遍）：**');
    // 0、0.25 秒还是第一份，0.5～3 秒是 0.4 秒那份，最后是 3.5 秒那份
    expect(report).toContain('| MapLibre | 0 / 30 | 0 / 30 | 7 / 2 | 7 / 2 | 7 / 2 | 7 / 2 | 7 / 2 | 9 / 0 |');
    const additive = { ...sample(0, 1, 2), detail: { sharp: 0, relaxed: 1, waiting: 2, finest: 0, additive: 4 } };
    const withAdd: RunResult = { ...tilesetRun('maplibre'), settle: { stable: true, ms: 900, longTasks: LONG_TASKS, trace: [additive] } };
    expect(renderReport(results([withAdd], [TILESET_SCENE]))).toContain('| MapLibre | 1 / 2，ADD 4 |');
  });

  it('缓存上限的一档：和产品默认值比的清晰度写进检查一节，人工检查多一项', () => {
    const runs = [tilesetRun('maplibre'), tilesetRun(TIER), qualityRun(), qualityRun(TIER_SHOTS, TIER)];
    const report = renderReport(results(runs, [TIER_SCENE], [COMPARED, TIER_COMPARED]));
    expect(report).toContain('**飞一圈回来的清晰度（和飞行前比）：** 比了 120 格');
    expect(report).toContain('**产品默认值和MapLibre，缓存上限 6 GB比（稳定后同一相机，低于 1 是默认值在那里更糊）：** 比了 100 格，中位数 0.91，最差 10% 0.72，最差一格 0.65');
    expect(report).toContain('| 指标 | MapLibre | MapLibre，缓存上限 6 GB |');
    expect(renderManual(results(runs, [TIER_SCENE]))).toContain('| 缓存上限的各档 |');
    expect(renderManual(results([tilesetRun('maplibre'), qualityRun()], [TILESET_SCENE]))).not.toContain('缓存上限的各档');
  });

  it('有一边不正常时不比，报告里按状态写出两边：超时是没稳定，无效、失败另外说', () => {
    const timedOut: RunResult = { ...qualityRun(), status: 'timeout' };
    const runs = [tilesetRun('maplibre'), tilesetRun(TIER), timedOut, qualityRun(TIER_SHOTS, TIER)];
    const report = renderReport(results(runs, [TIER_SCENE]));
    expect(report).toContain('**飞一圈回来的清晰度（和飞行前比）：** 这一遍超时（等稳定超过了时限），截图不一定是稳定后的，没比');
    expect(report).toContain('默认值那一遍超时（等稳定超过了时限），截图不一定是稳定后的；这一档正常。没比');
    const invalid: RunResult = { ...qualityRun(TIER_SHOTS, TIER), status: 'invalid' };
    const invalidReport = renderReport(results([tilesetRun('maplibre'), qualityRun(), invalid], [TIER_SCENE]));
    expect(invalidReport).toContain('这一档无效（画面空白或模型没画出来');
    expect(invalidReport).not.toContain('这一档超时');
    // 失败的那一遍没有截图：没有画质的结果
    const failed: RunResult = { id: 'oblique-z19/maplibre/quality', scene: 'oblique-z19', variant: 'maplibre', kind: 'quality', repeat: 0, status: 'failed', notes: [] };
    expect(renderReport(results([failed, qualityRun(TIER_SHOTS, TIER)], [TIER_SCENE]))).toContain('默认值那一遍失败，可能没有截图；这一档正常。没比');
  });

  it('两种场景一起跑：三维实测的报告，多一节泼溅', () => {
    const filled = run('maplibre-splat3m', SPLATS);
    const scenes = [TILESET_SCENE, SPLAT_SCENE];
    const report = renderReport(results([...tilesetRuns, filled], scenes));
    expect(report).toContain('# 三维实测（MapLibre 引擎）');
    expect(report).toContain('## 检查');
    expect(report).toContain('## 高斯泼溅的预算');
    const manual = renderManual(results([...tilesetRuns, filled], scenes));
    expect(manual).toContain('quality.html');
    expect(manual).toContain('/dev/splat-watch');
  });

  it('报告、人工检查和截图页都不再提别的引擎', () => {
    const all = results([...tilesetRuns, run('maplibre-splat3m', SPLATS)], [TILESET_SCENE, SPLAT_SCENE], [COMPARED]);
    for (const text of [renderReport(all), renderManual(all), renderQualityPage(all)]) {
      expect(text).not.toMatch(/cesium/i);
    }
  });

  it('定位后放大一级：首屏、放大后、移开再移回各一行，放大后比移回来粗而且放大这一步按估计放宽了才判成按估计锁粗', () => {
    const runs = [tilesetRun('maplibre'), tilesetRun(TIER), zoomRun(12, 8)];
    const report = renderReport(results(runs, [TIER_SCENE]));
    expect(report).toContain('**定位后放大一级（--zoom-in）：**');
    expect(report).toContain('| 指标 | MapLibre，缓存上限 6 GB |');
    // 放宽的帧是累计的：放大后只数放大以后新增的，移开再移回只数移开以后新增的
    expect(report).toContain('| 首屏：屏幕误差，锁定，放宽的帧 装满 / 估计（加载到稳定） | 9.4，锁定，0 / 3 |');
    expect(report).toContain('| 放大后：屏幕误差，锁定，放宽的帧 装满 / 估计（放大以后新增） | 12.0，锁定，0 / 4 |');
    expect(report).toContain('| 放大后：需求 / 缓存上限 / 缓存（MB） | 3,000 / 4,096 / 2,500 |');
    expect(report).toContain('| 移开再移回：屏幕误差，锁定，放宽的帧 装满 / 估计（移开以后新增） | 8.0，没锁，0 / 0 |');
    expect(report).toContain('| 放大后按估计放宽锁粗了吗 | **是：放大这一步按估计放宽了，比移开再移回的粗** |');
    const verdictOf = (zoom: RunResult) => renderReport(results([tilesetRun('maplibre'), zoom], [TIER_SCENE]));
    expect(verdictOf(zoomRun(8.2, 8))).toContain('| 放大后按估计放宽锁粗了吗 | 否 |');
    // 粗了，但放大这一步只有装满的放宽：不说成估计的问题
    const full = verdictOf(zoomRun(12, 8, { raisedFull: 5, raisedPredicted: 3 }));
    expect(full).toContain('| 放大后：屏幕误差，锁定，放宽的帧 装满 / 估计（放大以后新增） | 12.0，锁定，5 / 0 |');
    expect(full).toContain('| 放大后按估计放宽锁粗了吗 | 比移开再移回的粗，但放大这一步没有按估计放宽：不是估计的问题，看"放宽的帧 装满"和需求 |');
    expect(verdictOf(zoomRun(12, null))).toContain('| 放大后按估计放宽锁粗了吗 | 算不出（放大或移回没有读数） |');
    // 放大那一步没做完（这一遍中途失败）：前面的读数照样写
    const unfinished = zoomRun(12, null);
    const failed: RunResult = { ...unfinished, status: 'failed', zoom: unfinished.zoom && { ...unfinished.zoom, zoomed: null } };
    const failedReport = verdictOf(failed);
    expect(failedReport).toContain('| 首屏：屏幕误差，锁定，放宽的帧 装满 / 估计（加载到稳定） | 9.4，锁定，0 / 3 |');
    expect(failedReport).toContain('| 放大后：屏幕误差，锁定，放宽的帧 装满 / 估计（放大以后新增） | — |');
    // 没跑 --zoom-in 时没有这一节
    expect(renderReport(results([tilesetRun('maplibre')], [TIER_SCENE]))).not.toContain('定位后放大一级');
  });

  it('每一级瓦片的实际大小：取完成次数最多的那份读数，模型写目录名', () => {
    const early: RunResult = { ...tilesetRun('maplibre'), atStable: { ...stats(null), levels: [level(2, 3, 20)] } };
    const later: RunResult = { ...tilesetRun(TIER), atRecovered: { ...stats(null), levels: [level(2, 9, 21.5), level(3, 120, 4.25)] } };
    const report = renderReport(results([early, later], [TIER_SCENE]));
    expect(report).toContain('**每一级瓦片的实际大小：**');
    expect(report).toContain('| 经开区 | 2 | 9 | 21.50 |');
    expect(report).toContain('| 经开区 | 3 | 120 | 4.25 |');
    expect(report).not.toContain('| 经开区 | 2 | 3 |');
    expect(renderReport(results([tilesetRun('maplibre')], [TILESET_SCENE]))).not.toContain('每一级瓦片的实际大小');
  });

  it('加载中需求最高的那一刻：需求、还要加载的、在用和在路上的块，那时完成的层写在每一级的大小下面', () => {
    const peakStats: BenchStats = {
      ...stats(null),
      queues: { downloading: 420, parsing: 5, culled: 0, used: 840, usedOutOfView: 50 },
      budget: { ...stats(null).budget, demandMB: 9200, pendingMB: 8100 },
      levels: [level(1, 3, 25.5), level(2, 12, 7.7)]
    };
    const loaded: RunResult = {
      ...tilesetRun('maplibre'),
      load: { stable: true, ttStableMs: 13000, ttFromNavigationMs: 14000, longTasks: LONG_TASKS, peak: { t: 2500, stats: peakStats } },
      atRecovered: { ...stats(null), levels: [level(1, 3, 25.5), level(2, 120, 7.7), level(3, 700, 3.1)] }
    };
    const report = renderReport(results([loaded], [TILESET_SCENE]));
    expect(report).toContain('| 加载中需求最高时：需求 / 其中还要加载的（MB），在用 / 下载中 / 解析中（块），离开始加载（秒） | 9,200 / 8,100，840 / 420 / 5，2.5 |');
    expect(report).toContain(
      '**产品默认值加载中需求最高时（离开始加载 2.5 秒，需求 9,200 MB、其中还要加载的 8,100 MB）完成的层：** 经开区 第 1 层 3 块、平均 25.50 MB；经开区 第 2 层 12 块、平均 7.70 MB。'
    );
    // 没有读数时（旧的结果）这一行是横线，也没有那一句
    const old = renderReport(results([tilesetRun('maplibre')], [TILESET_SCENE]));
    expect(old).toContain('| 加载中需求最高时：需求 / 其中还要加载的（MB），在用 / 下载中 / 解析中（块），离开始加载（秒） | — |');
    expect(old).not.toContain('产品默认值加载中需求最高时');
  });

  it('还没跑完一遍时也写得出报告', () => {
    expect(() => renderReport(results([], [TILESET_SCENE]))).not.toThrow();
    expect(() => renderReport(results([]))).not.toThrow();
  });
});

describe('quality.html', () => {
  it('比过的场景：飞行前后并排，比值、热力图和最差几格', () => {
    const page = renderQualityPage(results([qualityRun()], [TILESET_SCENE], [COMPARED]));
    expect(page).toContain('<h2>倾斜摄影 z19</h2>');
    expect(page).toContain('比了 120 格，中位数 <b>1.01</b>，最差 10% <b>0.96</b>');
    expect(page).toContain(`src="${SHOTS.shot}"`);
    expect(page).toContain(`src="${SHOTS.shotAfterFlight}"`);
    expect(page).toContain(`src="${COMPARED.afterFlight?.heatmap}"`);
    expect(page).toContain(`src="${COMPARED.afterFlight?.worstCrops}"`);
    expect(page).not.toContain('和产品默认值比');
  });

  it('缓存上限的一档单独一节：产品默认值和这一档稳定后的截图并排，热力图画在默认值那张上', () => {
    const page = renderQualityPage(
      results([qualityRun(), qualityRun(TIER_SHOTS, TIER)], [TIER_SCENE], [COMPARED, TIER_COMPARED])
    );
    expect(page).toContain('<h2>倾斜摄影 z19</h2>');
    expect(page).toContain('<h2>倾斜摄影 z19，MapLibre，缓存上限 6 GB</h2>');
    const tier = page.slice(page.indexOf('缓存上限 6 GB</h2>'));
    expect(tier).toContain('<h3>和产品默认值比（同一相机）</h3>');
    expect(tier).toContain('比了 100 格，中位数 <b>0.91</b>，最差 10% <b>0.72</b>，低于 1 是默认值在那里更糊');
    expect(tier).toContain(`src="${SHOTS.shot}"`);
    expect(tier).toContain(`src="${TIER_SHOTS.shot}"`);
    expect(tier).toContain(`src="${TIER_COMPARED.versusDefault?.heatmap}"`);
    // 这一档飞行前后还没比
    expect(tier).toContain('没有比较结果');
  });

  it('定位后放大一级：放大后和移开再移回的两张并排，说明里写屏幕误差和锁定', () => {
    const page = renderQualityPage(results([qualityRun(), zoomRun(12, 8)], [TIER_SCENE]));
    const zoom = page.slice(page.indexOf('<h1>定位后放大一级</h1>'));
    expect(zoom).toContain('<h2>倾斜摄影 z19，MapLibre，缓存上限 6 GB：定位后放大一级</h2>');
    expect(zoom).toContain('<figcaption>放大后：屏幕误差 12.0，锁定</figcaption>');
    expect(zoom).toContain('<figcaption>移开再移回：屏幕误差 8.0</figcaption>');
    expect(zoom).toContain('src="shots/oblique-z19__maplibre-cache6g__zoom-nudged.png"');
    expect(renderQualityPage(results([qualityRun()], [TIER_SCENE]))).not.toContain('定位后放大一级');
  });

  it('有一边不正常：按状态写出、不比，截图的说明不写"稳定后"', () => {
    const page = renderQualityPage(results([qualityRun(), { ...qualityRun(TIER_SHOTS, TIER), status: 'timeout' }], [TIER_SCENE]));
    const tier = page.slice(page.indexOf('缓存上限 6 GB</h2>'));
    expect(tier).toContain('这一遍超时（等稳定超过了时限），截图不一定是稳定后的，不比较');
    expect(tier).toContain('默认值那一遍正常；这一档超时（等稳定超过了时限），截图不一定是稳定后的。不比较');
    expect(tier).toContain('<figcaption>这一档，不一定稳定（超时）</figcaption>');
    expect(tier).toContain('<figcaption>产品默认值，稳定后</figcaption>');
    // 无效的不说超时、不说没稳定
    const invalidPage = renderQualityPage(results([qualityRun(), { ...qualityRun(TIER_SHOTS, TIER), status: 'invalid' }], [TIER_SCENE]));
    const invalidTier = invalidPage.slice(invalidPage.indexOf('缓存上限 6 GB</h2>'));
    expect(invalidTier).toContain('<figcaption>这一档，无效</figcaption>');
    expect(invalidTier).toContain('这一遍无效（画面空白或模型没画出来');
    expect(invalidTier).not.toContain('等稳定超过了时限');
    expect(invalidTier).not.toContain('不一定稳定');
    // 默认值那一遍失败、没有截图：只放这一档的
    const failed: RunResult = { id: 'oblique-z19/maplibre/quality', scene: 'oblique-z19', variant: 'maplibre', kind: 'quality', repeat: 0, status: 'failed', notes: [] };
    const failedPage = renderQualityPage(results([failed, qualityRun(TIER_SHOTS, TIER)], [TIER_SCENE]));
    expect(failedPage).toContain('默认值那一遍失败，可能没有截图；这一档正常。不比较');
    expect(failedPage).not.toContain('<figcaption>产品默认值');
    // 默认值那一节自己也留一行说明；只有它、它又失败了，不能显示成"还没有结果"
    expect(failedPage).toContain('<h2>倾斜摄影 z19</h2>\n<p>画质这一遍失败，没有截图，原因见 report.md');
    const onlyFailed = renderQualityPage(results([failed], [TILESET_SCENE]));
    expect(onlyFailed).not.toContain('还没有结果');
    expect(onlyFailed).toContain('画质这一遍失败');
  });

  it('还没比较时先放截图', () => {
    const page = renderQualityPage(results([qualityRun()], [TILESET_SCENE]));
    expect(page).toContain('没有比较结果');
    expect(page).toContain(`src="${SHOTS.shotAfterFlight}"`);
    expect(page).not.toContain('heatmap');
  });

  it('飞一圈回来没有稳定：只放稳定后的那张', () => {
    const page = renderQualityPage(results([qualityRun({ ...SHOTS, shotAfterFlight: null })], [TILESET_SCENE]));
    expect(page).toContain('飞一圈回来没有稳定');
    expect(page).toContain(`src="${SHOTS.shot}"`);
  });

  it('只有泼溅场景：没有画质那一遍', () => {
    expect(renderQualityPage(results([run('maplibre-splat3m', SPLATS)]))).toContain('还没有结果');
  });
});
