/**
 * 异步的键值存储（ADR 0042 第 1 节）：值是可以结构化克隆的普通数据，不存 Map、类实例。
 * 浏览器不支持或禁用存储时，读写以失败结束
 */
export interface KeyValueStore {
  /** 没有这个键时为 undefined */
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

/** 内存实现，给测试用：和 IndexedDB 一样存取的都是复制品 */
export function createMemoryStore(initial: Readonly<Record<string, unknown>> = {}): KeyValueStore & {
  readonly entries: ReadonlyMap<string, unknown>;
} {
  const entries = new Map(Object.entries(initial).map(([key, value]) => [key, structuredClone(value)]));
  return {
    entries,
    get: key => Promise.resolve(structuredClone(entries.get(key))),
    set: (key, value) => {
      entries.set(key, structuredClone(value));
      return Promise.resolve();
    },
    delete: key => {
      entries.delete(key);
      return Promise.resolve();
    }
  };
}
