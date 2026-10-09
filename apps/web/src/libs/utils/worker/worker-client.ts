import {
  abortReason,
  type ClientMessage,
  isServerMessage,
  toError,
  WorkerCrashedError,
  type WorkerEndpoint,
  type WorkerProtocol,
  WorkerTaskError
} from './protocol';

export interface RequestOptions {
  /** 中止时请求以 signal.reason 结束（默认 AbortError，AbortSignal.timeout 为 TimeoutError），并通知 Worker 取消 */
  readonly signal?: AbortSignal;
  /** 请求中要转移所有权的对象，发送后主线程不能再使用 */
  readonly transfer?: readonly Transferable[];
}

export type DiscardHandlers<P extends WorkerProtocol<P>> = {
  readonly [M in keyof P]?: (response: P[M]['response']) => void;
};

export interface WorkerClientOptions<P extends WorkerProtocol<P>> {
  /** 取消之后才到达的结果在这里释放，例如 ImageBitmap.close()（ADR 0025） */
  readonly discard?: DiscardHandlers<P>;
  /** 端点触发 error 或 messageerror 时调用，等待中的请求此时已经以 WorkerCrashedError 结束 */
  readonly onCrash?: (error: WorkerCrashedError) => void;
}

interface Pending {
  resolve(value: unknown): void;
  reject(reason: unknown): void;
  release(): void;
}

type RawDiscard = (response: unknown) => void;

/** 主线程一侧的 Worker 客户端：请求与响应按 ID 配对，支持取消；不负责终止 Worker */
export class WorkerClient<P extends WorkerProtocol<P>> implements Disposable {
  readonly #endpoint: WorkerEndpoint;
  readonly #pending = new Map<number, Pending>();
  // 方法名来自 Worker 的回复，只能按字符串查表
  readonly #discard: Record<string, RawDiscard | undefined>;
  readonly #onCrash: ((error: WorkerCrashedError) => void) | undefined;
  #nextId = 1;
  #state: 'open' | 'crashed' | 'disposed' = 'open';
  #crashError: WorkerCrashedError | undefined;

  readonly #onMessage = ({ data }: MessageEvent) => {
    if (this.#state !== 'open' || !isServerMessage(data)) {
      return;
    }
    const pending = this.#take(data.id);
    if (data.kind === 'failure') {
      pending?.reject(new WorkerTaskError(data.error));
    } else if (pending === undefined) {
      this.#discard[data.method]?.(data.value);
    } else {
      pending.resolve(data.value);
    }
  };

  readonly #onFailure = (event: Event) => {
    this.#crash(new WorkerCrashedError(`Worker 触发了 ${event.type} 事件`));
  };

  constructor(endpoint: WorkerEndpoint, { discard = {}, onCrash }: WorkerClientOptions<P> = {}) {
    this.#endpoint = endpoint;
    this.#discard = discard;
    this.#onCrash = onCrash;
    endpoint.addEventListener('message', this.#onMessage);
    endpoint.addEventListener('messageerror', this.#onFailure);
    endpoint.addEventListener('error', this.#onFailure);
    endpoint.start?.();
  }

  get crashed(): boolean {
    return this.#state === 'crashed';
  }

  request<M extends keyof P & string>(
    method: M,
    payload: P[M]['request'],
    { signal, transfer = [] }: RequestOptions = {}
  ): Promise<P[M]['response']> {
    if (this.#state === 'disposed') {
      return Promise.reject(new Error('WorkerClient 已释放'));
    }
    if (this.#crashError !== undefined) {
      return Promise.reject(this.#crashError);
    }
    if (signal?.aborted) {
      return Promise.reject(abortReason(signal));
    }
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        this.#take(id);
        reject(signal === undefined ? toError('请求已取消') : abortReason(signal));
        this.#post({ kind: 'cancel', id });
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.#pending.set(id, {
        resolve,
        reject,
        release: () => signal?.removeEventListener('abort', onAbort)
      });
      try {
        this.#endpoint.postMessage({ kind: 'request', id, method, payload } satisfies ClientMessage, [...transfer]);
      } catch (error) {
        // 参数无法克隆（DataCloneError）：只结束这一个请求
        this.#take(id);
        reject(toError(error));
      }
    });
  }

  /** 等待中的请求以 AbortError 结束；Worker 由创建它的一方终止 */
  [Symbol.dispose](): void {
    if (this.#state === 'disposed') {
      return;
    }
    this.#state = 'disposed';
    this.#detach();
    this.#rejectAll(new DOMException('WorkerClient 已释放', 'AbortError'));
  }

  #take(id: number): Pending | undefined {
    const pending = this.#pending.get(id);
    if (pending !== undefined) {
      this.#pending.delete(id);
      pending.release();
    }
    return pending;
  }

  #post(message: ClientMessage): void {
    try {
      this.#endpoint.postMessage(message, []);
    } catch {
      // 取消消息发不出去说明端点已经关闭，Worker 那边也不会再执行
    }
  }

  #crash(error: WorkerCrashedError): void {
    if (this.#state !== 'open') {
      return;
    }
    this.#state = 'crashed';
    this.#crashError = error;
    this.#detach();
    this.#rejectAll(error);
    this.#onCrash?.(error);
  }

  #rejectAll(reason: unknown): void {
    for (const id of this.#pending.keys()) {
      this.#take(id)?.reject(reason);
    }
  }

  #detach(): void {
    this.#endpoint.removeEventListener('message', this.#onMessage);
    this.#endpoint.removeEventListener('messageerror', this.#onFailure);
    this.#endpoint.removeEventListener('error', this.#onFailure);
  }
}
