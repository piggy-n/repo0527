// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { aerialFlight, buildRuns, SCENES, selectScenes, variants } from './scenes.ts';

describe('selectScenes', () => {
  it('默认选验收场景：倾斜摄影 z17、z19', () => {
    expect(selectScenes([]).map(scene => scene.id)).toEqual(['oblique-z17', 'oblique-z19']);
  });

  it('按子串选', () => {
    expect(selectScenes(['jkq2']).map(scene => scene.id)).toEqual(['jkq2-z15', 'jkq2-z16-tilt']);
  });
});

describe('variants', () => {
  it('Cesium、产品的默认值，加上要对照的上传预算', () => {
    expect(variants([null, 16]).map(item => [item.id, item.engine, item.uploadMB])).toEqual([
      ['cesium', 'cesium', undefined],
      ['maplibre', 'maplibre', undefined],
      ['maplibre-no-budget', 'maplibre', null],
      ['maplibre-up16', 'maplibre', 16]
    ]);
  });
});

describe('buildRuns', () => {
  const scenes = selectScenes([]);
  const list = variants([null]);

  it('每个场景每个方案跑 repeat 遍 perf，每遍换先后', () => {
    const runs = buildRuns(scenes.slice(0, 1), list, 2).filter(run => run.kind === 'perf');
    expect(runs.map(run => run.variant.id)).toEqual([
      'cesium',
      'maplibre',
      'maplibre-no-budget',
      'maplibre-no-budget',
      'maplibre',
      'cesium'
    ]);
  });

  it('只有要比的两个方案跑画质和采样', () => {
    const others = buildRuns(scenes.slice(0, 1), list, 1).filter(run => run.kind !== 'perf');
    expect(others.map(run => run.id)).toEqual([
      'oblique-z17/cesium/quality',
      'oblique-z17/cesium/profile',
      'oblique-z17/maplibre/quality',
      'oblique-z17/maplibre/profile'
    ]);
  });

  it('每一遍的 id 不重复：截图和结果按它命名', () => {
    const ids = buildRuns(scenes, list, 3).map(run => run.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('aerialFlight', () => {
  const camera = { center: [117.18, 34.26] as const, zoom: 17, pitch: 55, bearing: 20 };

  it('转满一圈回到原点', () => {
    const frames = aerialFlight(camera, 900);
    const first = frames[0];
    const last = frames.at(-1);
    expect(first?.center).toEqual(last?.center);
    expect((last?.bearing ?? 0) - (first?.bearing ?? 0)).toBe(360);
  });

  it('俯视时俯仰不会变成负的', () => {
    const frames = aerialFlight({ ...camera, pitch: 0 }, 900);
    expect(frames.every(frame => frame.pitch >= 0)).toBe(true);
  });

  it('所有场景都有模型', () => {
    expect(SCENES.every(scene => scene.models.length > 0)).toBe(true);
  });
});
