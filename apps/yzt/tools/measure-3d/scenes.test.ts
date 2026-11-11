// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { aerialFlight, buildRuns, SCENES, selectScenes, splatVariants, variants } from './scenes.ts';

describe('selectScenes', () => {
  it('默认选验收场景：倾斜摄影 z17、z19', () => {
    expect(selectScenes([]).map(scene => scene.id)).toEqual(['oblique-z17', 'oblique-z19']);
  });

  it('按子串选', () => {
    expect(selectScenes(['jkq2']).map(scene => scene.id)).toEqual(['jkq2-z15', 'jkq2-z16-tilt']);
  });

  it('按级别选时不带上泼溅场景：它们要本地清单，引擎对比用不到', () => {
    expect(selectScenes(['z19']).map(scene => scene.id)).toEqual(['oblique-z19']);
    expect(selectScenes(['z18']).map(scene => scene.id)).toEqual(['white-station-z18']);
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

describe('variants 的对照方案', () => {
  it('动着不请求的窗口各是一个方案，只有 MapLibre', () => {
    const list = variants([], [null, 0.3, 'auto']);
    expect(list.map(item => [item.id, item.engine, item.cullWindow])).toEqual([
      ['cesium', 'cesium', undefined],
      ['maplibre', 'maplibre', undefined],
      ['maplibre-no-cull', 'maplibre', null],
      ['maplibre-cull0.3', 'maplibre', 0.3],
      ['maplibre-cull-auto', 'maplibre', 'auto']
    ]);
  });

  it('对照方案只跑 perf：画质和采样只有要比的两个方案', () => {
    const list = variants([], [null, 0.3]);
    const runs = buildRuns(selectScenes(['z19']), list, 1, splatVariants([3e6, 6e6, 1e7]));
    expect(runs.filter(run => run.kind === 'perf')).toHaveLength(4);
    expect(runs.filter(run => run.kind !== 'perf').map(run => run.id)).toEqual([
      'oblique-z19/cesium/quality',
      'oblique-z19/cesium/profile',
      'oblique-z19/maplibre/quality',
      'oblique-z19/maplibre/profile'
    ]);
  });
});

describe('经开区的场景', () => {
  it('jkq- 选中 JKQ 的四个：z16 俯视、倾斜，用户说糊的 z16.5，和 z17 倾斜', () => {
    expect(selectScenes(['jkq-']).map(scene => scene.id)).toEqual(['jkq-z16', 'jkq-z16-tilt', 'jkq-z16.5', 'jkq-z17-tilt']);
    expect(selectScenes(['jkq-']).every(scene => !scene.acceptance && scene.camera.center === null)).toBe(true);
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

describe('泼溅场景（ADR 0149 L.3）', () => {
  const list = variants([null]);
  const budgets = splatVariants([3e6, 6e6, 1e7]);

  it('splat 选中四个场景，都不在验收里；splat-pc 是彭城广场的三个', () => {
    expect(selectScenes(['splat']).map(scene => scene.id)).toEqual(['splat-pc-z18', 'splat-pc-z19', 'splat-pc-xz-z18', 'splat-cws1-z18']);
    expect(selectScenes(['splat-pc']).map(scene => scene.id)).toEqual(['splat-pc-z18', 'splat-pc-z19', 'splat-pc-xz-z18']);
    expect(selectScenes(['splat']).every(scene => !scene.acceptance)).toBe(true);
    expect(selectScenes([]).some(scene => scene.splats.length > 0)).toBe(false);
  });

  it('每个预算一个 MapLibre 方案', () => {
    expect(budgets.map(item => [item.id, item.engine, item.splatBudget, item.label])).toEqual([
      ['maplibre-splat3m', 'maplibre', 3_000_000, 'MapLibre，泼溅预算 300 万'],
      ['maplibre-splat6m', 'maplibre', 6_000_000, 'MapLibre，泼溅预算 600 万'],
      ['maplibre-splat10m', 'maplibre', 10_000_000, 'MapLibre，泼溅预算 1,000 万']
    ]);
  });

  it('泼溅场景只跑预算的方案，不跑 Cesium、不比画质，每个预算一遍采样', () => {
    const runs = buildRuns(selectScenes(['splat-pc-z18']), list, 2, budgets);
    expect(runs.filter(run => run.kind === 'perf').map(run => run.variant.id)).toEqual([
      'maplibre-splat3m',
      'maplibre-splat6m',
      'maplibre-splat10m',
      'maplibre-splat10m',
      'maplibre-splat6m',
      'maplibre-splat3m'
    ]);
    expect(runs.filter(run => run.kind !== 'perf').map(run => run.id)).toEqual([
      'splat-pc-z18/maplibre-splat3m/profile',
      'splat-pc-z18/maplibre-splat6m/profile',
      'splat-pc-z18/maplibre-splat10m/profile'
    ]);
  });

  it('和瓦片集的场景一起跑时各跑各的方案', () => {
    const runs = buildRuns(selectScenes(['z19', 'splat-cws1']), list, 1, budgets);
    const perScene = (id: string) => [...new Set(runs.filter(run => run.scene.id === id).map(run => run.variant.id))];
    expect([...new Set(runs.map(run => run.scene.id))]).toEqual(['oblique-z19', 'splat-cws1-z18']);
    expect(perScene('oblique-z19')).toEqual(['cesium', 'maplibre', 'maplibre-no-budget']);
    expect(perScene('splat-cws1-z18')).toEqual(['maplibre-splat3m', 'maplibre-splat6m', 'maplibre-splat10m']);
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

  it('所有场景都有内容：瓦片集、泼溅，或者资源图层（方案 B 的 PoC）', () => {
    expect(
      SCENES.every(scene => scene.models.length + scene.splats.length + (scene.resources?.codes.length ?? 0) > 0)
    ).toBe(true);
  });

  it('资源图层的场景要写出 res 才选得中，压力场景还要写出 stress；只比两种引擎，只有一个场景做 CPU 采样', () => {
    expect(selectScenes([]).some(scene => scene.resources)).toBe(false);
    expect(selectScenes(['z10']).some(scene => scene.resources)).toBe(false);
    expect(selectScenes(['res-']).map(scene => scene.id)).toEqual([
      'res-water-z10',
      'res-all-z10',
      'res-all-z12-tilt',
      'res-landuse-z14',
      'res-farmland-z12'
    ]);
    expect(selectScenes(['res-stress']).map(scene => scene.id)).toEqual(['res-stress-water-z10']);
    const runs = buildRuns(selectScenes(['res-']), variants([null]), 1);
    expect(new Set(runs.map(run => run.variant.id))).toEqual(new Set(['cesium', 'maplibre']));
    expect(runs.filter(run => run.kind === 'profile').map(run => run.id)).toEqual([
      'res-all-z10/cesium/profile',
      'res-all-z10/maplibre/profile'
    ]);
  });
});
