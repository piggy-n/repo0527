import { abortReason, yieldToEventLoop } from '@yzt/utils';
import { ByteCache } from './byte-cache';
import { decodeMvt, type DecodedTile } from './mvt-decode';
import { tileDataKey, tileSourceKey, type TileCoordinate, type TileDataSource } from './tile-identity';

export interface TileDataRequest {
  readonly source: TileDataSource;
  readonly coordinate: TileCoordinate;
  /** 由调用方解析的绝对地址，避免 Worker 按脚本位置解释相对地址 */
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  /** null 表示表达式需要全部属性，同源仍有缓存或任务时字段只增不减 */
  readonly fields: readonly string[] | null;
}

export interface TileDataServiceOptions {
  readonly budgetBytes: number;
  readonly fetch?: typeof fetch;
}

export interface TileDataStats {
  readonly bytes: number;
  readonly budget: number;
  readonly tiles: number;
  readonly sources: number;
  readonly inflight: number;
  readonly hits: number;
  readonly misses: number;
  readonly downloads: number;
  readonly decodes: number;
  readonly aborts: number;
}

interface SourceFields {
  fields: Set<string> | null;
  revision: number;
}

interface CachedTile {
  readonly sourceKey: string;
  readonly raw: ArrayBuffer;
  readonly decoded: DecodedTile;
  readonly revision: number;
}

interface Consumer {
  readonly resolve: (tile: DecodedTile) => void;
  readonly reject: (error: unknown) => void;
  readonly detach: () => void;
}

interface SharedTask {
  readonly sourceKey: string;
  readonly controller: AbortController;
  readonly consumers: Set<Consumer>;
}

/** Worker 内的数据服务：同父瓦片共享下载解码，每个等待者独立取消（ADR 0025） */
export class TileDataService implements Disposable {
  readonly #cache: ByteCache<string, CachedTile>;
  readonly #fetch: typeof fetch;
  readonly #fields = new Map<string, SourceFields>();
  readonly #pending = new Map<string, SharedTask>();
  #disposed = false;
  #hits = 0;
  #misses = 0;
  #downloads = 0;
  #decodes = 0;
  #aborts = 0;

  constructor({ budgetBytes, fetch: fetchTile = globalThis.fetch }: TileDataServiceOptions) {
    this.#cache = new ByteCache(budgetBytes);
    this.#fetch = fetchTile;
  }

  get stats(): TileDataStats {
    return {
      bytes: this.#cache.bytes, budget: this.#cache.budget, tiles: this.#cache.size, sources: this.#fields.size,
      inflight: this.#pending.size, hits: this.#hits, misses: this.#misses,
      downloads: this.#downloads, decodes: this.#decodes, aborts: this.#aborts
    };
  }

  async acquire(request: TileDataRequest, { signal }: { readonly signal: AbortSignal }): Promise<DecodedTile> {
    if (this.#disposed) {
      throw new DOMException('瓦片数据服务已释放', 'AbortError');
    }
    signal.throwIfAborted();
    // 验证绝对地址但保留原始字符串，签名地址不能由 URL 重新序列化
    if (!URL.canParse(request.url)) {
      throw new TypeError('MVT 下载需要绝对地址');
    }
    const key = tileDataKey(request.source, request.coordinate);
    const sourceKey = tileSourceKey(request.source);
    const fields = this.#mergeFields(sourceKey, request.fields);
    const cached = this.#cache.get(key);
    if (cached && cached.revision === fields.revision) {
      this.#hits++;
      return cached.decoded;
    }
    let task = this.#pending.get(key);
    if (!task) {
      this.#misses++;
      task = { sourceKey, controller: new AbortController(), consumers: new Set() };
      this.#pending.set(key, task);
      const current = task;
      // 先登记消费者再启动，立即取消时不发下载请求
      void Promise.resolve().then(() => this.#run(key, current, request, fields, cached?.raw));
    }
    return this.#subscribe(key, task, signal);
  }

  [Symbol.dispose](): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    const error = new DOMException('瓦片数据服务已释放', 'AbortError');
    for (const [key, task] of this.#pending) {
      this.#abort(key, task);
      for (const consumer of task.consumers) {
        consumer.detach();
        consumer.reject(error);
      }
      task.consumers.clear();
    }
    this.#cache.clear();
    this.#fields.clear();
  }

  #mergeFields(key: string, requested: readonly string[] | null): SourceFields {
    const current = this.#fields.get(key);
    if (!current) {
      const created = { fields: requested === null ? null : new Set(requested), revision: 0 };
      this.#fields.set(key, created);
      return created;
    }
    if (current.fields === null) {
      return current;
    }
    if (requested === null) {
      current.fields = null;
      current.revision++;
      return current;
    }
    for (const field of requested) {
      if (!current.fields.has(field)) {
        current.fields.add(field);
        current.revision++;
      }
    }
    return current;
  }

  #active(key: string, task: SharedTask): boolean {
    return !this.#disposed && !task.controller.signal.aborted && this.#pending.get(key) === task;
  }

  #subscribe(key: string, task: SharedTask, signal: AbortSignal): Promise<DecodedTile> {
    return new Promise((resolve, reject) => {
      const cancel = () => {
        task.consumers.delete(consumer);
        consumer.detach();
        reject(abortReason(signal));
        if (task.consumers.size === 0) {
          this.#abort(key, task);
        }
      };
      const consumer: Consumer = { resolve, reject, detach: () => signal.removeEventListener('abort', cancel) };
      task.consumers.add(consumer);
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) {
        cancel();
      }
    });
  }

  #abort(key: string, task: SharedTask): void {
    if (!task.controller.signal.aborted) {
      this.#aborts++;
      task.controller.abort();
    }
    if (this.#pending.get(key) === task) {
      this.#pending.delete(key);
    }
    this.#pruneSources();
  }

  #complete(key: string, task: SharedTask, finish: (consumer: Consumer) => void): void {
    if (this.#pending.get(key) === task) {
      this.#pending.delete(key);
    }
    for (const consumer of task.consumers) {
      consumer.detach();
      finish(consumer);
    }
    task.consumers.clear();
    this.#pruneSources();
  }

  // 没有驻留数据或进行中任务的源不再保存字段，连续切年份不会留下无界元数据
  #pruneSources(): void {
    const live = new Set([...this.#cache.values()].map(tile => tile.sourceKey));
    for (const task of this.#pending.values()) {
      live.add(task.sourceKey);
    }
    for (const key of this.#fields.keys()) {
      if (!live.has(key)) {
        this.#fields.delete(key);
      }
    }
  }

  async #run(
    key: string,
    task: SharedTask,
    request: TileDataRequest,
    fields: SourceFields,
    raw: ArrayBuffer | undefined
  ): Promise<void> {
    try {
      let result = await this.#load(request, fields, raw, task.controller.signal);
      // load 返回与本次续行之间也可能加入新消费者，交付前再次核对字段并集
      while (result.revision !== fields.revision) {
        // oxlint-disable-next-line no-await-in-loop -- 新字段必须在共同交付前完成解码，原始数据仍然复用
        result = await this.#load(request, fields, result.raw, task.controller.signal);
      }
      if (!this.#active(key, task)) {
        return;
      }
      this.#cache.set(key, result, result.raw.byteLength + result.decoded.bytes);
      this.#complete(key, task, consumer => consumer.resolve(result.decoded));
    } catch (error) {
      this.#complete(key, task, consumer => consumer.reject(error));
    }
  }

  async #load(
    request: TileDataRequest,
    fields: SourceFields,
    cachedRaw: ArrayBuffer | undefined,
    signal: AbortSignal
  ): Promise<CachedTile> {
    signal.throwIfAborted();
    let raw = cachedRaw;
    if (!raw) {
      this.#downloads++;
      // 原生 Worker fetch 不能以服务实例为 this，先取出函数再调用
      const fetchTile = this.#fetch;
      const response = await fetchTile(request.url, { signal, headers: request.headers });
      signal.throwIfAborted();
      if (!response.ok) {
        throw new Error(`MVT 下载失败：HTTP ${response.status}`);
      }
      raw = await response.arrayBuffer();
      signal.throwIfAborted();
    }
    // 其他消费者可能在解码让出期间登记新字段，直到当前字段并集完成后再共同交付
    while (true) {
      const revision = fields.revision;
      const required = fields.fields === null ? null : new Set(fields.fields);
      this.#decodes++;
      // oxlint-disable-next-line no-await-in-loop -- 字段并集在解码等待期间扩大时，使用同一原始瓦片重新解码
      const decoded = await decodeMvt(raw, required, { signal, checkpoint: yieldToEventLoop });
      signal.throwIfAborted();
      if (fields.revision === revision) {
        return { raw, decoded, revision, sourceKey: tileSourceKey(request.source) };
      }
    }
  }
}
