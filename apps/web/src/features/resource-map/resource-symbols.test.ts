import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, shallowRef } from 'vue';
import { createMemoryStore } from '@/shared/storage/key-value-store';
import { createTestPreferenceScope } from '@/shared/storage/testing';
import { PREFERENCE_WRITE_DEBOUNCE } from '@/shared/storage/use-preference';
import type { ResourceTreeLayer } from './api';
import { buildCatalog } from './catalog';
import { useResourceSymbols } from './composables/useResourceSymbols';
import { effectiveOverride, fromStoredSymbols, storedSymbolsSchema, toStoredSymbols } from './resource-symbols';

const KEY = 'zhangsan/resource-symbols';

function layer(code: string, geoType: ResourceTreeLayer['geoType']) {
  return { code, name: code, geoType, yearList: [2022] as [number] };
}

const CATALOG = buildCatalog([
  { code: null, name: '测试', children: [layer('csxhjctb_gyssp', 'Point'), layer('szy_kt', 'Polygon')] }
]);

function setup(store = createMemoryStore()) {
  const effect = effectScope();
  const { scope } = createTestPreferenceScope(store);
  const symbols = effect.run(() => useResourceSymbols({ catalog: shallowRef(CATALOG), preferences: scope }));
  if (!symbols) {
    throw new Error('拥有者没有创建');
  }
  return { symbols, store, [Symbol.dispose]: () => effect.stop() };
}

describe('effectiveOverride', () => {
  const overrides = new Map([['szy_kt', { uniform: { outlineColor: 'rgba(0, 0, 0, 1)' } }]]);

  it('没有预览、预览的是别的资源时就是确认过的覆盖', () => {
    expect(effectiveOverride(overrides, null, 'szy_kt')).toBe(overrides.get('szy_kt')?.uniform);
    expect(effectiveOverride(overrides, { code: 'other', field: 'color', color: 'red' }, 'szy_kt')).toStrictEqual({
      outlineColor: 'rgba(0, 0, 0, 1)'
    });
  });

  it('预览的字段叠加在确认过的覆盖上；没有覆盖的资源也能预览', () => {
    const preview = { code: 'szy_kt', field: 'fillColor', color: 'rgba(0, 0, 255, 1)' } as const;

    expect(effectiveOverride(overrides, preview, 'szy_kt')).toStrictEqual({
      outlineColor: 'rgba(0, 0, 0, 1)',
      fillColor: 'rgba(0, 0, 255, 1)'
    });
    expect(effectiveOverride(new Map(), preview, 'szy_kt')).toStrictEqual({ fillColor: 'rgba(0, 0, 255, 1)' });
  });
});

describe('存储格式', () => {
  it('校验字段的范围和颜色：大小是四档或范围内的数，描边宽度只能是 0～3 的整数，线型是四种之一', () => {
    const valid = { a: { uniform: { size: 20, fillColor: 'rgba(0, 0, 0, 1)', strokeWidth: 0, dash: 'dashDot' } } };
    expect(storedSymbolsSchema.safeParse(valid).success).toBe(true);
    expect(storedSymbolsSchema.safeParse({ a: {} }).success).toBe(true);

    const invalid = [
      { size: 20.5 },
      { size: 'XXL' },
      { width: 0.4 },
      { fillColor: '不是颜色' },
      { strokeWidth: 1.5 },
      { strokeWidth: 4 },
      { dash: 'wavy' }
    ];
    expect(invalid.filter(uniform => storedSymbolsSchema.safeParse({ a: { uniform } }).success)).toStrictEqual([]);
  });

  it('来回转换不变；还原时没有字段的资源不留', () => {
    const overrides = new Map([['szy_kt', { uniform: { fillColor: 'rgba(0, 0, 0, 1)' } }]]);

    expect(fromStoredSymbols(toStoredSymbols(overrides))).toStrictEqual(overrides);
    expect(fromStoredSymbols({ a: {}, b: { uniform: {} } })).toStrictEqual(new Map());
  });
});

describe('符号的偏好', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('恢复上次的覆盖，目录里没有了的资源也保留', async () => {
    const value = { szy_kt: { uniform: { fillColor: 'rgba(0, 0, 0, 1)' } }, gone: { uniform: { color: 'red' } } };
    using ctx = setup(createMemoryStore({ [KEY]: { version: 1, value } }));

    await vi.advanceTimersByTimeAsync(0);

    expect(ctx.symbols.overrides.value).toStrictEqual(new Map(Object.entries(value)));
    expect(ctx.symbols.symbolOf('szy_kt')).toMatchObject({ fillColor: 'rgba(0, 0, 0, 1)' });
  });

  it('确认的改动防抖写入；预览不写入', async () => {
    using ctx = setup();
    await vi.advanceTimersByTimeAsync(0);

    ctx.symbols.previewColor('szy_kt', 'fillColor', '#00F');
    await vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DEBOUNCE);
    expect(ctx.store.entries.has(KEY)).toBe(false);

    ctx.symbols.setUniform('csxhjctb_gyssp', { size: 'L' });
    await vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DEBOUNCE);
    expect(ctx.store.entries.get(KEY)).toStrictEqual({ version: 1, value: { csxhjctb_gyssp: { uniform: { size: 'L' } } } });
  });

  it('有一项不合法时整条作废，用默认符号', async () => {
    const value = { szy_kt: { uniform: { fillColor: 'rgba(0, 0, 0, 1)' } }, csxhjctb_gyssp: { uniform: { size: 99 } } };
    using ctx = setup(createMemoryStore({ [KEY]: { version: 1, value } }));

    await vi.advanceTimersByTimeAsync(0);

    expect(ctx.symbols.overrides.value.size).toBe(0);
  });
});
