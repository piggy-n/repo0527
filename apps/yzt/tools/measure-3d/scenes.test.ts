// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { aerialFlight, buildRuns, nudge, SCENES, selectScenes, splatVariants, variants, withCamera, zoomedIn } from './scenes.ts';

describe('selectScenes', () => {
  it('默认选倾斜摄影 z17、z19', () => {
    expect(selectScenes([]).map(scene => scene.id)).toEqual(['oblique-z17', 'oblique-z19']);
  });

  it('按子串选', () => {
    expect(selectScenes(['jkq2']).map(scene => scene.id)).toEqual(['jkq2-z15', 'jkq2-z16-tilt']);
  });

  it('写出完整的场景 ID 时只选它：jkq-z16 不带上 jkq-z16-tilt、jkq-z16.5', () => {
    expect(selectScenes(['jkq-z16']).map(scene => scene.id)).toEqual(['jkq-z16']);
    expect(selectScenes(['xwq02-z16']).map(scene => scene.id)).toEqual(['xwq02-z16']);
    expect(selectScenes(['jkq-z16', 'xwq03-z16']).map(scene => scene.id)).toEqual(['jkq-z16', 'xwq03-z16']);
    expect(selectScenes(['splat-pc-z18']).map(scene => scene.id)).toEqual(['splat-pc-z18']);
    // 不是完整 ID 的照旧按子串
    expect(selectScenes(['jkq-z16-']).map(scene => scene.id)).toEqual(['jkq-z16-tilt']);
  });

  it('按级别选时不带上泼溅场景：它们比的是预算，要写出 splat', () => {
    expect(selectScenes(['z19']).map(scene => scene.id)).toEqual(['oblique-z19']);
    expect(selectScenes(['z18']).map(scene => scene.id)).toEqual(['white-station-z18']);
  });
});

describe('variants', () => {
  it('产品的默认值，加上要对照的上传预算', () => {
    expect(variants([null, 16]).map(item => [item.id, item.uploadMB])).toEqual([
      ['maplibre', undefined],
      ['maplibre-no-budget', null],
      ['maplibre-up16', 16]
    ]);
  });

  it('none：只有产品的默认值', () => {
    expect(variants([]).map(item => item.id)).toEqual(['maplibre']);
  });
});

describe('variants 的对照方案', () => {
  it('动着不请求的窗口各是一个方案', () => {
    const list = variants([], [null, 0.3, 'auto']);
    expect(list.map(item => [item.id, item.cullWindow])).toEqual([
      ['maplibre', undefined],
      ['maplibre-no-cull', null],
      ['maplibre-cull0.3', 0.3],
      ['maplibre-cull-auto', 'auto']
    ]);
  });

  it('缓存上限的各档各是一个方案', () => {
    const list = variants([], [], [4, 6]);
    expect(list.map(item => [item.id, item.cacheGB, item.label])).toEqual([
      ['maplibre', undefined, 'MapLibre'],
      ['maplibre-cache4g', 4, 'MapLibre，缓存上限 4 GB'],
      ['maplibre-cache6g', 6, 'MapLibre，缓存上限 6 GB']
    ]);
  });

  it('上传后释放贴图：产品的默认值和每一档各一个对照，只跑 perf', () => {
    const list = variants([], [], [4], true);
    expect(list.map(item => [item.id, item.cacheGB, item.releaseImages ?? false, item.label])).toEqual([
      ['maplibre', undefined, false, 'MapLibre'],
      ['maplibre-cache4g', 4, false, 'MapLibre，缓存上限 4 GB'],
      ['maplibre-release', undefined, true, 'MapLibre，上传后释放贴图'],
      ['maplibre-cache4g-release', 4, true, 'MapLibre，缓存上限 4 GB，上传后释放贴图']
    ]);
    const runs = buildRuns(selectScenes(['jkq-z16-tilt']), list, 1);
    expect(runs.filter(run => run.variant.releaseImages && run.kind !== 'perf')).toEqual([]);
    expect(variants([], [], [4]).some(item => item.releaseImages)).toBe(false);
  });

  it('缓存上限的各档也跑画质（截图和默认值比），不跑采样；其他对照方案只跑 perf', () => {
    const list = variants([null], [], [4]);
    const runs = buildRuns(selectScenes(['jkq-z16-tilt']), list, 1);
    expect(runs.filter(run => run.kind !== 'perf').map(run => run.id)).toEqual([
      'jkq-z16-tilt/maplibre/quality',
      'jkq-z16-tilt/maplibre/profile',
      'jkq-z16-tilt/maplibre-cache4g/quality'
    ]);
  });

  it('--zoom-in：跑画质的方案（产品默认值、缓存上限的各档）各多一遍定位后放大一级，释放贴图的、泼溅场景不跑', () => {
    const list = variants([null], [], [4], true);
    const runs = buildRuns(selectScenes(['jkq-z16-tilt', 'splat-pc-z18']), list, 1, splatVariants([3e6]), true);
    expect(runs.filter(run => run.kind === 'zoom').map(run => run.id)).toEqual(['jkq-z16-tilt/maplibre/zoom', 'jkq-z16-tilt/maplibre-cache4g/zoom']);
    expect(buildRuns(selectScenes(['jkq-z16-tilt']), list, 1).some(run => run.kind === 'zoom')).toBe(false);
  });

  it('对照方案只跑 perf：画质和采样只有产品的默认值', () => {
    const list = variants([], [null, 0.3]);
    const runs = buildRuns(selectScenes(['z19']), list, 1, splatVariants([3e6, 6e6, 1e7]));
    expect(runs.filter(run => run.kind === 'perf')).toHaveLength(3);
    expect(runs.filter(run => run.kind !== 'perf').map(run => run.id)).toEqual([
      'oblique-z19/maplibre/quality',
      'oblique-z19/maplibre/profile'
    ]);
  });
});

describe('经开区的场景', () => {
  it('jkq- 选中 JKQ 的四个：z16 俯视、倾斜，用户说糊的 z16.5，和 z17 倾斜', () => {
    expect(selectScenes(['jkq-']).map(scene => scene.id)).toEqual(['jkq-z16', 'jkq-z16-tilt', 'jkq-z16.5', 'jkq-z17-tilt']);
    expect(selectScenes(['jkq-']).every(scene => !scene.byDefault && scene.camera.center === null)).toBe(true);
  });

  it('--at：换成给的相机，模型和 id 不变，标题注明', () => {
    const camera = { center: [120.41, 31.51] as const, zoom: 17.2, pitch: 60, bearing: 30 };
    const [moved] = selectScenes(['jkq-z16-tilt']).map(scene => withCamera(scene, camera));
    expect(moved?.id).toBe('jkq-z16-tilt');
    expect(moved?.camera).toEqual(camera);
    expect(moved?.models.map(model => model.path)).toEqual(['wuxi/3dtiles/经开区/tileset.json']);
    expect(moved?.title).toBe('经开区 z16 倾斜（--at 的相机）');
  });

  it('新吴区02、03 各四个，姿态同经开区，模型都在服务器上', () => {
    const xwq02 = selectScenes(['xwq02']);
    expect(xwq02.map(scene => scene.id)).toEqual(['xwq02-z16', 'xwq02-z16-tilt', 'xwq02-z16.5', 'xwq02-z17-tilt']);
    expect(xwq02.map(scene => [scene.camera.zoom, scene.camera.pitch])).toEqual(
      selectScenes(['jkq-']).map(scene => [scene.camera.zoom, scene.camera.pitch])
    );
    expect(xwq02.every(scene => scene.models[0]?.path === 'wuxi/3dtiles/新吴区02/tileset.json')).toBe(true);
    expect(selectScenes(['xwq']).filter(scene => scene.models[0]?.path.includes('新吴区03'))).toHaveLength(4);
    expect(selectScenes(['xwq']).every(scene => !scene.byDefault && scene.camera.center === null)).toBe(true);
  });
});

describe('buildRuns', () => {
  const scenes = selectScenes([]);
  const list = variants([null, 16]);

  it('每个场景每个方案跑 repeat 遍 perf，每遍换先后', () => {
    const runs = buildRuns(scenes.slice(0, 1), list, 2).filter(run => run.kind === 'perf');
    expect(runs.map(run => run.variant.id)).toEqual([
      'maplibre',
      'maplibre-no-budget',
      'maplibre-up16',
      'maplibre-up16',
      'maplibre-no-budget',
      'maplibre'
    ]);
  });

  it('只有产品的默认值跑画质和采样', () => {
    const others = buildRuns(scenes.slice(0, 1), list, 1).filter(run => run.kind !== 'perf');
    expect(others.map(run => run.id)).toEqual(['oblique-z17/maplibre/quality', 'oblique-z17/maplibre/profile']);
  });

  it('每一遍的 id 不重复：截图和结果按它命名', () => {
    const ids = buildRuns(scenes, list, 3).map(run => run.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('泼溅场景（ADR 0149 L.3）', () => {
  const list = variants([null]);
  const budgets = splatVariants([3e6, 6e6, 1e7]);

  it('splat 选中四个场景，都不默认跑；splat-pc 是彭城广场的三个', () => {
    expect(selectScenes(['splat']).map(scene => scene.id)).toEqual(['splat-pc-z18', 'splat-pc-z19', 'splat-pc-xz-z18', 'splat-cws1-z18']);
    expect(selectScenes(['splat-pc']).map(scene => scene.id)).toEqual(['splat-pc-z18', 'splat-pc-z19', 'splat-pc-xz-z18']);
    expect(selectScenes(['splat']).every(scene => !scene.byDefault)).toBe(true);
    expect(selectScenes([]).some(scene => scene.splats.length > 0)).toBe(false);
  });

  it('每个预算一个方案', () => {
    expect(budgets.map(item => [item.id, item.splatBudget, item.label])).toEqual([
      ['maplibre-splat3m', 3_000_000, 'MapLibre，泼溅预算 300 万'],
      ['maplibre-splat6m', 6_000_000, 'MapLibre，泼溅预算 600 万'],
      ['maplibre-splat10m', 10_000_000, 'MapLibre，泼溅预算 1,000 万']
    ]);
  });

  it('泼溅场景只跑预算的方案，不跑画质，每个预算一遍采样', () => {
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
    expect(perScene('oblique-z19')).toEqual(['maplibre', 'maplibre-no-budget']);
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

  it('放大一级只改级别；移开再移回往东走一个视口高度（地面上）、回到同一个相机', () => {
    expect(zoomedIn(camera)).toEqual({ ...camera, zoom: 18 });
    const [from, away, back] = nudge(camera, 900);
    expect(from).toEqual(camera);
    expect(back).toEqual(camera);
    // z17、纬度 34.26 时 900 像素约 445 米，往东走、不往北走
    const metersEast = ((away?.center[0] ?? 0) - camera.center[0]) * 111320 * Math.cos((camera.center[1] * Math.PI) / 180);
    expect(metersEast).toBeCloseTo((78271.516964 * Math.cos((camera.center[1] * Math.PI) / 180) * 900) / 2 ** 17, 0);
    expect(away?.center[1]).toBe(camera.center[1]);
  });

  it('所有场景都有模型：瓦片集或泼溅', () => {
    expect(SCENES.every(scene => scene.models.length + scene.splats.length > 0)).toBe(true);
  });
});
