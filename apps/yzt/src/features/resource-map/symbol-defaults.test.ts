import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, shallowRef } from 'vue';
import { createMemoryStore } from '@/shared/storage/key-value-store';
import { required } from '@/shared/testing/required';
import { createTestPreferenceScope } from '@/shared/storage/testing';
import { PREFERENCE_WRITE_DEBOUNCE } from '@/shared/storage/use-preference';
import type { ResourceTreeLayer } from './api';
import { buildCatalog } from './catalog';
import { useResourceSymbols } from './composables/useResourceSymbols';
import { defaultSymbol, resourceStyleLayers } from './style-registry';
import { symbolLayers } from './symbols';

// 发布的默认符号（ADR 0154）换成固定的一份：用户的覆盖叠加在它上面，没调过的用户直接看到它
const SHIPPED = vi.hoisted(() => ({
  // 不按属性配色的面：只有统一样式
  bgdc_ccwjq: { uniform: { fillColor: 'rgba(255, 0, 0, 1)', outlineWidth: 'L' } },
  // 按属性配色的线，默认改成统一样式
  csxhjctb_hydl: { mode: 'uniform', uniform: { color: 'rgba(0, 0, 0, 1)' }, items: { 河流: { width: 'L' } } },
  // 按属性配色的点，只调了一个取值，默认仍是分类样式
  csxhjctb_gyssp: { items: { '080901': { size: 'L' } } }
}));

vi.mock('./resource-symbol-defaults.json', () => ({ default: SHIPPED }));

const KEY = 'zhangsan/resource-symbols';
const RED = 'rgba(255, 0, 0, 1)';
const BLUE = 'rgba(0, 0, 255, 1)';
const BLACK = 'rgba(0, 0, 0, 1)';

function layer(code: string, geoType: ResourceTreeLayer['geoType']) {
  return { code, name: code, geoType, yearList: [2022] as [number] };
}

const CATALOG = buildCatalog([
  {
    code: null,
    name: '测试',
    children: [
      layer('bgdc_ccwjq', 'Polygon'),
      layer('csxhjctb_hydl', 'Line'),
      layer('csxhjctb_gyssp', 'Point'),
      layer('szy_kt', 'Polygon')
    ]
  }
]);

const resourceOf = (code: string) => required(CATALOG.resources.get(code), `目录里的 ${code}`);

function setup(store = createMemoryStore()) {
  const effect = effectScope();
  const { scope } = createTestPreferenceScope(store);
  const symbols = required(
    effect.run(() => useResourceSymbols({ catalog: shallowRef(CATALOG), preferences: scope })),
    '符号的拥有者'
  );
  return { symbols, store, [Symbol.dispose]: () => effect.stop() };
}

describe('发布的默认符号', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('叠加在算出的默认符号上：没调过的用户看到它，不算自定义', async () => {
    using ctx = setup();
    await vi.advanceTimersByTimeAsync(0);
    const { symbols } = ctx;

    expect(defaultSymbol(resourceOf('bgdc_ccwjq'))).toMatchObject({
      fillColor: RED,
      outlineWidth: 'L',
      outlineDash: 'solid'
    });
    expect(symbols.symbolOf({ code: 'bgdc_ccwjq' })).toMatchObject({ fillColor: RED, outlineWidth: 'L' });
    expect(symbols.symbolOf({ code: 'csxhjctb_hydl', item: '河流' })).toMatchObject({ width: 'L' });
    expect(symbols.symbolOf({ code: 'csxhjctb_gyssp', item: '080901' })).toMatchObject({ size: 'L' });
    expect(symbols.modeOf('csxhjctb_hydl')).toBe('uniform');
    expect(symbols.modeOf('csxhjctb_gyssp')).toBe('classified');
    expect(symbols.modeOf('szy_kt')).toBe('classified');
    expect(['bgdc_ccwjq', 'csxhjctb_hydl', 'csxhjctb_gyssp'].some(code => symbols.isCustomized(code))).toBe(false);
    // 地图和图例用的推导同样从发布的默认符号出发
    expect(resourceStyleLayers(resourceOf('csxhjctb_hydl'))).toStrictEqual(
      symbolLayers({ geometry: 'line', color: BLACK, width: 'M', dash: 'solid' })
    );
  });

  it('已经保存的覆盖照样读出，叠加在上面：改过的字段是用户的值，没改过的跟随新的默认，读出后不写回', async () => {
    // 以前的版本写下的数据：只记和当时的默认不同的字段
    const value = {
      bgdc_ccwjq: { uniform: { fillColor: BLUE } },
      csxhjctb_hydl: { items: { 水渠: { color: BLUE } } },
      csxhjctb_gyssp: { uniform: { size: 'S' } },
      gone: { uniform: { color: BLUE } }
    };
    using ctx = setup(createMemoryStore({ [KEY]: { version: 1, value } }));
    await vi.advanceTimersByTimeAsync(0);
    const { symbols } = ctx;

    expect(symbols.overrides.value).toStrictEqual(new Map(Object.entries(value)));
    expect(symbols.symbolOf({ code: 'bgdc_ccwjq' })).toMatchObject({ fillColor: BLUE, outlineWidth: 'L' });
    expect(symbols.symbolOf({ code: 'csxhjctb_hydl', item: '水渠' })).toMatchObject({ color: BLUE, width: 'M' });
    expect(symbols.symbolOf({ code: 'csxhjctb_hydl', item: '河流' })).toMatchObject({ width: 'L' });
    // 只调过取值的用户还是分类样式，调过统一样式的还是统一样式
    expect(symbols.modeOf('csxhjctb_hydl')).toBe('classified');
    expect(symbols.modeOf('csxhjctb_gyssp')).toBe('uniform');

    await vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DEBOUNCE);
    expect(ctx.store.entries.get(KEY)).toStrictEqual({ version: 1, value });
  });

  it('改动和新的默认比较，恢复默认回到发布的默认符号', async () => {
    using ctx = setup();
    await vi.advanceTimersByTimeAsync(0);
    const { symbols } = ctx;
    const target = { code: 'bgdc_ccwjq' };

    symbols.setSymbol(target, { fillColor: '#F00' });
    expect(symbols.isCustomized('bgdc_ccwjq')).toBe(false);

    // 和代码算出的默认相同、和发布的默认不同，也要记下
    symbols.setSymbol(target, { outlineWidth: 'M', fillColor: BLUE });
    expect(symbols.overrides.value.get('bgdc_ccwjq')).toStrictEqual({
      uniform: { fillColor: BLUE, outlineWidth: 'M' }
    });

    symbols.resetResource('bgdc_ccwjq');
    expect(symbols.symbolOf(target)).toMatchObject({ fillColor: RED, outlineWidth: 'L' });
  });

  it('默认是统一样式的资源：选分类样式要记下，保存后再打开还是分类样式；再选回统一样式就不用记', async () => {
    const store = createMemoryStore();
    {
      using ctx = setup(store);
      await vi.advanceTimersByTimeAsync(0);
      ctx.symbols.setMode('csxhjctb_hydl', 'classified');
      expect(ctx.symbols.overrides.value.get('csxhjctb_hydl')).toStrictEqual({ mode: 'classified' });
      expect(ctx.symbols.modeOf('csxhjctb_hydl')).toBe('classified');

      // 拖动取色的预览不丢掉选的方式
      ctx.symbols.previewColor({ code: 'csxhjctb_hydl', item: '河流' }, 'color', '#F00');
      expect(ctx.symbols.overrideOf('csxhjctb_hydl')).toStrictEqual({
        mode: 'classified',
        items: { 河流: { color: RED } }
      });
      ctx.symbols.clearPreview({ code: 'csxhjctb_hydl', item: '河流' });
      await vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DEBOUNCE);
    }
    expect(store.entries.get(KEY)).toStrictEqual({ version: 1, value: { csxhjctb_hydl: { mode: 'classified' } } });

    using reopened = setup(store);
    await vi.advanceTimersByTimeAsync(0);
    expect(reopened.symbols.modeOf('csxhjctb_hydl')).toBe('classified');

    reopened.symbols.setMode('csxhjctb_hydl', 'uniform');
    expect(reopened.symbols.isCustomized('csxhjctb_hydl')).toBe(false);
  });

  it('选的分类样式不随取值的改动、恢复丢掉；调过取值的用户选统一样式要记下，否则按调过的内容推成分类样式', async () => {
    using ctx = setup();
    await vi.advanceTimersByTimeAsync(0);
    const { symbols } = ctx;
    const target = { code: 'csxhjctb_hydl', item: '水渠' };

    symbols.setMode('csxhjctb_hydl', 'classified');
    symbols.setSymbol(target, { color: BLUE });
    symbols.resetSymbol(target);
    expect(symbols.modeOf('csxhjctb_hydl')).toBe('classified');

    symbols.setSymbol(target, { color: BLUE });
    symbols.setMode('csxhjctb_hydl', 'uniform');

    expect(symbols.overrides.value.get('csxhjctb_hydl')).toStrictEqual({
      mode: 'uniform',
      items: { 水渠: { color: BLUE } }
    });
    expect(symbols.modeOf('csxhjctb_hydl')).toBe('uniform');
  });
});
