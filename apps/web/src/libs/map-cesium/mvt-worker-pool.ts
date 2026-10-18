import { tileDataKey } from '@yzt/map-core';
import { abortReason, WorkerHost, type WorkerEndpoint } from '@yzt/utils';
import type { MvtRenderRequest, MvtWorkerProtocol } from './mvt-worker-protocol';

export interface MvtWorkerPoolOptions {
  readonly workerCount?: number;
  /** 所有 Worker 的驻留数据缓存预算，不包含正在绘制的工作集与 Cesium 纹理 */
  readonly budgetBytes?: number;
  readonly maxPending?: number;
  readonly createWorker?: () => WorkerEndpoint;
}

/** 一份三维视图拥有的惰性池，父瓦片稳定分片，不维护无界归属表 */
export class MvtWorkerPool implements Disposable {
  readonly #hosts: WorkerHost<MvtWorkerProtocol>[];
  readonly #used = new Set<number>();
  readonly #pending = new Set<AbortController>();
  readonly #budget: number;
  readonly #maximum: number;
  #paused = false;
  #disposed = false;

  constructor({ workerCount = 2, budgetBytes = 64 * 1024 * 1024, maxPending = 16,
    createWorker = () => new Worker(new URL('./mvt.worker.ts', import.meta.url), { type: 'module' })
  }: MvtWorkerPoolOptions = {}) {
    if (!Number.isInteger(workerCount) || workerCount < 1 || workerCount > 8 ||
      !Number.isSafeInteger(budgetBytes) || budgetBytes < workerCount ||
      !Number.isInteger(maxPending) || maxPending < 1) {
      throw new RangeError('MVT 池需要 1～8 个 Worker、正字节预算和正任务上限');
    }
    this.#budget = Math.floor(budgetBytes / workerCount);
    this.#maximum = maxPending;
    this.#hosts = Array.from({ length: workerCount }, () => new WorkerHost<MvtWorkerProtocol>({
      createWorker,
      discard: { render: bitmap => bitmap.close() }
    }));
  }

  get hasCapacity(): boolean {
    return !this.#disposed && !this.#paused && this.#pending.size < this.#maximum;
  }

  /** 消费者取消只结束自己；下载与解码的共享计数留在 Worker 数据服务内 */
  async render(request: Omit<MvtRenderRequest, 'budgetBytes'>, signal: AbortSignal): Promise<ImageBitmap> {
    signal.throwIfAborted();
    if (!this.hasCapacity) {
      throw new DOMException('MVT 池暂停、已释放或任务已满', 'AbortError');
    }
    const key = tileDataKey(request.data.source, request.data.coordinate);
    const controller = new AbortController();
    const cancel = () => controller.abort(abortReason(signal));
    signal.addEventListener('abort', cancel, { once: true });
    this.#pending.add(controller);
    // 确定性散列使所有显示子瓦片和样式图层复用同一父数据缓存
    let hash = 2166136261;
    for (let index = 0; index < key.length; index++) {
      hash = Math.imul(hash ^ key.charCodeAt(index), 16777619) >>> 0;
    }
    const index = hash % this.#hosts.length;
    this.#used.add(index);
    try {
      const bitmap = await this.#hosts[index].request('render', { ...request, budgetBytes: this.#budget },
        { signal: controller.signal });
      if (controller.signal.aborted) {
        bitmap.close();
        throw abortReason(controller.signal);
      }
      return bitmap;
    } finally {
      this.#pending.delete(controller);
      signal.removeEventListener('abort', cancel);
    }
  }

  /** 仅向已经使用的 Worker 查询，读取统计不提前创建线程 */
  stats(): Promise<readonly MvtWorkerProtocol['stats']['response'][]> {
    return Promise.all([...this.#used].map(index => this.#hosts[index].request('stats', undefined)));
  }

  pause(): void {
    this.#paused = true;
    for (const controller of this.#pending) {
      controller.abort();
    }
  }

  resume(): void {
    if (!this.#disposed) {
      this.#paused = false;
    }
  }

  [Symbol.dispose](): void {
    if (this.#disposed) { return; }
    this.#disposed = true;
    this.pause();
    this.#hosts.forEach(host => host[Symbol.dispose]());
    this.#used.clear();
  }
}
