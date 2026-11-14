// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { SceneModel } from './catalog';
import { deriveSceneContent, type RouteChoice, type SceneModelsState } from './scene-content';

const oblique = (id: string, extra: Partial<SceneModel> = {}): SceneModel => ({
  id,
  name: id,
  cityCode: '320200',
  cityName: '无锡市',
  kind: 'oblique',
  underground: false,
  effects: [{ id: '', label: '', url: `https://maps.test/3dt/${id}/tileset.json` }],
  defaultEffect: '',
  spawn: undefined,
  routes: [],
  splat: null,
  ...extra
});

const added = (ids: readonly string[]): SceneModelsState => ({
  added: ids,
  hidden: new Set(),
  effects: new Map(),
  shownEffects: new Map(),
  attempts: new Map(),
  roam: null,
  navigations: new Map(),
  avatar: 'https://maps.test/roam/Cesium_Man.glb'
});

describe('deriveSceneContent', () => {
  it('清单给了屏幕误差上限的模型，瓦片集带上它；没给的不写这一项；倾斜摄影在泼溅的范围里不画（ADR 0149）', () => {
    const models = [oblique('jkq', { maximumScreenSpaceError: 8 }), oblique('jkq2')];

    const { tilesets } = deriveSceneContent(models, added(['jkq', 'jkq2']));

    expect(tilesets).toStrictEqual([
      {
        id: 'jkq',
        url: 'https://maps.test/3dt/jkq/tileset.json',
        show: true,
        lighting: 'sun',
        attempt: 0,
        maximumScreenSpaceError: 8,
        clippedBySplats: true
      },
      {
        id: 'jkq2',
        url: 'https://maps.test/3dt/jkq2/tileset.json',
        show: true,
        lighting: 'sun',
        attempt: 0,
        clippedBySplats: true
      }
    ]);
    // 室内、白膜不裁
    const indoor = deriveSceneContent([oblique('room', { kind: 'indoor', underground: true })], added(['room']));
    expect(indoor.tilesets[0]).not.toHaveProperty('clippedBySplats');
  });

  it('高斯泼溅（ADR 0149）各一份泼溅，ID 是模型 ID，带上重试次数；没有泼溅时不写 splats', () => {
    const placement = { lng: 117.06, lat: 34.27, height: 59.7, heading: -0.04 };
    const url = 'https://maps.test/3dt/cws/lcc2-sog-result/cws.lcc2';
    const models = [
      oblique('xz'),
      oblique('cws', { kind: 'splat', effects: [], splat: { url, placement } })
    ];

    const content = deriveSceneContent(models, { ...added(['cws', 'xz']), attempts: new Map([['cws', 2]]) });

    expect(content.tilesets.map(({ id }) => id)).toStrictEqual(['xz']);
    expect(content.splats).toStrictEqual([{ id: 'cws', url, placement, show: true, attempt: 2 }]);
    expect('splats' in deriveSceneContent(models, added(['xz']))).toBe(false);
  });

  it('漫游地下的模型时不显示地面上的泼溅，和地面上的瓦片集一样（ADR 0097 第 5 节）', () => {
    const path: [number, number, number][] = [
      [120.666, 31.3175, -5.1],
      [120.6662, 31.3175, -5.1]
    ];
    const station = oblique('station', {
      kind: 'indoor',
      underground: true,
      routes: [{ id: 'enter', name: '进站', path, length: 19 }]
    });
    const splat = { url: 'https://maps.test/3dt/cws/cws.lcc2', placement: { lng: 117.06, lat: 34.27, height: 59.7, heading: 0 } };
    const models = [station, oblique('cws', { kind: 'splat', effects: [], splat })];
    const state = added(['station', 'cws']);
    const roam: RouteChoice = { kind: 'route', modelId: 'station', routeId: 'enter', id: 'r1', playing: false, speed: 4, run: 0 };

    expect(deriveSceneContent(models, state).splats?.[0]?.show).toBe(true);
    const roaming = deriveSceneContent(models, { ...state, roam });
    expect(roaming.splats?.[0]?.show).toBe(false);
    expect(roaming.underground?.tilesetId).toBe('station');
  });

  it('漫游泼溅时隔离它：别的瓦片集、泼溅都不显示，不抬高（ADR 0156 R.5）', () => {
    const placement = { lng: 117.06, lat: 34.27, height: 59.7, heading: 0 };
    const tomb = oblique('tomb', {
      kind: 'splat',
      effects: [],
      splat: { url: 'https://maps.test/3dt/tomb/tomb.lcc2', placement },
      // 泼溅写了 underground 也不抬高
      underground: true,
      routes: [{ id: 'in', name: '进墓室', path: [[117.06, 34.27, 50], [117.0601, 34.27, 50]], length: 9 }]
    });
    const other = oblique('cws', { kind: 'splat', effects: [], splat: { url: 'https://maps.test/3dt/cws/cws.lcc2', placement } });
    const models = [oblique('xz'), tomb, other];
    const state = added(['xz', 'tomb', 'cws']);
    const roam: RouteChoice = { kind: 'route', modelId: 'tomb', routeId: 'in', id: 'r1', playing: false, speed: 4, run: 0 };

    const before = deriveSceneContent(models, state);
    expect('isolatedSplat' in before).toBe(false);
    const roaming = deriveSceneContent(models, { ...state, roam });
    expect(roaming.isolatedSplat).toBe('tomb');
    expect(roaming.underground).toBeNull();
    expect(roaming.tilesets.map(({ show }) => show)).toStrictEqual([false]);
    expect(roaming.splats?.map(({ id, show }) => [id, show])).toStrictEqual([
      ['tomb', true],
      ['cws', false]
    ]);
  });
});
