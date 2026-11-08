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
  it('清单给了屏幕误差上限的模型，瓦片集带上它；没给的不写这一项', () => {
    const models = [oblique('jkq', { maximumScreenSpaceError: 8 }), oblique('jkq2')];

    const { tilesets } = deriveSceneContent(models, loaded(['jkq', 'jkq2']));

    expect(tilesets).toStrictEqual([
      {
        id: 'jkq',
        url: 'https://maps.test/3dt/jkq/tileset.json',
        show: true,
        lighting: 'sun',
        attempt: 0,
        maximumScreenSpaceError: 8
      },
      { id: 'jkq2', url: 'https://maps.test/3dt/jkq2/tileset.json', show: true, lighting: 'sun', attempt: 0 }
    ]);
  });
});
