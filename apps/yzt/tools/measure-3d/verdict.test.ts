// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { BenchStats, SceneSample, PhaseResult } from './bench-api.ts';
import type { RunResult, SceneQuality } from './results.ts';
import { allPassed, fillReachedAt, fillSampleAt, machineDrift, median, sceneVerdict } from './verdict.ts';

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
  locked: false,
  queues: null,
  budget: null,
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
  queues: null,
  budget: null,
  splats: null
});

function phase(p50: number, p95: number, p99: number, over50 = 0, triangles = 500000): PhaseResult {
  const summary = { samples: 100, mean: p50, p50, p95, p99, max: p99 };
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
    over: { ms33: over50, ms50: over50, ms100: 0, ms200: 0 },
    longTasks: LONG_TASKS,
    uploads: { textureMB: 0, bufferMB: 0, mipmaps: 0, framesWithUpload: 0, maxFrameMB: 0, buckets: [] },
    trace: [fillSample(0, triangles)]
  };
}

const settle = (ms: number, trace: readonly SceneSample[] = [fillSample(0, 500000)]) => ({ stable: true, ms, longTasks: LONG_TASKS, trace });

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
    settle: settle(2000),
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
  stable: { cells: 100, medianRatio: 1, worstDecileRatio: 0.95, ratios: [1, null, 0.92] },
  afterFlight: null,
  heatmap: 'h.png',
  worstCrops: 'c.png',
  subject: 'a.png',
  reference: 'b.png'
};

const load = (ttStableMs: number) => ({ stable: true, ttStableMs, ttFromNavigationMs: 0, longTasks: LONG_TASKS });
const withLongTasks = (maxMs: number, maxWithoutContextMs: number) => ({ ...load(5000), longTasks: { ...LONG_TASKS, maxMs, maxWithoutContextMs } });
const passing =() => [perf('maplibre'), perf('cesium'), qualityRun('maplibre'), qualityRun('cesium')];
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
    expect(rowOf(rows, '稳定后显示的三角形').pass).toBe(false);
  });

  it('到稳定：1.2 倍以内通过，超过不通过', () => {
    const within = sceneVerdict([perf('maplibre', { load: load(6000) }), perf('cesium')], QUALITY);
    expect(rowOf(within, '到稳定').pass).toBe(true);
    const beyond = sceneVerdict([perf('maplibre', { load: load(6100) }), perf('cesium')], QUALITY);
    expect(rowOf(beyond, '到稳定').pass).toBe(false);
  });

  // Cesium 飞完停在 89.3 万不再补，MapLibre 继续细化到 97.6 万：补得久不等于画面差，看到同样的粗细用了多久
  const cesiumFill = settle(240, [fillSample(0, 895000), fillSample(200, 893000)]);

  it('飞行后：1 秒内到 Cesium 终点的 98%，之后继续细化花的时间不算', () => {
    const fill = settle(1246, [fillSample(0, 757000), fillSample(800, 880000), fillSample(1200, 976000)]);
    const rows = sceneVerdict([perf('maplibre', { settle: fill }), perf('cesium', { settle: cesiumFill })], QUALITY);
    expect(rowOf(rows, '秒内到 Cesium 终点').pass).toBe(true);
    expect(rowOf(rows, '秒内到 Cesium 终点').subject).toBe(800);
    expect(rowOf(rows, '飞行后终点').pass).toBe(true);
    expect(rowOf(rows, '飞行后终点').subject).toBe(976000);
    expect(rowOf(rows, '飞行后终点').reference).toBe(893000);
  });

  it('飞行后：超过 1 秒才到 Cesium 终点的 98% 不通过', () => {
    const fill = settle(1500, [fillSample(0, 757000), fillSample(1050, 880000), fillSample(1400, 976000)]);
    const rows = sceneVerdict([perf('maplibre', { settle: fill }), perf('cesium', { settle: cesiumFill })], QUALITY);
    expect(rowOf(rows, '秒内到 Cesium 终点').pass).toBe(false);
    expect(rowOf(rows, '秒内到 Cesium 终点').subject).toBe(1050);
  });

  it('飞行后：替换瓦片的中途回落过，看最后一次低于它之后', () => {
    const fill = settle(1500, [fillSample(0, 880000), fillSample(500, 800000), fillSample(1100, 900000)]);
    const rows = sceneVerdict([perf('maplibre', { settle: fill }), perf('cesium', { settle: cesiumFill })], QUALITY);
    expect(rowOf(rows, '秒内到 Cesium 终点').subject).toBe(1100);
    expect(rowOf(rows, '秒内到 Cesium 终点').pass).toBe(false);
  });

  it('飞行后：一直没到是不通过，不是缺数据', () => {
    const fill = settle(500, [fillSample(0, 700000), fillSample(400, 800000)]);
    const rows = sceneVerdict([perf('maplibre', { settle: fill }), perf('cesium', { settle: cesiumFill })], QUALITY);
    expect(rowOf(rows, '秒内到 Cesium 终点').pass).toBe(false);
    expect(rowOf(rows, '秒内到 Cesium 终点').subject).toBeNull();
    expect(rowOf(rows, '飞行后终点').pass).toBe(false);
  });

  it('飞行后：终点比 Cesium 少一点也不通过：到 98% 只说明时间，终点要不比 Cesium 粗', () => {
    const fill = settle(500, [fillSample(0, 880000), fillSample(400, 890000)]);
    const rows = sceneVerdict([perf('maplibre', { settle: fill }), perf('cesium', { settle: cesiumFill })], QUALITY);
    expect(rowOf(rows, '秒内到 Cesium 终点').pass).toBe(true);
    expect(rowOf(rows, '飞行后终点').pass).toBe(false);
  });

  it('飞行后：多遍取中位数，没到的一遍算最慢', () => {
    const reached = (t: number) => settle(1000, [fillSample(0, 700000), fillSample(t, 976000)]);
    const never = settle(1000, [fillSample(0, 700000)]);
    const cesium = perf('cesium', { settle: cesiumFill });
    const most = sceneVerdict([perf('maplibre', { settle: reached(800) }, 0), perf('maplibre', { settle: reached(900) }, 1), perf('maplibre', { settle: never }, 2), cesium], QUALITY);
    expect(rowOf(most, '秒内到 Cesium 终点').subject).toBe(900);
    expect(rowOf(most, '秒内到 Cesium 终点').pass).toBe(true);
    const few = sceneVerdict([perf('maplibre', { settle: reached(800) }, 0), perf('maplibre', { settle: never }, 1), perf('maplibre', { settle: never }, 2), cesium], QUALITY);
    expect(rowOf(few, '秒内到 Cesium 终点').pass).toBe(false);
  });

  it('飞行后：缺读数时算不出来，也不算通过', () => {
    const rows = sceneVerdict([perf('maplibre', { settle: settle(500, []) }), perf('cesium', { settle: cesiumFill })], QUALITY);
    expect(rowOf(rows, '秒内到 Cesium 终点').pass).toBeNull();
    expect(rowOf(rows, '飞行后终点').pass).toBeNull();
  });

  it('飞行中的三角形：中位数不足 Cesium 的 90% 不通过，两遍分开算', () => {
    const rows = sceneVerdict(
      [perf('maplibre', { flightWarm: phase(8, 15, 20, 0, 594000) }), perf('cesium', { flightCold: phase(10, 20, 30, 0, 500000), flightWarm: phase(8, 15, 20, 0, 786000) })],
      QUALITY
    );
    expect(rowOf(rows, '第一遍飞行三角形').pass).toBe(true);
    expect(rowOf(rows, '第二遍飞行三角形').pass).toBe(false);
    expect(rowOf(rows, '第二遍飞行三角形').subject).toBe(594000);
    expect(rowOf(rows, '第二遍飞行三角形').reference).toBe(786000);
  });

  it('飞行中的三角形：一遍飞行内取中位数，不看最低的一刻', () => {
    const flight = { ...phase(8, 15, 20), trace: [fillSample(0, 100000), fillSample(250, 500000), fillSample(500, 600000)] };
    const rows = sceneVerdict([perf('maplibre', { flightCold: flight }), perf('cesium')], QUALITY);
    expect(rowOf(rows, '第一遍飞行三角形').subject).toBe(500000);
    expect(rowOf(rows, '第一遍飞行三角形').pass).toBe(true);
  });

  it('加载期长任务：除去创建 WebGL 上下文再比，它只看驱动和机器', () => {
    const noisy = sceneVerdict([perf('maplibre', { load: withLongTasks(1172, 198) }), perf('cesium', { load: withLongTasks(742, 553) })], QUALITY);
    expect(rowOf(noisy, '加载期最长').pass).toBe(true);
    expect(rowOf(noisy, '加载期最长').subject).toBe(198);
    const heavy = sceneVerdict([perf('maplibre', { load: withLongTasks(700, 600) }), perf('cesium', { load: withLongTasks(1200, 553) })], QUALITY);
    expect(rowOf(heavy, '加载期最长').pass).toBe(false);
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

  it('局部糊了一块：最差 10% 看不出来，最差一格抓得到', () => {
    const local: SceneQuality = { ...QUALITY, stable: { ...QUALITY.stable, worstDecileRatio: 0.95, ratios: [1, 0.85, 0.89] } };
    const rows = sceneVerdict(passing(), local);
    expect(rowOf(rows, '最差 10% 的格子').pass).toBe(true);
    expect(rowOf(rows, '最差的一格').pass).toBe(false);
    expect(rowOf(rows, '最差的一格').subject).toBe(0.85);
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

describe('飞行后的过程', () => {
  const trace =[fillSample(0, 800), fillSample(100, 900), fillSample(200, 850), fillSample(300, 910), fillSample(400, 920)];

  it('某一刻的读数：那一刻之前最后一次记录', () => {
    expect(fillSampleAt(trace, 250)?.t).toBe(200);
    expect(fillSampleAt(trace, 9999)?.t).toBe(400);
    expect(fillSampleAt([fillSample(0.1, 800)], 0)?.triangles).toBe(800);
    expect(fillSampleAt([], 0)).toBeNull();
  });

  it('到某个粗细的时间：替换瓦片的中途回落过，看最后一次低于它之后', () => {
    expect(fillReachedAt(trace, 900)).toBe(300);
  });

  it('一开始就够了是 0；一直没到是 null', () => {
    expect(fillReachedAt(trace, 500)).toBe(0);
    expect(fillReachedAt(trace, 1000)).toBeNull();
  });
});

const staticJs = (variant: string, p50: number, scene = 's'): RunResult => ({
  ...perf(variant),
  scene,
  static: { ...phase(p50, p50, p50), js: { samples: 100, mean: p50, p50, p95: p50, p99: p50, max: p50 } }
});

describe('machineDrift', () => {
  it('同一种引擎、同一个场景比；MapLibre 的各个方案静止时工作量相同，算一组', () => {
    expect(machineDrift([staticJs('maplibre', 2), staticJs('maplibre-up16', 5), staticJs('maplibre-no-budget', 3)])).toBe(2.5);
  });

  it('引擎和场景不同的不比：工作量本来就不同', () => {
    expect(machineDrift([staticJs('maplibre', 2), staticJs('cesium', 9)])).toBeNull();
    expect(machineDrift([staticJs('maplibre', 2, 'a'), staticJs('maplibre', 9, 'b')])).toBeNull();
  });

  it('泼溅的预算不同，画的就不同：每个预算各算一组', () => {
    expect(machineDrift([staticJs('maplibre-splat3m', 2), staticJs('maplibre-splat10m', 8)])).toBeNull();
    expect(machineDrift([staticJs('maplibre-splat3m', 2), staticJs('maplibre-splat3m', 2.4), staticJs('maplibre-splat10m', 8)])).toBeCloseTo(1.2);
  });

  it('取最不稳定的一组', () => {
    expect(machineDrift([staticJs('cesium', 4), staticJs('cesium', 4.4), staticJs('maplibre', 2), staticJs('maplibre', 3)])).toBe(1.5);
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
