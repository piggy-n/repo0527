import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, shallowRef } from 'vue';
import { createMemoryStore } from '@/shared/storage/key-value-store';
import { createTestPreferenceScope } from '@/shared/storage/testing';
import { PREFERENCE_WRITE_DEBOUNCE } from '@/shared/storage/use-preference';
import type { ResourceTreeLayer } from './api';
import { buildCatalog } from './catalog';
import { useResourceSymbols } from './composables/useResourceSymbols';
import {
  effectiveOverride,
  fromStoredSymbols,
  pruneOverride,
  type ResourceSymbolOverride,
  storedSymbolsSchema,
  targetOverride,
  toStoredSymbols,
  withTargetOverride
} from './resource-symbols';

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

const BLACK = 'rgba(0, 0, 0, 1)';
const BLUE = 'rgba(0, 0, 255, 1)';

describe('effectiveOverride', () => {
  const overrides = new Map<string, ResourceSymbolOverride>([
    ['hydl', { uniform: { color: BLACK }, items: { 河流: { width: 'L' } } }]
  ]);

  it('没有预览、预览的是别的资源时就是确认过的覆盖', () => {
    expect(effectiveOverride(overrides, null, 'hydl')).toBe(overrides.get('hydl'));
    expect(effectiveOverride(overrides, { code: 'other', field: 'color', color: BLUE }, 'hydl')).toBe(overrides.get('hydl'));
  });

  it('预览叠加在目标（统一样式或某个取值）确认过的覆盖上，其他部分不变；没有覆盖的资源也能预览', () => {
    expect(effectiveOverride(overrides, { code: 'hydl', field: 'color', color: BLUE }, 'hydl')).toStrictEqual({
      uniform: { color: BLUE },
      items: { 河流: { width: 'L' } }
    });
    expect(effectiveOverride(overrides, { code: 'hydl', item: '河流', field: 'color', color: BLUE }, 'hydl')).toStrictEqual({
      uniform: { color: BLACK },
      items: { 河流: { width: 'L', color: BLUE } }
    });
    expect(effectiveOverride(new Map(), { code: 'hydl', item: '水渠', field: 'color', color: BLUE }, 'hydl')).toStrictEqual({
      items: { 水渠: { color: BLUE } }
    });
  });
});

describe('覆盖的整理', () => {
  it('去掉空的统一样式和取值，什么都不剩时为 undefined；只选了统一样式也是覆盖', () => {
    expect(pruneOverride({ uniform: {}, items: { 河流: {} } })).toBeUndefined();
    expect(pruneOverride({ mode: 'uniform', uniform: {}, items: { 河流: {}, 水渠: { color: BLUE } } })).toStrictEqual({
      mode: 'uniform',
      items: { 水渠: { color: BLUE } }
    });
  });

  it('换掉目标的覆盖，其他部分保留；换成空的就是去掉', () => {
    const override: ResourceSymbolOverride = { uniform: { color: BLACK }, items: { 河流: { width: 'L' } } };

    expect(targetOverride(override, '河流')).toStrictEqual({ width: 'L' });
    expect(targetOverride(override, undefined)).toStrictEqual({ color: BLACK });
    expect(withTargetOverride(override, '水渠', { color: BLUE })).toStrictEqual({
      uniform: { color: BLACK },
      items: { 河流: { width: 'L' }, 水渠: { color: BLUE } }
    });
    expect(withTargetOverride(override, '河流', {})).toStrictEqual({ uniform: { color: BLACK } });
    expect(withTargetOverride(withTargetOverride(override, '河流', {}), undefined, {})).toBeUndefined();
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

  it('样式方式只存"统一样式"；各取值的覆盖按同样的规则校验', () => {
    const items = { 河流: { width: 'XL', color: BLUE } };
    expect(storedSymbolsSchema.safeParse({ a: { mode: 'uniform', items } }).success).toBe(true);
    expect(storedSymbolsSchema.safeParse({ a: { mode: 'classified' } }).success).toBe(false);
    expect(storedSymbolsSchema.safeParse({ a: { items: { 河流: { width: 20 } } } }).success).toBe(false);
  });

  it('来回转换不变；还原时去掉空的部分，什么都不剩的资源不留', () => {
    const overrides = new Map<string, ResourceSymbolOverride>([
      ['szy_kt', { uniform: { fillColor: BLACK } }],
      ['hydl', { mode: 'uniform', items: { 河流: { width: 'L' } } }]
    ]);

    expect(fromStoredSymbols(toStoredSymbols(overrides))).toStrictEqual(overrides);
    expect(fromStoredSymbols({ a: {}, b: { uniform: {}, items: { 河流: {} } }, c: { items: { 河流: {}, 水渠: { color: BLUE } } } })).toStrictEqual(
      new Map([['c', { items: { 水渠: { color: BLUE } } }]])
    );
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
    expect(ctx.symbols.symbolOf({ code: 'szy_kt' })).toMatchObject({ fillColor: 'rgba(0, 0, 0, 1)' });
  });

  it('确认的改动防抖写入；预览不写入', async () => {
    using ctx = setup();
    await vi.advanceTimersByTimeAsync(0);

    ctx.symbols.previewColor({ code: 'szy_kt' }, 'fillColor', '#00F');
    await vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DEBOUNCE);
    expect(ctx.store.entries.has(KEY)).toBe(false);

    ctx.symbols.setSymbol({ code: 'csxhjctb_gyssp' }, { size: 'L' });
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
