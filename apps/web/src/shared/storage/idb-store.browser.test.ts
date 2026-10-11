import { describe, expect, it } from 'vitest';
import { createIdbStore } from './idb-store';

// 真实的 IndexedDB（ADR 0040、0042）：每个用例用自己的数据库，互不影响
function databaseName(): string {
  return `yzt-test-${crypto.randomUUID()}`;
}

describe('createIdbStore（真实的 IndexedDB）', () => {
  it('写入、读出、删除；存取的是复制品；没有的键是 undefined', async () => {
    const store = createIdbStore(databaseName(), 'preferences');
    const value = { version: 1, value: { order: ['a', 'b'], displays: { a: { checked: true, opacity: 0.5 } } } };

    await store.set('zhangsan/resource-layers', value);
    value.value.order.push('c');

    expect(await store.get('zhangsan/resource-layers')).toStrictEqual({
      version: 1,
      value: { order: ['a', 'b'], displays: { a: { checked: true, opacity: 0.5 } } }
    });
    expect(await store.get('lisi/resource-layers')).toBeUndefined();
    await store.delete('zhangsan/resource-layers');
    expect(await store.get('zhangsan/resource-layers')).toBeUndefined();
  });

  it('数据存在数据库里：同名的新实例读到之前写的，别的数据库读不到', async () => {
    const name = databaseName();
    await createIdbStore(name, 'preferences').set('k', 1);

    expect(await createIdbStore(name, 'preferences').get('k')).toBe(1);
    expect(await createIdbStore(databaseName(), 'preferences').get('k')).toBeUndefined();
  });

  it('值不能结构化克隆时以失败结束，不同步抛出', async () => {
    const store = createIdbStore(databaseName(), 'preferences');

    await expect(store.set('k', () => undefined)).rejects.toMatchObject({ name: 'DataCloneError' });
  });
});
