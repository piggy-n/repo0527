// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { SceneModel } from './catalog';
import { deriveSceneContent, type SceneModelsState } from './scene-content';

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

const loaded = (ids: readonly string[]): SceneModelsState => ({
  loaded: ids,
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

    const { tilesets } = deriveSceneContent(models, loaded(['jkq', 'jkq2']));

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
    const indoor = deriveSceneContent([oblique('room', { kind: 'indoor', underground: true })], loaded(['room']));
    expect(indoor.tilesets[0]).not.toHaveProperty('clippedBySplats');
  });

  it('高斯泼溅（ADR 0149）各一份泼溅，ID 是模型 ID，带上重试次数；没有泼溅时不写 splats', () => {
    const placement = { lng: 117.06, lat: 34.27, height: 59.7, heading: -0.04 };
    const url = 'https://maps.test/3dt/cws/lcc2-sog-result/cws.lcc2';
    const models = [
      oblique('xz'),
      oblique('cws', { kind: 'splat', effects: [], splat: { url, placement } })
    ];

    const content = deriveSceneContent(models, { ...loaded(['cws', 'xz']), attempts: new Map([['cws', 2]]) });

    expect(content.tilesets.map(({ id }) => id)).toStrictEqual(['xz']);
    expect(content.splats).toStrictEqual([{ id: 'cws', url, placement, show: true, attempt: 2 }]);
    expect('splats' in deriveSceneContent(models, loaded(['xz']))).toBe(false);
  });
});
