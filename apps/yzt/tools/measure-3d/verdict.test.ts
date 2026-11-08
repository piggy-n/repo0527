// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { BenchStats, PhaseResult } from './bench-api.ts';
import type { RunResult, SceneQuality } from './results.ts';
import { allPassed, median, sceneVerdict } from './verdict.ts';

const STATS: BenchStats = {
  tilesVisible: 30,
  triangles: 500000,
  cacheMB: 600,
  errorTarget: 16,
  refused: 0,
  loaded: 40,
  unloaded: 0,
  failed: 0,
  loading: 0,
  uploadPending: 0,
  uploadedMB: 0,
  locked: false
};

const LONG_TASKS = { count: 1, maxMs: 80, totalMs: 80, over100: 0, over200: 0, over500: 0 };

function phase(p50: number, p95: number, p99: number, over50 = 0): PhaseResult {
  const summary = { samples: 100, mean: p50, p50, p95, p99, max: p99 };
  return {
    durationMs: 15000,
    frames: 100,
    renders: 100,
    interval: summary,
    js: summary,
    gpu: summary,
    work: summary,
    gpuUnavailable: null,
    fenceTimeouts: 0,
    over: { ms33: over50, ms50: over50, ms100: 0, ms200: 0 },
    longTasks: LONG_TASKS,
    uploads: { textureMB: 0, bufferMB: 0, mipmaps: 0, framesWithUpload: 0, maxFrameMB: 0, buckets: [] }
  };
}

function perf(variant: string, overrides: Partial<RunResult> = {}, repeat = 0): RunResult {
  return {
    id: `s/${variant}/perf-${repeat + 1}`,
    scene: 's',
    variant,
    kind: 'perf',
    repeat,
    status: 'ok',
    notes: [],
    load: { stable: true, ttStableMs: 5000, ttFromNavigationMs: 6000, longTasks: LONG_TASKS },
    atStable: STATS,
    flightCold: phase(10, 20, 30),
    flightWarm: phase(8, 15, 20),
    settle: { stable: true, ms: 2000, longTasks: LONG_TASKS },
    ...overrides
  };
}

function qualityRun(variant: string, loaded = 0, events = 0): RunResult {
  return {
    id: `s/${variant}/quality`,
    scene: 's',
    variant,
    kind: 'quality',
    repeat: 0,
    status: 'ok',
    notes: [],
    quality: {
      shot: 'a.png',
      shotWithoutModel: 'b.png',
      shotAfterFlight: null,
      hold: { seconds: 30, loaded, unloaded: 0, blurEvents: Array.from({ length: events }, (_, index) => ({ index, share: 0.5 })) }
    }
  };
}

const QUALITY: SceneQuality = {
  scene: 's',
  stable: { cells: 100, medianRatio: 1, worstDecileRatio: 0.95, ratios: [] },
  afterFlight: null,
  heatmap: 'h.png',
  worstCrops: 'c.png',
  subject: 'a.png',
  reference: 'b.png'
};

const load = (ttStableMs: number) => ({ stable: true, ttStableMs, ttFromNavigationMs: 0, longTasks: LONG_TASKS });
const settle = (ms: number) => ({ stable: true, ms, longTasks: LONG_TASKS });
const passing = () => [perf('maplibre'), perf('cesium'), qualityRun('maplibre'), qualityRun('cesium')];
const rowOf = (rows: ReturnType<typeof sceneVerdict>, text: string) => {
  const row = rows.find(item => item.condition.includes(text));
  if (!row) {
    throw new Error(`没有这一项：${text}`);
  }
  return row;
};

describe('sceneVerdict', () => {
  it('两边一样时全部通过', () => {
    const rows = sceneVerdict(passing(), QUALITY);
    expect(rows.filter(row => row.pass !== true)).toEqual([]);
    expect(allPassed(rows)).toBe(true);
  });

  it('被拒绝的瓦片：不是 0 就不通过', () => {
    const rows = sceneVerdict([perf('maplibre', { atStable: { ...STATS, refused: 3 } }), perf('cesium')], QUALITY);
    expect(rowOf(rows, '被拒绝').pass).toBe(false);
  });

  it('三角形不足 90% 不通过：不能靠降低画质换帧率', () => {
    const rows = sceneVerdict([perf('maplibre', { atStable: { ...STATS, triangles: 440000 } }), perf('cesium')], QUALITY);
    expect(rowOf(rows, '三角形').pass).toBe(false);
  });

  it('到稳定：1.2 倍以内通过，超过不通过', () => {
    const within = sceneVerdict([perf('maplibre', { load: load(6000) }), perf('cesium')], QUALITY);
    expect(rowOf(within, '到稳定').pass).toBe(true);
    const beyond = sceneVerdict([perf('maplibre', { load: load(6100) }), perf('cesium')], QUALITY);
    expect(rowOf(beyond, '到稳定').pass).toBe(false);
  });

  it('飞行后补齐：差一次查询间隔以内不算慢', () => {
    const close = sceneVerdict([perf('maplibre', { settle: settle(100) }), perf('cesium', { settle: settle(0) })], QUALITY);
    expect(rowOf(close, '飞行后补齐').pass).toBe(true);
    const slower = sceneVerdict([perf('maplibre', { settle: settle(1000) }), perf('cesium', { settle: settle(500) })], QUALITY);
    expect(rowOf(slower, '飞行后补齐').pass).toBe(false);
  });

  it('帧时间：比 p50、p95、p99，两遍飞行分开算', () => {
    const rows = sceneVerdict([perf('maplibre', { flightCold: phase(10, 20, 40) }), perf('cesium')], QUALITY);
    expect(rowOf(rows, '第一遍飞行每帧工作量 p99').pass).toBe(false);
    expect(rowOf(rows, '第一遍飞行每帧工作量 p95').pass).toBe(true);
    expect(rowOf(rows, '第二遍飞行每帧工作量 p99').pass).toBe(true);
  });

  it('≥50 毫秒的帧不多于 Cesium', () => {
    const rows = sceneVerdict([perf('maplibre', { flightCold: phase(10, 20, 30, 3) }), perf('cesium', { flightCold: phase(10, 20, 30, 2) })], QUALITY);
    expect(rowOf(rows, '第一遍飞行≥50').pass).toBe(false);
  });

  it('清晰度低于 0.93 不通过', () => {
    const blurry: SceneQuality = { ...QUALITY, stable: { ...QUALITY.stable, worstDecileRatio: 0.9 } };
    expect(rowOf(sceneVerdict(passing(), blurry), '清晰度').pass).toBe(false);
  });

  it('静止观察期间还在加载、卸载：来回折腾，不通过', () => {
    const rows = sceneVerdict([perf('maplibre'), perf('cesium'), qualityRun('maplibre', 12), qualityRun('cesium')], QUALITY);
    expect(rowOf(rows, '没有瓦片加载').pass).toBe(false);
  });

  it('画面变糊的次数比 Cesium 多不通过', () => {
    const rows = sceneVerdict([perf('maplibre'), perf('cesium'), qualityRun('maplibre', 0, 2), qualityRun('cesium', 0, 1)], QUALITY);
    expect(rowOf(rows, '变糊').pass).toBe(false);
  });

  it('多遍取中位数，失败的不算', () => {
    const runs = [
      perf('maplibre', { load: load(5000) }, 0),
      perf('maplibre', { load: load(5500) }, 1),
      perf('maplibre', { load: load(99000), status: 'failed' }, 2),
      perf('cesium')
    ];
    expect(rowOf(sceneVerdict(runs, QUALITY), '到稳定').subject).toBe(5250);
  });

  it('缺数据时算不出来，也不算通过', () => {
    const rows = sceneVerdict([perf('maplibre')], undefined);
    expect(rowOf(rows, '到稳定').pass).toBeNull();
    expect(rowOf(rows, '清晰度').pass).toBeNull();
    expect(allPassed(rows)).toBe(false);
  });
});

describe('median', () => {
  it('忽略空值和 NaN', () => {
    expect(median([3, null, 1, undefined, Number.NaN, 2])).toBe(2);
    expect(median([1, 2])).toBe(1.5);
    expect(median([])).toBeNull();
  });
});
