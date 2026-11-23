import type { ViewKind } from '@mx/map-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, shallowRef } from 'vue';
import { createMemoryStore, type KeyValueStore } from '@/shared/storage/key-value-store';
import { createTestPreferenceScope } from '@/shared/storage/testing';
import { PREFERENCE_READ_TIMEOUT, PREFERENCE_WRITE_DEBOUNCE } from '@/shared/storage/use-preference';
import type { ResourceTreeLayer } from './api';
import { buildCatalog, type ResourceCatalog } from './catalog';
import { useResourceLayers } from './composables/useResourceLayers';
import { storedResourceLayersSchema } from './resource-layers-preference';

const KEY = 'zhangsan/resource-layers';

function layer(code: string, geoType: ResourceTreeLayer['geoType'], ...yearList: [number, ...number[]]) {
  return { code, name: code, geoType, yearList };
}

const CATALOG = buildCatalog([
  {
    code: null,
    name: '测试',
    children: [
      layer('bgdc_dltb', 'Polygon', 2022),
      layer('bgdc_cjdcq', 'Polygon', 2023, 2024),
      layer('csxhjctb_hydl', 'Line', 2023, 2024, 2025)
    ]
  }
]);

function stored(displays: Record<string, unknown>, order: string[]) {
  return { [KEY]: { version: 1, value: { displays, order } } };
}

const HIDDEN = { checked: false, opacity: 0.9, year: 2022 };

// 拥有者连同偏好的范围；目录由用例决定什么时候到，null 表示还没到；perDimension 同页面的开关（ADR 0169）
function setup(store: KeyValueStore, catalog: ResourceCatalog | null = CATALOG, perDimension = false) {
  const effect = effectScope();
  const source = shallowRef(catalog ?? undefined);
  const dimension = shallowRef<ViewKind>('2d');
  const { scope } = createTestPreferenceScope(store);
  const owner = effect.run(() =>
    useResourceLayers(
      { dimension, sceneCapabilities: { styleLayers: true, identify: true, splats: false } },
      { catalog: source, tileBase: 'http://localhost/tiles/', preferences: scope, perDimension }
    )
  );
  if (!owner) {
    throw new Error('资源图层的拥有者没有创建');
  }
  return { owner, source, dimension, [Symbol.dispose]: () => effect.stop() };
}

const layerIds = (owner: ReturnType<typeof useResourceLayers>) => owner.deriveGroup().layers.map(({ id }) => id);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('资源图层偏好的校验', () => {
  const display = { checked: true, opacity: 0.5, year: 2024 };

  it('顺序和各资源的设置一一对应：通过；批量设置的年份可以没有', () => {
    const value = { displays: { a: display, b: display }, order: ['b', 'a'] };

    expect(storedResourceLayersSchema.safeParse(value).success).toBe(true);
    expect(storedResourceLayersSchema.safeParse({ ...value, batchYear: 2023 }).success).toBe(true);
    expect(storedResourceLayersSchema.safeParse({ ...value, batchYear: null }).success).toBe(true);
  });

  it('顺序有重复、顺序里的资源没有设置、多出没有排序的设置、透明度越界、批量年份不是整数：不通过', () => {
    // 前两组数量相等，只有"不重复""每一项都有设置"这两条检查能分别拦下
    const invalid = [
      { displays: { a: display, b: display }, order: ['a', 'a'] },
      { displays: { a: display, b: display }, order: ['a', 'c'] },
      { displays: { a: display, b: display }, order: ['a'] },
      { displays: { a: { ...display, opacity: 1.5 } }, order: ['a'] },
      { displays: { a: display }, order: ['a'], batchYear: 2023.5 }
    ];

    expect(invalid.map(value => storedResourceLayersSchema.safeParse(value).success)).toStrictEqual([
      false,
      false,
      false,
      false,
      false
    ]);
  });

  it('三维那一套（scene，ADR 0169）：可以没有；有时同样要自洽，不自洽时整条不通过', () => {
    const value = { displays: { a: display }, order: ['a'] };

    expect(storedResourceLayersSchema.safeParse({ ...value, scene: value }).success).toBe(true);
    expect(storedResourceLayersSchema.safeParse({ ...value, scene: { ...value, batchYear: 2023 } }).success).toBe(true);
    expect(storedResourceLayersSchema.safeParse({ ...value, scene: { displays: { a: display }, order: [] } }).success).toBe(
      false
    );
  });
});

describe('资源图层的偏好', () => {
  it('目录先到也要等存储读完才合并；用上次的勾选、透明度、顺序和年份；改版前存的没有 added，勾选过的算已加入（ADR 0157）', async () => {
    const store = createMemoryStore(
      stored(
        {
          csxhjctb_hydl: { checked: true, opacity: 0.5, year: 2023 },
          bgdc_dltb: HIDDEN,
          bgdc_cjdcq: { ...HIDDEN, year: 2024 }
        },
        ['csxhjctb_hydl', 'bgdc_dltb', 'bgdc_cjdcq']
      )
    );
    using ctx = setup(store);
    expect(ctx.owner.state.value.catalog).toBeNull();
    expect(layerIds(ctx.owner)).toStrictEqual([]);

    await vi.advanceTimersByTimeAsync(0);

    expect(ctx.owner.state.value.order).toStrictEqual(['csxhjctb_hydl', 'bgdc_dltb', 'bgdc_cjdcq']);
    expect(ctx.owner.state.value.displays.get('csxhjctb_hydl')).toStrictEqual({
      added: true,
      checked: true,
      opacity: 0.5,
      year: 2023,
      labeled: false
    });
    expect(ctx.owner.state.value.displays.get('bgdc_dltb')).toMatchObject({ added: false, checked: false });
    expect(layerIds(ctx.owner)).toStrictEqual(['resources-csxhjctb_hydl']);
  });

  it('存下的 added 和 checked 分开还原：加入了但隐藏的不画，仍在当前地图里；没加入的不画', async () => {
    const store = createMemoryStore(
      stored(
        {
          csxhjctb_hydl: { added: true, checked: false, opacity: 1, year: 2025 },
          bgdc_dltb: { added: false, checked: true, opacity: 1, year: 2022 },
          bgdc_cjdcq: { added: true, checked: true, opacity: 1, year: 2024 }
        },
        ['csxhjctb_hydl', 'bgdc_dltb', 'bgdc_cjdcq']
      )
    );
    using ctx = setup(store);

    await vi.advanceTimersByTimeAsync(0);

    expect(ctx.owner.state.value.displays.get('csxhjctb_hydl')).toMatchObject({ added: true, checked: false });
    expect(ctx.owner.state.value.displays.get('bgdc_dltb')).toMatchObject({ added: false, checked: true });
    expect(layerIds(ctx.owner)).toStrictEqual(['resources-bgdc_cjdcq']);
  });

  it('存下的资源目录里没有了、年份失效、目录里新出现的资源：按 ADR 0041 合并', async () => {
    const store = createMemoryStore(
      stored({ gone: HIDDEN, csxhjctb_hydl: { checked: true, opacity: 0.5, year: 2030 } }, ['gone', 'csxhjctb_hydl'])
    );
    using ctx = setup(store);

    await vi.advanceTimersByTimeAsync(0);

    const { displays, order } = ctx.owner.state.value;
    expect(displays.has('gone')).toBe(false);
    expect(displays.get('csxhjctb_hydl')?.year).toBe(2025);
    expect(displays.get('bgdc_dltb')).toMatchObject({ added: true, checked: true });
    // 新出现的资源按目录的顺序排在最后，已有的不按目录树整理（ADR 0157）
    expect(order).toStrictEqual(['csxhjctb_hydl', 'bgdc_dltb', 'bgdc_cjdcq']);
  });

  it('存下的顺序有重复：整条作废，按默认值显示，不会推导出重复的图层', async () => {
    const store = createMemoryStore(
      stored({ bgdc_dltb: { ...HIDDEN, checked: true }, bgdc_cjdcq: HIDDEN }, ['bgdc_dltb', 'bgdc_dltb'])
    );
    using ctx = setup(store);

    await vi.advanceTimersByTimeAsync(0);

    expect(ctx.owner.state.value.order).toStrictEqual(['bgdc_dltb', 'bgdc_cjdcq', 'csxhjctb_hydl']);
    expect(layerIds(ctx.owner)).toStrictEqual(['resources-bgdc_dltb']);
  });

  it('读取超过上限：按默认值合并', async () => {
    const pending: KeyValueStore = { ...createMemoryStore(), get: () => new Promise(() => undefined) };
    using ctx = setup(pending);

    await vi.advanceTimersByTimeAsync(PREFERENCE_READ_TIMEOUT - 1);
    expect(ctx.owner.state.value.catalog).toBeNull();
    await vi.advanceTimersByTimeAsync(1);

    expect(ctx.owner.state.value.catalog).toBe(CATALOG);
    expect(layerIds(ctx.owner)).toStrictEqual(['resources-bgdc_dltb']);
  });

  it('存储先读完、目录后到：目录到了再合并', async () => {
    const store = createMemoryStore(stored({ bgdc_dltb: HIDDEN }, ['bgdc_dltb']));
    using ctx = setup(store, null);
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.owner.state.value.catalog).toBeNull();

    ctx.source.value = CATALOG;
    await vi.advanceTimersByTimeAsync(0);

    expect(ctx.owner.state.value.catalog).toBe(CATALOG);
    expect(ctx.owner.state.value.displays.get('bgdc_dltb')?.checked).toBe(false);
  });

  it('批量设置的年份写入，没勾选的资源也写，并记下批量设置的年份；重新打开时还原（ADR 0116）', async () => {
    const store = createMemoryStore();
    {
      using ctx = setup(store);
      await vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DEBOUNCE);
      ctx.owner.setYearForAll(2023);
      await vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DEBOUNCE);
    }
    expect(store.entries.get(KEY)).toMatchObject({
      value: {
        displays: { bgdc_cjdcq: { checked: false, year: 2023 }, csxhjctb_hydl: { year: 2023 } },
        batchYear: 2023
      }
    });

    using reopened = setup(store);
    await vi.advanceTimersByTimeAsync(0);

    expect(reopened.owner.state.value.displays.get('bgdc_cjdcq')?.year).toBe(2023);
    expect(reopened.owner.state.value.displays.get('csxhjctb_hydl')?.year).toBe(2023);
    expect(reopened.owner.batchYear.value).toBe(2023);
  });

  it('以前存下的没有批量设置的年份：照常还原，按没有批量设置过', async () => {
    const store = createMemoryStore(stored({ bgdc_dltb: HIDDEN }, ['bgdc_dltb']));
    using ctx = setup(store);
    await vi.advanceTimersByTimeAsync(0);

    expect(ctx.owner.state.value.displays.get('bgdc_dltb')?.opacity).toBe(0.9);
    expect(ctx.owner.batchYear.value).toBeNull();
  });

  it('标注的显隐（ADR 0160）：随显示状态写入、还原；2026-11-16 之前存下的没有这一项，不显示标注，版本不变', async () => {
    const store = createMemoryStore(
      stored(
        { csxhjctb_hydl: { added: true, checked: true, opacity: 1, year: 2025, labeled: true }, bgdc_dltb: HIDDEN },
        ['csxhjctb_hydl', 'bgdc_dltb']
      )
    );
    using ctx = setup(store);
    await vi.advanceTimersByTimeAsync(0);

    expect(ctx.owner.state.value.displays.get('csxhjctb_hydl')?.labeled).toBe(true);
    expect(ctx.owner.state.value.displays.get('bgdc_dltb')?.labeled).toBe(false);

    ctx.owner.setLabeled('bgdc_dltb', true);
    ctx.owner.setLabeled('csxhjctb_hydl', false);
    await vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DEBOUNCE);

    expect(store.entries.get(KEY)).toMatchObject({
      version: 1,
      value: { displays: { bgdc_dltb: { labeled: true }, csxhjctb_hydl: { labeled: false } } }
    });
  });

  it('修改后防抖写入：每个资源的加入、显示、透明度、年份和叠放顺序', async () => {
    const store = createMemoryStore();
    using ctx = setup(store);
    await vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DEBOUNCE);

    ctx.owner.add(['csxhjctb_hydl']);
    ctx.owner.setOpacity('csxhjctb_hydl', 0.4);
    ctx.owner.moveLayer('csxhjctb_hydl', 1);
    ctx.owner.setVisible('bgdc_dltb', false);
    await vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DEBOUNCE);

    expect(store.entries.get(KEY)).toStrictEqual({
      version: 1,
      value: {
        displays: {
          bgdc_dltb: { added: true, checked: false, opacity: 1, year: 2022, labeled: false },
          bgdc_cjdcq: { added: false, checked: false, opacity: 1, year: 2024, labeled: false },
          csxhjctb_hydl: { added: true, checked: true, opacity: 0.4, year: 2025, labeled: false }
        },
        order: ['bgdc_dltb', 'csxhjctb_hydl', 'bgdc_cjdcq'],
        batchYear: null
      }
    });
  });
});

describe('资源图层的偏好：二维、三维各一套（ADR 0169）', () => {
  const SHARED = {
    csxhjctb_hydl: { added: true, checked: true, opacity: 0.5, year: 2023 },
    bgdc_dltb: { added: false, checked: false, opacity: 1, year: 2022 },
    bgdc_cjdcq: { added: false, checked: false, opacity: 1, year: 2024 }
  };
  const ORDER = ['csxhjctb_hydl', 'bgdc_dltb', 'bgdc_cjdcq'];

  it('分开以后第一次进来（存下的没有 scene）：三维复制现在共用的那一套；之后各改各的，顶层写二维、scene 写三维', async () => {
    const store = createMemoryStore({
      [KEY]: { version: 1, value: { displays: SHARED, order: ORDER, batchYear: 2023 } }
    });
    using ctx = setup(store, CATALOG, true);
    await vi.advanceTimersByTimeAsync(0);
    expect(layerIds(ctx.owner)).toStrictEqual(['resources-csxhjctb_hydl']);
    ctx.dimension.value = '3d';
    expect(ctx.owner.state.value.displays.get('csxhjctb_hydl')).toMatchObject({ added: true, opacity: 0.5 });
    expect(ctx.owner.batchYear.value).toBe(2023);

    ctx.owner.add(['bgdc_dltb']);
    ctx.owner.setOpacity('csxhjctb_hydl', 0.8);
    await vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DEBOUNCE);

    expect(store.entries.get(KEY)).toMatchObject({
      version: 1,
      value: {
        displays: { csxhjctb_hydl: { opacity: 0.5 }, bgdc_dltb: { added: false } },
        order: ORDER,
        batchYear: 2023,
        scene: {
          displays: { csxhjctb_hydl: { opacity: 0.8 }, bgdc_dltb: { added: true } },
          order: ['bgdc_dltb', 'csxhjctb_hydl', 'bgdc_cjdcq'],
          batchYear: 2023
        }
      }
    });
  });

  it('存下的有 scene：三维按它还原，批量年份也按套；二维的顶层不受影响', async () => {
    const scene = {
      displays: {
        ...SHARED,
        csxhjctb_hydl: { ...SHARED.csxhjctb_hydl, added: false },
        bgdc_cjdcq: { added: true, checked: true, opacity: 0.2, year: 2023 }
      },
      order: ['bgdc_cjdcq', 'csxhjctb_hydl', 'bgdc_dltb'],
      batchYear: 2024
    };
    const store = createMemoryStore({
      [KEY]: { version: 1, value: { displays: SHARED, order: ORDER, batchYear: null, scene } }
    });
    using ctx = setup(store, CATALOG, true);
    await vi.advanceTimersByTimeAsync(0);

    expect(layerIds(ctx.owner)).toStrictEqual(['resources-csxhjctb_hydl']);
    expect(ctx.owner.batchYear.value).toBeNull();
    ctx.dimension.value = '3d';
    expect(layerIds(ctx.owner)).toStrictEqual(['resources-bgdc_cjdcq']);
    expect(ctx.owner.state.value.displays.get('bgdc_cjdcq')).toMatchObject({ opacity: 0.2, year: 2023 });
    expect(ctx.owner.batchYear.value).toBe(2024);
  });

  it('新用户（没有存过）：二三维都按默认加入地类图斑', async () => {
    using ctx = setup(createMemoryStore(), CATALOG, true);
    await vi.advanceTimersByTimeAsync(0);

    expect(layerIds(ctx.owner)).toStrictEqual(['resources-bgdc_dltb']);
    ctx.dimension.value = '3d';
    expect(layerIds(ctx.owner)).toStrictEqual(['resources-bgdc_dltb']);
  });

  it('不分开时：顶层照常是共用的一套；读到的 scene 原样写回，再分开时还在；没有 scene 时写入的也没有', async () => {
    const scene = { displays: SHARED, order: ['bgdc_cjdcq', 'bgdc_dltb', 'csxhjctb_hydl'], batchYear: 2024 };
    const store = createMemoryStore({ [KEY]: { version: 1, value: { displays: SHARED, order: ORDER, scene } } });
    {
      using ctx = setup(store);
      await vi.advanceTimersByTimeAsync(0);
      ctx.dimension.value = '3d';
      ctx.owner.add(['bgdc_dltb']);
      await vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DEBOUNCE);
    }
    expect(store.entries.get(KEY)).toMatchObject({
      value: { displays: { bgdc_dltb: { added: true } }, order: ['bgdc_dltb', 'csxhjctb_hydl', 'bgdc_cjdcq'], scene }
    });

    const fresh = createMemoryStore();
    using ctx = setup(fresh);
    await vi.advanceTimersByTimeAsync(0);
    ctx.owner.add(['bgdc_cjdcq']);
    await vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DEBOUNCE);
    expect(Object.keys(storedValue(fresh))).toStrictEqual(['displays', 'order', 'batchYear']);
  });
});

function storedValue(store: ReturnType<typeof createMemoryStore>): object {
  const entry = store.entries.get(KEY);
  const value: unknown = typeof entry === 'object' && entry !== null && 'value' in entry ? entry.value : null;
  if (typeof value !== 'object' || value === null) {
    throw new Error('没有写入资源图层的偏好');
  }
  return value;
}
