// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { BenchStats, PhaseResult, SplatReadings } from './bench-api.ts';
import { renderManual, renderReport, splatFill } from './report.ts';
import type { MeasureResults, RunResult } from './results.ts';

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

const stats = (splats: SplatReadings | null): BenchStats => ({
  tilesVisible: 0,
  triangles: 0,
  cacheMB: 0,
  errorTarget: 8,
  refused: 0,
  loaded: 0,
  unloaded: 0,
  failed: 0,
  loading: 0,
  uploadPending: 0,
  uploadedMB: 0,
  locked: false,
  queues: null,
  budget: null,
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

const SPLAT_SCENE = { id: 'splat-pc-z18', title: '彭城广场 LCC2 z18', acceptance: false, splat: true, variants: ['maplibre-splat3m', 'maplibre-splat10m'] };
const ENGINE_SCENE = { id: 'oblique-z19', title: '倾斜摄影 z19', acceptance: true, splat: false, variants: ['cesium', 'maplibre'] };

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
const engineRun = (variant: string): RunResult => ({ ...run(variant, SPLATS), id: `oblique-z19/${variant}/perf-1`, scene: 'oblique-z19', atStable: stats(null) });

function results(runs: RunResult[], scenes: MeasureResults['scenes'] = [SPLAT_SCENE]): MeasureResults {
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
      { id: 'cesium', label: 'Cesium' },
      { id: 'maplibre', label: 'MapLibre' },
      { id: 'maplibre-splat3m', label: 'MapLibre，泼溅预算 300 万' },
      { id: 'maplibre-splat10m', label: 'MapLibre，泼溅预算 1,000 万' }
    ],
    runs,
    quality: []
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

  it('只有泼溅场景时：标题换成 L.3，按预算并排，不和 Cesium 比、不出验收表', () => {
    const report = renderReport(results([filled, short]));
    expect(report).toContain('# 高斯泼溅的预算实测（ADR 0149 L.3）');
    expect(report).not.toContain('## 验收');
    expect(report).toContain('| 指标 | MapLibre，泼溅预算 300 万 | MapLibre，泼溅预算 1,000 万 |');
    expect(report).not.toContain('| Cesium');
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
    expect(manual).not.toContain('不比 Cesium 糊');
  });
});

describe('有瓦片集场景的报告（ADR 0147 的对比不受泼溅影响）', () => {
  const engineRuns = [engineRun('cesium'), engineRun('maplibre')];

  it('只有瓦片集：引擎对比的标题、验收和 Cesium 一列，人工检查看 quality.html', () => {
    const scenes = [ENGINE_SCENE];
    const report = renderReport(results(engineRuns, scenes));
    expect(report).toContain('# MapLibre 引擎和 Cesium 的实测（ADR 0147 3C.4）');
    expect(report).toContain('## 验收');
    expect(report).toContain('| 指标 | Cesium | MapLibre |');
    expect(report).not.toContain('## 高斯泼溅的预算');
    expect(renderManual(results(engineRuns, scenes))).toContain('quality.html');
  });

  it('两种场景一起跑：还是引擎对比的报告，多一节泼溅', () => {
    const filled = run('maplibre-splat3m', SPLATS);
    const scenes = [ENGINE_SCENE, SPLAT_SCENE];
    const report = renderReport(results([...engineRuns, filled], scenes));
    expect(report).toContain('# MapLibre 引擎和 Cesium 的实测（ADR 0147 3C.4）');
    expect(report).toContain('## 验收');
    expect(report).toContain('## 高斯泼溅的预算');
    const manual = renderManual(results([...engineRuns, filled], scenes));
    expect(manual).toContain('quality.html');
    expect(manual).toContain('/dev/splat-watch');
  });

  it('还没跑完一遍时也写得出报告', () => {
    expect(() => renderReport(results([], [ENGINE_SCENE]))).not.toThrow();
    expect(() => renderReport(results([]))).not.toThrow();
  });
});
