import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { effectScope, shallowRef } from 'vue';
import { z } from 'zod';
import type { PreferenceName } from '../config/app-config';
import { createMemoryStore, type KeyValueStore } from './key-value-store';
import type { PreferenceScope } from './preference-scope';
import { PREFERENCE_READ_TIMEOUT, PREFERENCE_WRITE_DEBOUNCE, usePreference } from './use-preference';

const schema = z.object({ count: z.number().int().min(0) });
type Counter = z.infer<typeof schema>;

// 名称只影响键和开关；流程的用例随便用一项，开关的用例逐项走
const NAME = 'boundaries';
const KEY = `zhangsan/${NAME}`;

// 读取由用例决定什么时候返回的存储；写入照常记在内存里
function deferredStore() {
  const memory = createMemoryStore();
  const reads: ((value: unknown) => void)[] = [];
  const store: KeyValueStore = {
    ...memory,
    get: () => new Promise(resolve => reads.push(resolve))
  };
  return { store, entries: memory.entries, resolveRead: (value: unknown) => reads.forEach(resolve => resolve(value)) };
}

// 拥有者：状态是一个计数，恢复时直接采用存下的值；范围的生命期由用例结束
function setup(store: KeyValueStore, name: PreferenceName = NAME, use: typeof usePreference = usePreference) {
  const lifetime = new AbortController();
  const errors: unknown[] = [];
  const scope: PreferenceScope = {
    store,
    key: item => `zhangsan/${item}`,
    signal: lifetime.signal,
    onError: error => errors.push(error)
  };
  const state = shallowRef<Counter>({ count: 0 });
  const restored: (Counter | null)[] = [];
  const effect = effectScope();
  effect.run(() =>
    use(scope, {
      name,
      version: 1,
      schema,
      snapshot: () => state.value,
      restore: stored => {
        restored.push(stored);
        if (stored) {
          state.value = stored;
        }
      }
    })
  );
  return { state, restored, errors, lifetime, effect, [Symbol.dispose]: () => effect.stop() };
}

// 内存存储的读取只经过微任务
const flushReads = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('usePreference：恢复', () => {
  it('读到合法的值：恢复一次，交给拥有者合并', async () => {
    using ctx = setup(createMemoryStore({ [KEY]: { version: 1, value: { count: 3 } } }));

    await flushReads();

    expect(ctx.restored).toStrictEqual([{ count: 3 }]);
    expect(ctx.state.value).toStrictEqual({ count: 3 });
  });

  it('没有存过、版本不对、格式不对：恢复为 null，按默认值继续', async () => {
    const stores = [
      createMemoryStore(),
      createMemoryStore({ [KEY]: { version: 2, value: { count: 3 } } }),
      createMemoryStore({ [KEY]: { version: 1, value: { count: -1 } } }),
      createMemoryStore({ [KEY]: { count: 3 } })
    ];
    const contexts = stores.map(store => setup(store));

    await flushReads();

    expect(contexts.map(ctx => ctx.restored)).toStrictEqual([[null], [null], [null], [null]]);
    contexts.forEach(ctx => ctx[Symbol.dispose]());
  });

  it('读取失败：上报，恢复为 null', async () => {
    const failure = new Error('IndexedDB 不可用');
    using ctx = setup({ ...createMemoryStore(), get: () => Promise.reject(failure) });

    await flushReads();

    expect(ctx.restored).toStrictEqual([null]);
    expect(ctx.errors).toStrictEqual([failure]);
  });

  it('读取超过上限：按默认值继续，之后才到的结果丢弃', async () => {
    const deferred = deferredStore();
    using ctx = setup(deferred.store);

    await vi.advanceTimersByTimeAsync(PREFERENCE_READ_TIMEOUT - 1);
    expect(ctx.restored).toStrictEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(ctx.restored).toStrictEqual([null]);

    deferred.resolveRead({ version: 1, value: { count: 3 } });
    await flushReads();
    expect(ctx.restored).toStrictEqual([null]);
    expect(ctx.state.value).toStrictEqual({ count: 0 });
  });

  it('恢复之前用户已经操作过：放弃恢复，并保存这次操作', async () => {
    const deferred = deferredStore();
    using ctx = setup(deferred.store);

    ctx.state.value = { count: 5 };
    deferred.resolveRead({ version: 1, value: { count: 3 } });
    await flushReads();

    expect(ctx.restored).toStrictEqual([null]);
    expect(ctx.state.value).toStrictEqual({ count: 5 });
    await vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DEBOUNCE);
    expect(deferred.entries.get(KEY)).toStrictEqual({ version: 1, value: { count: 5 } });
  });

  it('拥有者的 restore 抛错：交给 onError', async () => {
    const failure = new Error('合并失败');
    const lifetime = new AbortController();
    const errors: unknown[] = [];
    const scope: PreferenceScope = {
      store: createMemoryStore(),
      key: name => name,
      signal: lifetime.signal,
      onError: error => errors.push(error)
    };
    const effect = effectScope();
    effect.run(() =>
      usePreference(scope, {
        name: NAME,
        version: 1,
        schema,
        snapshot: () => ({ count: 0 }),
        restore: () => {
          throw failure;
        }
      })
    );

    await flushReads();

    expect(errors).toStrictEqual([failure]);
    effect.stop();
  });
});

describe('usePreference：写入', () => {
  it('恢复之后才写：连续变化防抖，只写最后一次，带版本号', async () => {
    const store = createMemoryStore();
    using ctx = setup(store);
    await flushReads();

    ctx.state.value = { count: 1 };
    await vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DEBOUNCE - 1);
    ctx.state.value = { count: 2 };
    await vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DEBOUNCE - 1);
    expect(store.entries.has(KEY)).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(store.entries.get(KEY)).toStrictEqual({ version: 1, value: { count: 2 } });
  });

  it('恢复本身引起的变化不写回', async () => {
    const store = createMemoryStore({ [KEY]: { version: 1, value: { count: 3 } } });
    const set = vi.spyOn(store, 'set');
    using ctx = setup(store);

    await flushReads();
    await vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DEBOUNCE);

    expect(ctx.state.value).toStrictEqual({ count: 3 });
    expect(set).not.toHaveBeenCalled();
  });

  it('写入失败：上报，不影响之后的写入', async () => {
    const failure = new Error('写入失败');
    const store = createMemoryStore();
    const set = vi.spyOn(store, 'set').mockRejectedValueOnce(failure);
    using ctx = setup(store);
    await flushReads();

    ctx.state.value = { count: 1 };
    await vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DEBOUNCE);
    ctx.state.value = { count: 2 };
    await vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DEBOUNCE);

    expect(ctx.errors).toStrictEqual([failure]);
    expect(set).toHaveBeenCalledTimes(2);
    expect(store.entries.get(KEY)).toStrictEqual({ version: 1, value: { count: 2 } });
  });

  it('生命期结束（身份失效）：立即写入还没写的那一次，之后不再写入', async () => {
    const store = createMemoryStore();
    using ctx = setup(store);
    await flushReads();

    ctx.state.value = { count: 1 };
    ctx.lifetime.abort();
    expect(store.entries.get(KEY)).toStrictEqual({ version: 1, value: { count: 1 } });

    ctx.state.value = { count: 2 };
    await vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DEBOUNCE);
    expect(store.entries.get(KEY)).toStrictEqual({ version: 1, value: { count: 1 } });
  });

  it('生命期结束之后才到的读取结果不再应用', async () => {
    const deferred = deferredStore();
    using ctx = setup(deferred.store);

    ctx.lifetime.abort();
    deferred.resolveRead({ version: 1, value: { count: 3 } });
    await vi.advanceTimersByTimeAsync(PREFERENCE_READ_TIMEOUT);

    expect(ctx.restored).toStrictEqual([]);
    expect(ctx.state.value).toStrictEqual({ count: 0 });
  });

  it('作用域销毁（路由离开）：立即写入还没写的那一次', async () => {
    const store = createMemoryStore();
    const ctx = setup(store);
    await flushReads();

    ctx.state.value = { count: 1 };
    ctx.effect.stop();

    expect(store.entries.get(KEY)).toStrictEqual({ version: 1, value: { count: 1 } });
  });

  it('页面隐藏、pagehide：尽力提交还没写的那一次', async () => {
    const store = createMemoryStore();
    using ctx = setup(store);
    await flushReads();
    using visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');

    ctx.state.value = { count: 1 };
    document.dispatchEvent(new Event('visibilitychange'));
    expect(store.entries.get(KEY)).toStrictEqual({ version: 1, value: { count: 1 } });

    visibility.mockReturnValue('visible');
    ctx.state.value = { count: 2 };
    window.dispatchEvent(new Event('pagehide'));
    expect(store.entries.get(KEY)).toStrictEqual({ version: 1, value: { count: 2 } });
  });

  it('范围已经结束：不读也不写', async () => {
    const store = createMemoryStore({ [KEY]: { version: 1, value: { count: 3 } } });
    const get = vi.spyOn(store, 'get');
    const lifetime = new AbortController();
    lifetime.abort();
    const effect = effectScope();
    const restore = vi.fn<(stored: Counter | null) => void>();
    effect.run(() =>
      usePreference(
        { store, key: name => name, signal: lifetime.signal, onError: () => undefined },
        { name: NAME, version: 1, schema, snapshot: () => ({ count: 0 }), restore }
      )
    );

    await flushReads();

    expect(get).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
    effect.stop();
  });
});

// appConfig 在模块加载时读取环境变量，改了开关要重新导入
async function usePreferenceWith(variable: string, value: string) {
  vi.stubEnv(variable, value);
  vi.resetModules();
  const module = await import('./use-preference');
  return module.usePreference;
}

// 走遍会读写的时机：恢复的等待、状态变化后的防抖、页面隐藏、pagehide、生命期结束
async function exercise(ctx: ReturnType<typeof setup>) {
  await vi.advanceTimersByTimeAsync(PREFERENCE_READ_TIMEOUT);
  ctx.state.value = { count: 5 };
  await vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DEBOUNCE);
  ctx.state.value = { count: 6 };
  using visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  document.dispatchEvent(new Event('visibilitychange'));
  visibility.mockReturnValue('visible');
  ctx.state.value = { count: 7 };
  window.dispatchEvent(new Event('pagehide'));
  ctx.state.value = { count: 8 };
  ctx.lifetime.abort();
  ctx.effect.stop();
}

describe('usePreference：开关（ADR 0140）', () => {
  const ITEMS = [
    ['basemap', 'VITE_PREFERENCE_BASEMAP'],
    ['basemap-labels', 'VITE_PREFERENCE_BASEMAP_LABELS'],
    ['boundaries', 'VITE_PREFERENCE_BOUNDARIES'],
    ['resource-layers', 'VITE_PREFERENCE_RESOURCE_LAYERS'],
    ['resource-symbols', 'VITE_PREFERENCE_RESOURCE_SYMBOLS'],
    ['resource-panel', 'VITE_PREFERENCE_RESOURCE_PANEL']
  ] as const;
  const STORED = { version: 1, value: { count: 3 } };

  // 存着这一项的旧数据，记下对存储的每一次访问
  function storeWithOldData(name: PreferenceName) {
    const store = createMemoryStore({ [`zhangsan/${name}`]: STORED });
    return { store, accesses: [vi.spyOn(store, 'get'), vi.spyOn(store, 'set'), vi.spyOn(store, 'delete')] };
  }

  describe.each(ITEMS)('%s', (name, variable) => {
    it('分项开关打开：恢复存下的值，变化后写入', async () => {
      const { store } = storeWithOldData(name);
      const ctx = setup(store, name, await usePreferenceWith(variable, 'true'));

      await flushReads();
      expect(ctx.restored).toStrictEqual([{ count: 3 }]);

      ctx.state.value = { count: 5 };
      await vi.advanceTimersByTimeAsync(PREFERENCE_WRITE_DEBOUNCE);
      expect(store.entries.get(`zhangsan/${name}`)).toStrictEqual({ version: 1, value: { count: 5 } });
      ctx.effect.stop();
    });

    it('分项开关关闭：和没有存过一样恢复为 null，不读不写，旧数据保留', async () => {
      const { store, accesses } = storeWithOldData(name);
      const ctx = setup(store, name, await usePreferenceWith(variable, 'false'));

      await exercise(ctx);

      expect(ctx.restored).toStrictEqual([null]);
      accesses.forEach(access => expect(access).not.toHaveBeenCalled());
      expect(store.entries.get(`zhangsan/${name}`)).toStrictEqual(STORED);
    });

    it('总开关关闭：分项开关打开也不读不写', async () => {
      const { store, accesses } = storeWithOldData(name);
      const ctx = setup(store, name, await usePreferenceWith('VITE_PREFERENCES_ENABLED', 'false'));

      await exercise(ctx);

      expect(ctx.restored).toStrictEqual([null]);
      accesses.forEach(access => expect(access).not.toHaveBeenCalled());
      expect(store.entries.get(`zhangsan/${name}`)).toStrictEqual(STORED);
    });

    it('分项开关关闭只影响自己：其他几项照常恢复', async () => {
      const use = await usePreferenceWith(variable, 'false');
      const others = ITEMS.filter(([candidate]) => candidate !== name).map(([other]) =>
        setup(storeWithOldData(other).store, other, use)
      );

      await flushReads();

      others.forEach(ctx => {
        expect(ctx.restored).toStrictEqual([{ count: 3 }]);
        ctx.effect.stop();
      });
    });
  });

  it('关闭期间操作过，重新打开后恢复的还是旧数据', async () => {
    const { store } = storeWithOldData(NAME);
    await exercise(setup(store, NAME, await usePreferenceWith('VITE_PREFERENCE_BOUNDARIES', 'false')));

    const reopened = setup(store, NAME, await usePreferenceWith('VITE_PREFERENCE_BOUNDARIES', 'true'));
    await flushReads();

    expect(reopened.restored).toStrictEqual([{ count: 3 }]);
    expect(reopened.state.value).toStrictEqual({ count: 3 });
    reopened.effect.stop();
  });

  it('开关关闭时拥有者的 restore 抛错：同样交给 onError，不打断拥有者的 setup', async () => {
    const use = await usePreferenceWith('VITE_PREFERENCE_BOUNDARIES', 'false');
    const failure = new Error('合并失败');
    const errors: unknown[] = [];
    const scope: PreferenceScope = {
      store: createMemoryStore(),
      key: name => name,
      signal: new AbortController().signal,
      onError: error => errors.push(error)
    };
    const effect = effectScope();
    const create = () =>
      effect.run(() =>
        use(scope, {
          name: NAME,
          version: 1,
          schema,
          snapshot: () => ({ count: 0 }),
          restore: () => {
            throw failure;
          }
        })
      );

    expect(create).not.toThrow();
    expect(errors).toStrictEqual([failure]);
    effect.stop();
  });

  it('名称只能是登记了开关的几项', () => {
    expectTypeOf<PreferenceName>().toEqualTypeOf<(typeof ITEMS)[number][0]>();
    expectTypeOf<'counter'>().not.toExtend<PreferenceName>();
  });
});
