// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createMemoryStore } from './key-value-store';

describe('createMemoryStore', () => {
  it('和 IndexedDB 一样存取复制品：之后改原对象、改读出的对象都不影响存下的值', async () => {
    const value = { order: ['a', 'b'] };
    const store = createMemoryStore();

    await store.set('k', value);
    value.order.push('c');
    const read = (await store.get('k')) as { order: string[] };
    read.order.pop();

    expect(await store.get('k')).toStrictEqual({ order: ['a', 'b'] });
  });

  it('没有的键是 undefined；delete 之后没有；可以带初始值', async () => {
    const store = createMemoryStore({ k: 1 });

    expect(await store.get('k')).toBe(1);
    expect(await store.get('missing')).toBeUndefined();
    await store.delete('k');
    expect(await store.get('k')).toBeUndefined();
  });
});
