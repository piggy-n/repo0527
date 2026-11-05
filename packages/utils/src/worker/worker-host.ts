import { toError, type WorkerEndpoint, type WorkerProtocol, WorkerUnavailableError } from './protocol';
import { type RequestOptions, WorkerClient, type WorkerClientOptions } from './worker-client';

export interface WorkerHostOptions<P extends WorkerProtocol<P>> extends Pick<WorkerClientOptions<P>, 'discard'> {
  /** 创建 Worker，地址由使用方提供，例如 new Worker(new URL('./x.worker.ts', import.meta.url), { type: 'module' }) */
  readonly createWorker: () => WorkerEndpoint;
  /** 连续崩溃后最多重建几次，默认 3；成功完成一个请求后重新计数 */
  readonly maxRestarts?: number;
}

/** 托管一个 Worker：第一次请求时创建，崩溃后终止并在下次请求时重建（ADR 0025） */
export class WorkerHost<P extends WorkerProtocol<P>> implements Disposable {
  readonly #options: WorkerHostOptions<P>;
  readonly #maxRestarts: number;
  #worker: WorkerEndpoint | undefined;
  #client: WorkerClient<P> | undefined;
  #crashes = 0;
  #disposed = false;

  constructor(options: WorkerHostOptions<P>) {
    this.#options = options;
    this.#maxRestarts = options.maxRestarts ?? 3;
  }

  request<M extends keyof P & string>(
    method: M,
    payload: P[M]['request'],
    options?: RequestOptions
  ): Promise<P[M]['response']> {
    if (this.#disposed) {
      return Promise.reject(new Error('WorkerHost 已释放'));
    }
    if (this.#crashes > this.#maxRestarts) {
      return Promise.reject(new WorkerUnavailableError());
    }
    let client: WorkerClient<P>;
    try {
      client = this.#ensureClient();
    } catch (error) {
      // 创建 Worker 本身失败（例如浏览器不支持），不算崩溃
      return Promise.reject(toError(error));
    }
    return client.request(method, payload, options).then(response => {
      this.#crashes = 0;
      return response;
    });
  }

  /** 等待中的请求以 AbortError 结束，并终止 Worker */
  [Symbol.dispose](): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#client?.[Symbol.dispose]();
    this.#worker?.terminate?.();
    this.#client = undefined;
    this.#worker = undefined;
  }

  #ensureClient(): WorkerClient<P> {
    if (this.#client !== undefined) {
      return this.#client;
    }
    const worker = this.#options.createWorker();
    const client = new WorkerClient<P>(worker, {
      discard: this.#options.discard,
      onCrash: () => {
        this.#crashes++;
        worker.terminate?.();
        if (this.#client === client) {
          this.#client = undefined;
          this.#worker = undefined;
        }
      }
    });
    this.#worker = worker;
    this.#client = client;
    return client;
  }
}
