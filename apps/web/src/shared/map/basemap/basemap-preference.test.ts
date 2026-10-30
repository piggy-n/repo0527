import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';
import { createMemoryStore } from '../../storage/key-value-store';
import { createTestPreferenceScope } from '../../storage/testing';
import { PREFERENCE_WRITE_DEBOUNCE } from '../../storage/use-preference';
import { restoredBasemapState } from './basemap-preference';
import { basemapOptions, initialBasemapState } from './basemap-style';
import { useBasemap } from './useBasemap';

const TIANDITU = { key: 'test-key' };
const KEY = 'zhangsan/basemap';

// 底图的拥有者连同偏好的范围，在 effectScope 里创建，用例结束时停止
function setup(store = createMemoryStore(), tianditu: typeof TIANDITU | null = TIANDITU) {
  const effect = effectScope();
  const { scope } = createTestPreferenceScope(store);
  const basemap = effect.run(() => useBasemap({ tianditu, preferences: scope }));
  if (!basemap) {
    throw new Error('底图的拥有者没有创建');
  }
  return { basemap, store, [Symbol.dispose]: () => effect.stop() };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('底图的偏好', () => {
  it('恢复上次选择的底图和它的透明度', async () => {
    const stored = { version: 1, value: { selected: 'imagery', opacity: { vector: 1, imagery: 0.6 } } };
    using ctx = setup(createMemoryStore({ [KEY]: stored }));
    expect(ctx.basemap.selected.value).toBe('vector');

    await vi.advanceTimersByTimeAsync(0);

    expect(ctx.basemap.selected.value).toBe('imagery');
    expect(ctx.basemap.opacity.value).toBe(0.6);
  });

  it('选择、改透明度后防抖写入', async () => {
    using ctx = setup();
    await vi.advanceTimersByTimeAsync(0);

    ctx.basemap.select('imagery');
    ctx.basemap.setOpacity(0.4);
    await vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DEBOUNCE);

    expect(ctx.store.entries.get(KEY)).toStrictEqual({
      version: 1,
      value: { selected: 'imagery', opacity: { vector: 1, imagery: 0.4 } }
    });
  });

  it('切换到三维时自动换成影像不写进偏好，透明度照常写；用户自己选的底图照常写（ADR 0114）', async () => {
    using ctx = setup();
    await vi.advanceTimersByTimeAsync(0);

    ctx.basemap.selectForDimension('3d');
    ctx.basemap.setOpacity(0.5);
    await vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DEBOUNCE);
    expect(ctx.basemap.selected.value).toBe('imagery');
    expect(ctx.store.entries.get(KEY)).toStrictEqual({
      version: 1,
      value: { selected: 'vector', opacity: { vector: 1, imagery: 0.5 } }
    });

    ctx.basemap.select('imagery');
    await vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DEBOUNCE);
    expect(ctx.store.entries.get(KEY)).toMatchObject({ value: { selected: 'imagery' } });
  });

  it('存下的底图当前不可用（没有配置天地图）：保留"无底图"', async () => {
    const stored = { version: 1, value: { selected: 'vector', opacity: { vector: 0.5, imagery: 1 } } };
    using ctx = setup(createMemoryStore({ [KEY]: stored }), null);

    await vi.advanceTimersByTimeAsync(0);

    expect(ctx.basemap.selected.value).toBe('none');
  });

  it('透明度越界：当作没有存过', async () => {
    const stored = { version: 1, value: { selected: 'imagery', opacity: { vector: 1, imagery: 1.5 } } };
    using ctx = setup(createMemoryStore({ [KEY]: stored }));

    await vi.advanceTimersByTimeAsync(0);

    expect(ctx.basemap.selected.value).toBe('vector');
  });
});

describe('restoredBasemapState', () => {
  it('选中的底图可用就恢复它；不可用时保留当前的选择，透明度照样恢复', () => {
    const stored = { selected: 'imagery' as const, opacity: { vector: 0.3, imagery: 0.7 } };

    expect(restoredBasemapState(stored, initialBasemapState(TIANDITU), basemapOptions(TIANDITU))).toStrictEqual(stored);
    expect(restoredBasemapState(stored, initialBasemapState(null), basemapOptions(null))).toStrictEqual({
      selected: 'none',
      opacity: { vector: 0.3, imagery: 0.7 }
    });
  });
});
