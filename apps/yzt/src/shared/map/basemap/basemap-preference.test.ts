import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { z } from 'zod';
import type { ServerBasemapId } from '../../config/server-basemap-options';
import { effectScope } from 'vue';
import { createMemoryStore } from '../../storage/key-value-store';
import { createTestPreferenceScope } from '../../storage/testing';
import { PREFERENCE_WRITE_DEBOUNCE } from '../../storage/use-preference';
import { restoredBasemapState, type storedBasemapSchema } from './basemap-preference';
import { type BasemapId, basemapOptions, initialBasemapState } from './basemap-style';
import type { ServerBasemaps } from './server-basemaps';
import { useBasemap } from './useBasemap';

const TIANDITU = { key: 'test-key' };
const KEY = 'zhangsan/basemap';
const VERSION = 2;
// 服务器底图加进来以后多的三项透明度
const SERVER_OPACITY = { standard: 1, black: 1, 'night-blue': 1 };

// 探测到的服务器底图（ADR 0165）
const servers = (...ids: ServerBasemapId[]): ServerBasemaps =>
  ids.map(id => ({ id, root: `http://intranet.test/basemap/${id}/`, thumbnail: 'data:image/png;base64,' }));

// 底图的拥有者连同偏好的范围，在 effectScope 里创建，用例结束时停止
function setup(store = createMemoryStore(), tianditu: typeof TIANDITU | null = TIANDITU, found: ServerBasemaps = []) {
  const effect = effectScope();
  const { scope } = createTestPreferenceScope(store);
  const basemap = effect.run(() => useBasemap({ tianditu, servers: found, preferences: scope }));
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
    const stored = { version: VERSION, value: { selected: 'imagery', opacity: { vector: 1, imagery: 0.6, static: 1 } } };
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
      version: VERSION,
      value: { selected: 'imagery', opacity: { vector: 1, imagery: 0.4, static: 1, ...SERVER_OPACITY } }
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
      version: VERSION,
      value: { selected: 'vector', opacity: { vector: 1, imagery: 0.5, static: 1, ...SERVER_OPACITY } }
    });

    ctx.basemap.select('imagery');
    await vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DEBOUNCE);
    expect(ctx.store.entries.get(KEY)).toMatchObject({ value: { selected: 'imagery' } });
  });

  it('内网恢复上次的静态底图和它的透明度', async () => {
    const stored = { version: VERSION, value: { selected: 'static', opacity: { vector: 1, imagery: 1, static: 0.3 } } };
    using ctx = setup(createMemoryStore({ [KEY]: stored }), null);

    await vi.advanceTimersByTimeAsync(0);

    expect(ctx.basemap.selected.value).toBe('static');
    expect(ctx.basemap.opacity.value).toBe(0.3);
  });

  it('内网恢复用户选的无底图，也写入静态底图的透明度', async () => {
    const stored = { version: VERSION, value: { selected: 'none', opacity: { vector: 1, imagery: 1, static: 0.3 } } };
    using ctx = setup(createMemoryStore({ [KEY]: stored }), null);

    await vi.advanceTimersByTimeAsync(0);

    expect(ctx.basemap.selected.value).toBe('none');
    ctx.basemap.select('static');
    expect(ctx.basemap.opacity.value).toBe(0.3);
    await vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DEBOUNCE);
    expect(ctx.store.entries.get(KEY)).toMatchObject({ value: { selected: 'static' } });
  });

  it('版本 1 存下的"无底图"不是用户的选择（内网当时只有它）：当作没有存过，内网仍是静态底图', async () => {
    const stored = { version: 1, value: { selected: 'none', opacity: { vector: 1, imagery: 1 } } };
    using ctx = setup(createMemoryStore({ [KEY]: stored }), null);

    await vi.advanceTimersByTimeAsync(0);

    expect(ctx.basemap.selected.value).toBe('static');
  });

  it('存下的底图当前不可用（换了部署环境）：内网保留静态底图，公网保留矢量底图', async () => {
    const onlinePick = { version: VERSION, value: { selected: 'vector', opacity: { vector: 0.5, imagery: 1, static: 1 } } };
    using intranet = setup(createMemoryStore({ [KEY]: onlinePick }), null);
    const intranetPick = { version: VERSION, value: { selected: 'static', opacity: { vector: 1, imagery: 1, static: 1 } } };
    using online = setup(createMemoryStore({ [KEY]: intranetPick }));

    await vi.advanceTimersByTimeAsync(0);

    expect(intranet.basemap.selected.value).toBe('static');
    expect(online.basemap.selected.value).toBe('vector');
  });

  it('服务器底图加进来以前存的版本 2（只有三项透明度）照样恢复，新的三项按 1', async () => {
    const opacity = { vector: 1, imagery: 0.6, static: 0.3 };
    const stored = { version: VERSION, value: { selected: 'static', opacity } };
    using ctx = setup(createMemoryStore({ [KEY]: stored }), null, servers('standard', 'imagery'));
    expect(ctx.basemap.selected.value).toBe('standard');

    await vi.advanceTimersByTimeAsync(0);

    expect(ctx.basemap.selected.value).toBe('static');
    expect(ctx.basemap.opacity.value).toBe(0.3);
    ctx.basemap.select('standard');
    expect(ctx.basemap.opacity.value).toBe(1);
    ctx.basemap.select('imagery');
    expect(ctx.basemap.opacity.value).toBe(0.6);
  });

  it('内网恢复存下的服务器底图和它的透明度，写入时带上服务器底图的透明度', async () => {
    const stored = {
      version: VERSION,
      value: { selected: 'black', opacity: { vector: 1, imagery: 1, static: 1, ...SERVER_OPACITY, black: 0.4 } }
    };
    using ctx = setup(createMemoryStore({ [KEY]: stored }), null, servers('standard', 'black'));

    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.basemap.selected.value).toBe('black');
    expect(ctx.basemap.opacity.value).toBe(0.4);

    ctx.basemap.select('standard');
    ctx.basemap.setOpacity(0.7);
    await vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DEBOUNCE);
    expect(ctx.store.entries.get(KEY)).toStrictEqual({
      version: VERSION,
      value: {
        selected: 'standard',
        opacity: { vector: 1, imagery: 1, static: 1, standard: 0.7, black: 0.4, 'night-blue': 1 }
      }
    });
  });

  it('存下的服务器底图这台服务器没有：保留当前的选择（有标准时是标准，没有时是静态）', async () => {
    const opacity = { vector: 1, imagery: 1, static: 1, ...SERVER_OPACITY, 'night-blue': 0.2 };
    const stored = { version: VERSION, value: { selected: 'night-blue', opacity } };
    using withStandard = setup(createMemoryStore({ [KEY]: stored }), null, servers('standard', 'imagery'));
    using bare = setup(createMemoryStore({ [KEY]: stored }), null);
    using online = setup(createMemoryStore({ [KEY]: stored }));

    await vi.advanceTimersByTimeAsync(0);

    expect(withStandard.basemap.selected.value).toBe('standard');
    expect(bare.basemap.selected.value).toBe('static');
    expect(online.basemap.selected.value).toBe('vector');
  });

  it('透明度越界：当作没有存过', async () => {
    const stored = { version: VERSION, value: { selected: 'imagery', opacity: { vector: 1, imagery: 1.5, static: 1 } } };
    using ctx = setup(createMemoryStore({ [KEY]: stored }));

    await vi.advanceTimersByTimeAsync(0);

    expect(ctx.basemap.selected.value).toBe('vector');
  });
});

describe('标注的偏好（ADR 0146）', () => {
  const LABELS_KEY = 'zhangsan/basemap-labels';

  it('恢复存下的显隐，覆盖进入时的默认值', async () => {
    using online = setup(createMemoryStore({ [LABELS_KEY]: { version: 1, value: false } }));
    using intranet = setup(createMemoryStore({ [LABELS_KEY]: { version: 1, value: true } }), null);
    expect([online.basemap.labelsVisible.value, intranet.basemap.labelsVisible.value]).toStrictEqual([true, false]);

    await vi.advanceTimersByTimeAsync(0);

    expect([online.basemap.labelsVisible.value, intranet.basemap.labelsVisible.value]).toStrictEqual([false, true]);
    expect(intranet.basemap.deriveLabelsGroup().layers).not.toHaveLength(0);
  });

  it('切换后防抖写入自己的键，不写进底图的偏好', async () => {
    using ctx = setup();
    await vi.advanceTimersByTimeAsync(0);

    ctx.basemap.setLabelsVisible(false);
    await vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DEBOUNCE);

    expect(ctx.store.entries.get(LABELS_KEY)).toStrictEqual({ version: 1, value: false });
    expect(ctx.store.entries.has(KEY)).toBe(false);
  });

  it('两项一起恢复时都生效：底图的恢复不算用户操作过标注，反过来也一样', async () => {
    const basemapValue = { selected: 'imagery', opacity: { vector: 1, imagery: 0.6, static: 1 } };
    using ctx = setup(
      createMemoryStore({ [KEY]: { version: VERSION, value: basemapValue }, [LABELS_KEY]: { version: 1, value: false } })
    );

    await vi.advanceTimersByTimeAsync(0);

    expect(ctx.basemap.selected.value).toBe('imagery');
    expect(ctx.basemap.labelsVisible.value).toBe(false);
  });

  it('改透明度不写标注的键', async () => {
    using ctx = setup();
    await vi.advanceTimersByTimeAsync(0);

    ctx.basemap.setOpacity(0.5);
    await vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DEBOUNCE);

    expect(ctx.store.entries.has(LABELS_KEY)).toBe(false);
  });

  it('存的不是布尔值：当作没有存过', async () => {
    using ctx = setup(createMemoryStore({ [LABELS_KEY]: { version: 1, value: 'off' } }));

    await vi.advanceTimersByTimeAsync(0);

    expect(ctx.basemap.labelsVisible.value).toBe(true);
  });
});

describe('restoredBasemapState', () => {
  it('选中的底图可用就恢复它；不可用时保留当前的选择，透明度照样恢复', () => {
    const opacity = { vector: 0.3, imagery: 0.7, static: 0.2, ...SERVER_OPACITY };
    const stored = { selected: 'imagery' as const, opacity };

    expect(restoredBasemapState(stored, initialBasemapState(TIANDITU), basemapOptions(TIANDITU))).toStrictEqual(stored);
    expect(restoredBasemapState(stored, initialBasemapState(null), basemapOptions(null))).toStrictEqual({
      selected: 'static',
      opacity: { vector: 0.3, imagery: 0.7, static: 0.2, ...SERVER_OPACITY }
    });
    const imageryServer = servers('imagery');
    expect(
      restoredBasemapState(stored, initialBasemapState(null, imageryServer), basemapOptions(null, imageryServer))
    ).toStrictEqual(stored);
  });

  it('存下的底图 ID 和 BasemapId 一致，透明度的键和有画面的底图一致', () => {
    type Stored = z.infer<typeof storedBasemapSchema>;
    expectTypeOf<Stored['selected']>().toEqualTypeOf<BasemapId>();
    expectTypeOf<keyof Stored['opacity']>().toEqualTypeOf<Exclude<BasemapId, 'none'>>();
  });
});
