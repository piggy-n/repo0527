// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { BenchStats, SplatReadings } from './bench-api.ts';
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

function results(runs: RunResult[]): MeasureResults {
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
    scenes: [{ id: 'splat-pc-z18', title: '彭城广场 LCC2 z18', acceptance: false, splat: true, variants: ['maplibre-splat3m', 'maplibre-splat10m'] }],
    variants: [
      { id: 'cesium', label: 'Cesium' },
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

  it('人工检查只列泼溅要看的', () => {
    const manual = renderManual(results([filled]));
    expect(manual).toContain('/dev/splat-watch');
    expect(manual).toContain('亮处偏白');
    expect(manual).not.toContain('不比 Cesium 糊');
  });
});
