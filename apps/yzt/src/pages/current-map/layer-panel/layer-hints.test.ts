import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';
import { createMemoryStore } from '@/shared/storage/key-value-store';
import { createTestPreferenceScope } from '@/shared/storage/testing';
import { PREFERENCE_WRITE_DEBOUNCE } from '@/shared/storage/use-preference';
import { LAYER_HINT_GROUPS, LAYER_HINTS, requestKindsOf, resourceStatusKindsOf, shownHintsOf } from './layer-hints';
import { useLayerHints } from './useLayerHints';

const KEY = 'zhangsan/layer-hints';

function setup(store = createMemoryStore()) {
  const effect = effectScope();
  const { scope } = createTestPreferenceScope(store);
  const hints = effect.run(() => useLayerHints({ preferences: scope }));
  if (!hints) {
    throw new Error('提示的开关没有创建');
  }
  return { hints, store, [Symbol.dispose]: () => effect.stop() };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('行内提示的种类（ADR 0167）', () => {
  it('两组正好是全部种类，不重复', () => {
    expect(LAYER_HINT_GROUPS.flatMap(group => group.hints)).toStrictEqual([...LAYER_HINTS]);
  });

  it('记下的是关掉的：认不出的忽略，没记下的（以后加的）开着', () => {
    expect(shownHintsOf({ hidden: ['failed', 'covering', 'renamed'] })).toStrictEqual(
      new Set(['loading', 'done', 'config-error', 'minzoom'])
    );
  });

  it('数据加载按前三类；资源的状态图标里瓦片失败跟着加载失败', () => {
    const shown = new Set(['loading', 'minzoom'] as const);
    expect(requestKindsOf(shown)).toStrictEqual({ loading: true, failed: false, done: false });
    expect(resourceStatusKindsOf(shown)).toStrictEqual(['minzoom']);
    expect(resourceStatusKindsOf(new Set(LAYER_HINTS))).toStrictEqual(['config-error', 'tile-error', 'minzoom']);
  });
});

describe('useLayerHints：按账号记住（ADR 0167）', () => {
  it('默认全开；关掉一类、全关、全开，防抖写入关掉的', async () => {
    using ctx = setup();
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.hints.shown.value).toStrictEqual(new Set(LAYER_HINTS));

    ctx.hints.setShown('failed', false);
    expect(ctx.hints.requestKinds.value).toStrictEqual({ loading: true, failed: false, done: true });
    await vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DEBOUNCE);
    expect(ctx.store.entries.get(KEY)).toStrictEqual({ version: 1, value: { hidden: ['failed'] } });

    ctx.hints.setAll(false);
    expect(ctx.hints.shown.value.size).toBe(0);
    ctx.hints.setAll(true);
    await vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DEBOUNCE);
    expect(ctx.store.entries.get(KEY)).toStrictEqual({ version: 1, value: { hidden: [] } });
  });

  it('恢复记下的', async () => {
    using ctx = setup(createMemoryStore({ [KEY]: { version: 1, value: { hidden: ['loading', 'covering'] } } }));
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.hints.shown.value).toStrictEqual(new Set(['failed', 'done', 'config-error', 'minzoom']));
    expect(ctx.hints.statusKinds.value).toStrictEqual(['config-error', 'tile-error', 'minzoom']);
  });
});
