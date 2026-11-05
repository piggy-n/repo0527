import { createStore, del, get, set } from 'idb-keyval';
import type { KeyValueStore } from './key-value-store';

/**
 * IndexedDB 的实现（ADR 0042 第 1 节）：第一次读写时才打开数据库。idb-keyval 打开数据库时不指定版本，
 * 只在第一次建库时建对象仓库，所以一个数据库只放一个仓库，别的数据另开数据库
 */
export function createIdbStore(databaseName: string, storeName: string): KeyValueStore {
  const store = createStore(databaseName, storeName);
  // 用 async 包一层：打开数据库同步抛出的错误也以失败的 Promise 结束
  return {
    get: async key => get<unknown>(key, store),
    set: async (key, value) => set(key, value, store),
    delete: async key => del(key, store)
  };
}

/** 整个应用共用的偏好存储 */
export const preferenceStore: KeyValueStore = createIdbStore('yzt-preferences', 'preferences');
