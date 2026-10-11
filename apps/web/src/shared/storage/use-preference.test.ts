import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, shallowRef } from 'vue';
import { z } from 'zod';
import { createMemoryStore, type KeyValueStore } from './key-value-store';
import type { PreferenceScope } from './preference-scope';
import { PREFERENCE_READ_TIMEOUT, PREFERENCE_WRITE_DEBOUNCE, usePreference } from './use-preference';

const schema = z.object({ count: z.number().int().min(0) });
type Counter = z.infer<typeof schema>;

const KEY = 'zhangsan/counter';

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
function setup(store: KeyValueStore) {
  const lifetime = new AbortController();
  const errors: unknown[] = [];
  const scope: PreferenceScope = {
    store,
    key: name => `zhangsan/${name}`,
    signal: lifetime.signal,
    onError: error => errors.push(error)
  };
  const state = shallowRef<Counter>({ count: 0 });
  const restored: (Counter | null)[] = [];
  const effect = effectScope();
  effect.run(() =>
    usePreference(scope, {
      name: 'counter',
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
        name: 'counter',
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
        { name: 'counter', version: 1, schema, snapshot: () => ({ count: 0 }), restore }
      )
    );

    await flushReads();

    expect(get).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
    effect.stop();
  });
});
