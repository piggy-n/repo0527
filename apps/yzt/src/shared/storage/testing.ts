// 只供测试使用

import { createMemoryStore, type KeyValueStore } from './key-value-store';
import type { PreferenceScope } from './preference-scope';

/** 测试用的偏好范围：内存存储、固定的用户；end 结束生命期，errors 记下上报的错误 */
export function createTestPreferenceScope(store: KeyValueStore = createMemoryStore(), loginName = 'zhangsan') {
  const lifetime = new AbortController();
  const errors: unknown[] = [];
  const scope: PreferenceScope = {
    store,
    key: name => `${loginName}/${name}`,
    signal: lifetime.signal,
    onError: error => errors.push(error)
  };
  return { scope, errors, end: () => lifetime.abort() };
}

/** 内存里的 localStorage：设备级存储（createDeviceStore）的测试用，node 环境里也能用 */
export class MemoryStorage implements Storage {
  readonly #items = new Map<string, string>();

  get length(): number {
    return this.#items.size;
  }

  clear(): void {
    this.#items.clear();
  }

  getItem(key: string): string | null {
    return this.#items.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.#items.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.#items.delete(key);
  }

  setItem(key: string, value: string): void {
    this.#items.set(key, value);
  }
}
