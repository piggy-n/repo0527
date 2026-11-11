// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { BenchStats, PhaseResult, SplatReadings } from './bench-api.ts';
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
  locked: false,
  queues: { downloading: 0, parsing: 0, culled: 0, used: 0, usedOutOfView: 0 },
  budget: { demandMB: 0, pendingMB: 0, culledMB: 0, raisedFull: 0, raisedPredicted: 0, cullWindow: null },
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

const qualityRun = (shots: QualityResult = SHOTS): RunResult => ({
  id: 'oblique-z19/maplibre/quality',
  scene: 'oblique-z19',
  variant: 'maplibre',
  kind: 'quality',
  repeat: 0,
  status: 'ok',
  notes: [],
  quality: shots
});

const COMPARED: SceneQuality = {
  scene: 'oblique-z19',
  afterFlight: { cells: 120, medianRatio: 1.01, worstDecileRatio: 0.96, ratios: [1, null, 0.88, 1.02] },
  heatmap: 'shots/oblique-z19-heatmap.png',
  worstCrops: 'shots/oblique-z19-worst.png'
};

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
      { id: 'maplibre-splat10m', label: 'MapLibre，泼溅预算 1,000 万' }
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
    expect(page).toContain(`src="${COMPARED.heatmap}"`);
    expect(page).toContain(`src="${COMPARED.worstCrops}"`);
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
