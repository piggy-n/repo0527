import type { RoamStatus, SceneActivities, SceneStatus } from '@mx/map-core';
import type { SceneCapabilities } from '@mx/map-vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, ref, shallowRef } from 'vue';
import { createMemoryStore } from '@/shared/storage/key-value-store';
import { createTestPreferenceScope } from '@/shared/storage/testing';
import { PREFERENCE_WRITE_DEBOUNCE } from '@/shared/storage/use-preference';
import { sceneManifestSchema } from './api';
import { buildModelCatalog, type SceneModel } from './catalog';
import { type SceneModelsContext, useSceneModels } from './composables/useSceneModels';
import { restoredSceneModels, storedSceneModelsSchema, toStoredSceneModels } from './scene-models-preference';

const CATALOG = buildModelCatalog(
  sceneManifestSchema.parse({
    models: [
      {
        id: 'white',
        name: '白膜',
        cityCode: '320500',
        kind: 'white',
        underground: false,
        effects: [
          { id: 'plain', label: '无纹理', tileset: 'W/plain/tileset.json' },
          { id: 'window', label: '效果1', tileset: 'W/window/tileset.json' }
        ]
      },
      { id: 'city', name: '倾斜', cityCode: '320100', kind: 'oblique', underground: false, tileset: 'C/tileset.json' }
    ]
  }),
  'https://maps.test/3dt/manifest.json'
);

const KEY = 'zhangsan/scene-models';
const MAPLIBRE: SceneCapabilities = { styleLayers: true, identify: true, splats: true };

// 这些用例不定位：相机操作什么也不做
const idleOperation = () => ({ signal: new AbortController().signal, run: () => undefined });

// 只给拥有者要的上下文；清单由用例决定什么时候到
function setup(store = createMemoryStore()) {
  const catalog = shallowRef<readonly SceneModel[] | undefined>(undefined);
  const map: SceneModelsContext = {
    sceneStatus: shallowRef<SceneStatus>(new Map()),
    sceneActivity: shallowRef<SceneActivities>(new Map()),
    roamStatus: shallowRef<RoamStatus | null>(null),
    runCameraOperation: () => undefined,
    beginCameraOperation: idleOperation,
    sceneCapabilities: MAPLIBRE,
    dimension: ref<'2d' | '3d'>('2d')
  };
  const effect = effectScope();
  const { scope } = createTestPreferenceScope(store);
  const owner = effect.run(() => useSceneModels(map, catalog, { preferences: scope }));
  if (!owner) {
    throw new Error('拥有者没有创建');
  }
  return { owner, catalog, store, [Symbol.dispose]: () => effect.stop() };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('记下的三维模型：格式和合并（ADR 0167）', () => {
  it('只记加入了的模型的隐藏和效果', () => {
    expect(
      toStoredSceneModels({
        added: ['white', 'city'],
        hidden: new Set(['city', 'gone']),
        effects: new Map([
          ['white', 'window'],
          ['gone', 'plain']
        ])
      })
    ).toStrictEqual({ added: ['white', 'city'], hidden: ['city'], effects: { white: 'window' } });
  });

  it('清单里没有了的丢掉；效果只留白膜、清单里还有的', () => {
    const record = restoredSceneModels(
      { added: ['gone', 'white', 'city'], hidden: ['gone', 'city'], effects: { white: 'missing', city: 'plain' } },
      CATALOG
    );
    expect(record).toStrictEqual({ added: ['white', 'city'], hidden: new Set(['city']), effects: new Map() });
    expect(restoredSceneModels({ added: ['white'], hidden: [], effects: { white: 'window' } }, CATALOG).effects).toStrictEqual(
      new Map([['white', 'window']])
    );
  });

  it('不自洽的当作没有存过：加入的重复，隐藏的、换过效果的没有加入', () => {
    expect(storedSceneModelsSchema.safeParse({ added: ['white', 'white'], hidden: [], effects: {} }).success).toBe(false);
    expect(storedSceneModelsSchema.safeParse({ added: ['white'], hidden: ['city'], effects: {} }).success).toBe(false);
    expect(storedSceneModelsSchema.safeParse({ added: [], hidden: [], effects: { city: 'plain' } }).success).toBe(false);
  });
});

describe('三维模型的拥有者：按账号记住（ADR 0167）', () => {
  it('清单到了才合并记下的：先后、隐藏、效果都回来，没有了的丢掉并写回去', async () => {
    using ctx = setup(
      createMemoryStore({
        [KEY]: {
          version: 1,
          value: { added: ['gone', 'white', 'city'], hidden: ['city'], effects: { white: 'window' } }
        }
      })
    );
    await vi.advanceTimersByTimeAsync(0);
    // 读到了，清单还没到：列表里还没有模型
    expect(ctx.owner.added.value).toStrictEqual([]);
    expect(ctx.owner.restored.value).toBe(false);

    ctx.catalog.value = CATALOG;
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.owner.restored.value).toBe(true);
    expect(ctx.owner.added.value).toStrictEqual(['white', 'city']);
    expect([...ctx.owner.hidden.value]).toStrictEqual(['city']);
    expect(ctx.owner.effectOf('white')).toBe('window');

    await vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DEBOUNCE);
    expect(ctx.store.entries.get(KEY)).toStrictEqual({
      version: 1,
      value: { added: ['white', 'city'], hidden: ['city'], effects: { white: 'window' } }
    });
  });

  it('加入、隐藏、换效果后防抖写入；移出时换过的效果一起忘掉，再加入是默认的效果', async () => {
    using ctx = setup();
    ctx.catalog.value = CATALOG;
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.owner.restored.value).toBe(true);

    ctx.owner.add(['white', 'city']);
    ctx.owner.setEffect('white', 'window');
    ctx.owner.setVisible('city', false);
    await vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DEBOUNCE);
    expect(ctx.store.entries.get(KEY)).toStrictEqual({
      version: 1,
      value: { added: ['white', 'city'], hidden: ['city'], effects: { white: 'window' } }
    });

    ctx.owner.remove(['white']);
    ctx.owner.add(['white']);
    expect(ctx.owner.effectOf('white')).toBe('plain');
    await vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DEBOUNCE);
    expect(ctx.store.entries.get(KEY)).toStrictEqual({
      version: 1,
      value: { added: ['white', 'city'], hidden: ['city'], effects: {} }
    });
  });

  it('没有存过：清单到了就算恢复完，列表里没有模型', async () => {
    using ctx = setup();
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.owner.restored.value).toBe(false);
    ctx.catalog.value = CATALOG;
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.owner.restored.value).toBe(true);
    expect(ctx.owner.added.value).toStrictEqual([]);
  });
});
