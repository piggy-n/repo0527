// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { SWITCH_TO_3D_STEPS, switchTo3d } from '../../src/shared/perf/switch-to-3d';
import {
  formatSceneComparison,
  formatSceneReport,
  SCENE_STEPS,
  SCENE_TRACE_NAME,
  type SceneRawRun,
  summarizeSceneRun
} from './scene-report.ts';

const ORIGIN = 'http://localhost:4173';

function raw(overrides: Partial<SceneRawRun> = {}): SceneRawRun {
  return {
    settled: true,
    measures: { runtime: 900, 'view-ready': 1400, settled: 2100 },
    stayStart: 10_000,
    traceStart: 15_000,
    longTasks: [],
    requests: [],
    unfinished: [],
    heapBefore: 40 * 1024 * 1024,
    heapAfter: 95 * 1024 * 1024,
    ...overrides
  };
}

describe('步骤与应用一致', () => {
  it('名称和步骤同 src/shared/perf/switch-to-3d.ts', () => {
    expect(switchTo3d.entryName('start')).toBe(`${SCENE_TRACE_NAME}:start`);
    expect(SCENE_STEPS).toStrictEqual(SWITCH_TO_3D_STEPS);
  });
});

describe('summarizeSceneRun', () => {
  it('认出 map-cesium 分块和 Cesium 的运行时文件；停留期间和点了以后的下载分开算', () => {
    const summary = summarizeSceneRun(
      raw({
        requests: [
          { url: `${ORIGIN}/assets/map-cesium-DyB417k0.js`, finish: -1200, bytes: 1_000_000 },
          { url: `${ORIGIN}/cesium/Workers/createVerticesFromHeightmap.js`, finish: 1500, bytes: 0 },
          { url: `${ORIGIN}/cesium/Assets/approximateTerrainHeights.json`, finish: 1100, bytes: 90_000 },
          { url: `${ORIGIN}/assets/CurrentMapPage-BsDuioMe.js`, finish: 300, bytes: 2000 }
        ]
      })
    );

    expect(summary.chunk).toStrictEqual({ finish: -1200, bytes: 1_000_000 });
    expect(summary.cesiumFiles).toStrictEqual({ count: 2, lastFinish: 1500 });
    expect(summary.bytesBeforeStart).toBe(1_000_000);
    expect(summary.bytesAfterStart).toBe(92_000);
    expect(summary.heapGrowth).toBe(55 * 1024 * 1024);
  });

  it('只算二维停留期间的长任务', () => {
    const summary = summarizeSceneRun(
      raw({
        longTasks: [
          { startTime: 9000, duration: 300 },
          { startTime: 12_000, duration: 120 },
          { startTime: 13_000, duration: 80 },
          { startTime: 15_500, duration: 400 }
        ]
      })
    );

    expect(summary.stayLongTasks).toStrictEqual({ count: 2, total: 200, longest: 120 });
  });

  it('没有 map-cesium 分块的请求时为 null', () => {
    expect(summarizeSceneRun(raw()).chunk).toBeNull();
  });
});

describe('formatSceneReport、formatSceneComparison', () => {
  const runs = [
    summarizeSceneRun(raw()),
    summarizeSceneRun(raw({ measures: { runtime: 1100, 'view-ready': 1600, settled: 2500 } })),
    summarizeSceneRun(raw({ settled: false, measures: { runtime: 9000 } }))
  ];

  it('每档一行，只取完成了的几次的中位数', () => {
    const text = formatSceneReport([{ profile: 'fast4g', runs }]);

    expect(text).toContain('| Fast 4G | 2/3 | 1000 | 1500 | 2300 |');
    expect(text).toContain('55.0 MB');
  });

  it('对比以第一份为参照写出差', () => {
    const faster = runs.map(run => ({ ...run, steps: { ...run.steps, settled: (run.steps.settled ?? 0) - 1000 } }));
    const text = formatSceneComparison([
      { build: 'baseline', profiles: [{ profile: 'fast4g', runs }] },
      { build: 'idle', profiles: [{ profile: 'fast4g', runs: faster }] }
    ]);

    expect(text).toContain('| baseline | 2300 |');
    expect(text).toContain('| idle | 1300（-1000） |');
  });
});
