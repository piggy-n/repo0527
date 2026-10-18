interface CacheEntry<V> {
  readonly value: V;
  readonly bytes: number;
}

/** 按估算驻留字节控制预算，命中移动到队尾，超大条目只供当前任务使用 */
export class ByteCache<K, V> {
  readonly #entries = new Map<K, CacheEntry<V>>();
  readonly budget: number;
  #bytes = 0;

  constructor(budget: number) {
    if (!Number.isSafeInteger(budget) || budget < 0) {
      throw new RangeError('瓦片缓存预算必须是非负安全整数');
    }
    this.budget = budget;
  }

  get bytes(): number {
    return this.#bytes;
  }

  get size(): number {
    return this.#entries.size;
  }

  /** 枚举驻留值不改变最近访问顺序，供拥有者清理配套元数据 */
  *values(): IterableIterator<V> {
    for (const entry of this.#entries.values()) {
      yield entry.value;
    }
  }

  get(key: K): V | undefined {
    const entry = this.#entries.get(key);
    if (!entry) {
      return undefined;
    }
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V, bytes: number): void {
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      throw new RangeError('瓦片缓存占用必须是非负安全整数');
    }
    this.delete(key);
    if (bytes > this.budget || this.budget === 0) {
      return;
    }
    this.#entries.set(key, { value, bytes });
    this.#bytes += bytes;
    while (this.#bytes > this.budget) {
      const oldest = this.#entries.keys().next();
      if (oldest.done) {
        break;
      }
      this.delete(oldest.value);
    }
  }

  delete(key: K): void {
    const entry = this.#entries.get(key);
    if (entry) {
      this.#entries.delete(key);
      this.#bytes -= entry.bytes;
    }
  }

  clear(): void {
    this.#entries.clear();
    this.#bytes = 0;
  }
}
