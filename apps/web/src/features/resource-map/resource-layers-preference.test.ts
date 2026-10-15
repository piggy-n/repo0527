import { NO_SOURCE_ERRORS } from '@yzt/map-core';
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

// 拥有者连同偏好的范围；目录由用例决定什么时候到，null 表示还没到
function setup(store: KeyValueStore, catalog: ResourceCatalog | null = CATALOG) {
  const effect = effectScope();
  const source = shallowRef(catalog ?? undefined);
  const { scope } = createTestPreferenceScope(store);
  const owner = effect.run(() =>
    useResourceLayers(
      { sourceErrors: shallowRef(NO_SOURCE_ERRORS) },
      { catalog: source, tileBase: 'http://localhost/tiles/', preferences: scope }
    )
  );
  if (!owner) {
    throw new Error('资源图层的拥有者没有创建');
  }
  return { owner, source, [Symbol.dispose]: () => effect.stop() };
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

  it('顺序和各资源的设置一一对应：通过', () => {
    const value = { displays: { a: display, b: display }, order: ['b', 'a'] };

    expect(storedResourceLayersSchema.safeParse(value).success).toBe(true);
  });

  it('顺序有重复、顺序里的资源没有设置、多出没有排序的设置、透明度越界：不通过', () => {
    // 前两组数量相等，只有"不重复""每一项都有设置"这两条检查能分别拦下
    const invalid = [
      { displays: { a: display, b: display }, order: ['a', 'a'] },
      { displays: { a: display, b: display }, order: ['a', 'c'] },
      { displays: { a: display, b: display }, order: ['a'] },
      { displays: { a: { ...display, opacity: 1.5 } }, order: ['a'] }
    ];

    expect(invalid.map(value => storedResourceLayersSchema.safeParse(value).success)).toStrictEqual([
      false,
      false,
      false,
      false
    ]);
  });
});

describe('资源图层的偏好', () => {
  it('目录先到也要等存储读完才合并；用上次的勾选、透明度、顺序和年份', async () => {
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
      checked: true,
      opacity: 0.5,
      year: 2023
    });
    expect(layerIds(ctx.owner)).toStrictEqual(['resources-csxhjctb_hydl']);
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
    expect(displays.get('bgdc_dltb')?.checked).toBe(true);
    expect(order).toStrictEqual(['bgdc_dltb', 'bgdc_cjdcq', 'csxhjctb_hydl']);
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

  it('批量设置的年份写入，没勾选的资源也写；重新打开时还原', async () => {
    const store = createMemoryStore();
    {
      using ctx = setup(store);
      await vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DEBOUNCE);
      ctx.owner.setYearForAll(2023);
      await vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DEBOUNCE);
    }
    expect(store.entries.get(KEY)).toMatchObject({
      value: { displays: { bgdc_cjdcq: { checked: false, year: 2023 }, csxhjctb_hydl: { year: 2023 } } }
    });

    using reopened = setup(store);
    await vi.advanceTimersByTimeAsync(0);

    expect(reopened.owner.state.value.displays.get('bgdc_cjdcq')?.year).toBe(2023);
    expect(reopened.owner.state.value.displays.get('csxhjctb_hydl')?.year).toBe(2023);
  });

  it('修改后防抖写入：每个资源的设置和面板顺序', async () => {
    const store = createMemoryStore();
    using ctx = setup(store);
    await vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DEBOUNCE);

    ctx.owner.setChecked('csxhjctb_hydl', true);
    ctx.owner.setOpacity('csxhjctb_hydl', 0.4);
    ctx.owner.move('csxhjctb_hydl', 0);
    await vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DEBOUNCE);

    expect(store.entries.get(KEY)).toStrictEqual({
      version: 1,
      value: {
        displays: {
          bgdc_dltb: { checked: true, opacity: 0.9, year: 2022 },
          bgdc_cjdcq: { checked: false, opacity: 0.9, year: 2024 },
          csxhjctb_hydl: { checked: true, opacity: 0.4, year: 2025 }
        },
        order: ['csxhjctb_hydl', 'bgdc_dltb', 'bgdc_cjdcq']
      }
    });
  });
});
