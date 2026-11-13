// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { BenchStats, SceneSample, PhaseResult } from './bench-api.ts';
import type { RunResult } from './results.ts';
import { allPassed, fillSampleAt, machineDrift, median, sceneChecks } from './verdict.ts';

const QUEUES = { downloading: 0, parsing: 0, culled: 0, used: 30, usedOutOfView: 0 };
const DETAIL = { sharp: 30, relaxed: 0, waiting: 0, finest: 0, additive: 0 };
const BUDGET = { limitMB: 2048, demandMB: 600, pendingMB: 0, culledMB: 0, raisedFull: 0, raisedPredicted: 0, cullWindow: 0.5 };

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
  releasedMB: 0,
  locked: false,
  detail: DETAIL,
  queues: QUEUES,
  budget: BUDGET,
  levels: [],
  splats: null
};

const LONG_TASKS = { count: 1, maxMs: 80, totalMs: 80, over100: 0, over200: 0, over500: 0, contextMs: 0, maxWithoutContextMs: 80 };

const fillSample = (t: number, triangles: number): SceneSample => ({
  t,
  tiles: 60,
  triangles,
  errorTarget: 30,
  loading: 0,
  uploadPending: 0,
  cacheMB: 1300,
  loaded: 100,
  locked: false,
  detail: DETAIL,
  queues: QUEUES,
  budget: BUDGET,
  splats: null
});

function phase(p50: number): PhaseResult {
  const summary = { samples: 100, mean: p50, p50, p95: p50, p99: p50, max: p50 };
  return {
    endedAt: 20000,
    durationMs: 15000,
    frames: 100,
    renders: 100,
    interval: summary,
    js: summary,
    gpu: summary,
    work: summary,
    gpuUnavailable: null,
    fenceTimeouts: 0,
    over: { ms33: 0, ms50: 0, ms100: 0, ms200: 0 },
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
    ...overrides
  };
}

function qualityRun(variant: string, loaded = 0, unloaded = 0): RunResult {
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
      hold: { seconds: 30, loaded, unloaded, blurEvents: [] }
    }
  };
}

const refused = (count: number) => ({ atStable: { ...STATS, refused: count } });
const rowOf = (rows: ReturnType<typeof sceneChecks>, text: string) => {
  const row = rows.find(item => item.condition.includes(text));
  if (!row) {
    throw new Error(`没有这一项：${text}`);
  }
  return row;
};

describe('sceneChecks', () => {
  it('没有被拒绝的瓦片、静止时不来回加载：全部通过', () => {
    const rows = sceneChecks([perf('maplibre'), qualityRun('maplibre')]);
    expect(rows.filter(row => row.pass !== true)).toEqual([]);
    expect(allPassed(rows)).toBe(true);
  });

  it('被拒绝的瓦片：不是 0 就不通过', () => {
    const rows = sceneChecks([perf('maplibre', refused(3)), qualityRun('maplibre')]);
    expect(rowOf(rows, '被拒绝').pass).toBe(false);
    expect(rowOf(rows, '被拒绝').value).toBe(3);
    expect(allPassed(rows)).toBe(false);
  });

  it('静止观察期间还在加载、卸载：来回折腾，不通过', () => {
    const rows = sceneChecks([perf('maplibre'), qualityRun('maplibre', 12, 4)]);
    expect(rowOf(rows, '没有瓦片加载').pass).toBe(false);
    expect(rowOf(rows, '没有瓦片加载').value).toBe(16);
  });

  it('多遍取中位数，失败和无效的不算', () => {
    const runs = [
      perf('maplibre', refused(0), 0),
      perf('maplibre', refused(0), 1),
      perf('maplibre', { ...refused(9), status: 'failed' }, 2),
      perf('maplibre', { ...refused(9), status: 'invalid' }, 3),
      qualityRun('maplibre')
    ];
    expect(rowOf(sceneChecks(runs), '被拒绝').pass).toBe(true);
  });

  it('只看产品的默认值：对照方案本来就可能放不下', () => {
    const rows = sceneChecks([perf('maplibre'), perf('maplibre-up16', refused(5)), qualityRun('maplibre')]);
    expect(rowOf(rows, '被拒绝').pass).toBe(true);
  });

  it('缺数据时算不出来，也不算通过', () => {
    const rows = sceneChecks([perf('maplibre')]);
    expect(rowOf(rows, '被拒绝').pass).toBe(true);
    expect(rowOf(rows, '没有瓦片加载').pass).toBeNull();
    expect(allPassed(rows)).toBe(false);
    expect(sceneChecks([]).every(row => row.pass === null)).toBe(true);
  });
});

describe('飞行后的过程', () => {
  const trace = [fillSample(0, 800), fillSample(100, 900), fillSample(200, 850), fillSample(300, 910), fillSample(400, 920)];

  it('某一刻的读数：那一刻之前最后一次记录', () => {
    expect(fillSampleAt(trace, 250)?.t).toBe(200);
    expect(fillSampleAt(trace, 9999)?.t).toBe(400);
    expect(fillSampleAt([fillSample(0.1, 800)], 0)?.triangles).toBe(800);
    expect(fillSampleAt([], 0)).toBeNull();
  });
});

const staticJs = (variant: string, p50: number, scene = 's'): RunResult => ({
  ...perf(variant),
  scene,
  static: phase(p50)
});

describe('machineDrift', () => {
  it('同一个场景比；各个对照方案静止时工作量相同，算一组', () => {
    expect(machineDrift([staticJs('maplibre', 2), staticJs('maplibre-up16', 5), staticJs('maplibre-no-budget', 3)])).toBe(2.5);
  });

  it('场景不同的不比：工作量本来就不同', () => {
    expect(machineDrift([staticJs('maplibre', 2, 'a'), staticJs('maplibre', 9, 'b')])).toBeNull();
  });

  it('泼溅的预算不同，画的就不同：每个预算各算一组', () => {
    expect(machineDrift([staticJs('maplibre-splat3m', 2), staticJs('maplibre-splat10m', 8)])).toBeNull();
    expect(machineDrift([staticJs('maplibre-splat3m', 2), staticJs('maplibre-splat3m', 2.4), staticJs('maplibre-splat10m', 8)])).toBeCloseTo(1.2);
  });

  it('缓存上限不同，静止时画的就不同（大的放宽得少）：每一档各算一组，不和默认值比', () => {
    expect(machineDrift([staticJs('maplibre', 2), staticJs('maplibre-cache6g', 4)])).toBeNull();
    expect(machineDrift([staticJs('maplibre', 2), staticJs('maplibre-cache6g', 4), staticJs('maplibre-cache6g', 4.4)])).toBeCloseTo(1.1);
  });

  it('释放贴图的对照和它的方案画的一样：算一组', () => {
    expect(machineDrift([staticJs('maplibre-cache6g', 4), staticJs('maplibre-cache6g-release', 5)])).toBeCloseTo(1.25);
    expect(machineDrift([staticJs('maplibre', 2), staticJs('maplibre-release', 3)])).toBeCloseTo(1.5);
    expect(machineDrift([staticJs('maplibre', 2), staticJs('maplibre-cache6g-release', 4)])).toBeNull();
  });

  it('取最不稳定的一组', () => {
    expect(machineDrift([staticJs('maplibre', 4, 'a'), staticJs('maplibre', 4.4, 'a'), staticJs('maplibre', 2, 'b'), staticJs('maplibre', 3, 'b')])).toBe(1.5);
  });

  it('画质和采样那几遍不算：它们没有静止段', () => {
    expect(machineDrift([qualityRun('maplibre')])).toBeNull();
  });
});

describe('median', () => {
  it('忽略空值和 NaN', () => {
    expect(median([3, null, 1, undefined, Number.NaN, 2])).toBe(2);
    expect(median([1, 2])).toBe(1.5);
    expect(median([])).toBeNull();
  });
});
