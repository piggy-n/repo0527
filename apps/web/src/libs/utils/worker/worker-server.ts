import {
  isClientMessage,
  type RequestMessage,
  serializeError,
  type ServerMessage,
  type Transferring,
  unwrapTransfer,
  type WorkerEndpoint,
  type WorkerProtocol
} from './protocol';
import { yieldToEventLoop } from './yield';

export interface TaskContext {
  /** 调用方取消时中止，可以直接传给 fetch */
  readonly signal: AbortSignal;
  /** 让出一次事件循环并检查是否已取消；计算密集的处理函数分段调用（ADR 0025），可以从 context 解构出来使用 */
  readonly checkpoint: () => Promise<void>;
}

type HandlerResult<T> = T | Transferring<T>;

export type WorkerHandlers<P extends WorkerProtocol<P>> = {
  readonly [M in keyof P]: (
    payload: P[M]['request'],
    context: TaskContext
  ) => HandlerResult<P[M]['response']> | Promise<HandlerResult<P[M]['response']>>;
};

export interface ServeOptions {
  /** 同时执行的任务数，默认 1；其余的排队，取消时直接移除 */
  readonly concurrency?: number;
}

type RawHandler = (payload: unknown, context: TaskContext) => unknown;

interface Task {
  readonly request: RequestMessage;
  readonly controller: AbortController;
}

/** 在 Worker 里提供协议的实现；释放后不再处理消息，执行中的任务收到取消 */
export function serveWorker<P extends WorkerProtocol<P>>(
  endpoint: WorkerEndpoint,
  handlers: WorkerHandlers<P>,
  { concurrency = 1 }: ServeOptions = {}
): Disposable {
  // 方法名来自外部消息，只能按字符串查表；查到的处理函数收到的 payload 由协议的另一侧保证类型
  const handlerTable = handlers as unknown as Record<string, RawHandler | undefined>;
  const queue: Task[] = [];
  const running = new Map<number, AbortController>();
  let disposed = false;

  const reply = (message: ServerMessage, transferables: Transferable[] = []) => {
    endpoint.postMessage(message, transferables);
  };

  const fail = (id: number, error: unknown) => {
    reply({ kind: 'failure', id, error: serializeError(error) });
  };

  const run = async ({ request, controller }: Task) => {
    const { id, method, payload } = request;
    running.set(id, controller);
    const handler = handlerTable[method];
    try {
      if (handler === undefined) {
        throw new TypeError(`未知的方法：${method}`);
      }
      const { signal } = controller;
      const checkpoint = async () => {
        await yieldToEventLoop();
        signal.throwIfAborted();
      };
      const { value, transferables } = unwrapTransfer(await handler(payload, { signal, checkpoint }));
      reply({ kind: 'result', id, method, value }, transferables);
    } catch (error) {
      // 处理函数抛错，或结果无法克隆（postMessage 抛 DataCloneError）
      fail(id, error);
    } finally {
      running.delete(id);
      pump();
    }
  };

  const pump = () => {
    if (disposed) {
      return;
    }
    // run 的第一步同步登记到 running，所以循环条件会随之变化
    while (running.size < concurrency && queue.length > 0) {
      const task = queue.shift();
      if (task !== undefined) {
        void run(task);
      }
    }
  };

  const onMessage = ({ data }: MessageEvent) => {
    if (disposed || !isClientMessage(data)) {
      return;
    }
    if (data.kind === 'request') {
      queue.push({ request: data, controller: new AbortController() });
      pump();
      return;
    }
    // 取消：还在排队的直接移除，不再回复（调用方已经结束等待）；执行中的中止它的 signal
    const index = queue.findIndex(({ request }) => request.id === data.id);
    if (index === -1) {
      running.get(data.id)?.abort();
    } else {
      queue.splice(index, 1);
    }
  };

  endpoint.addEventListener('message', onMessage);
  endpoint.start?.();

  return {
    [Symbol.dispose]() {
      if (disposed) {
        return;
      }
      disposed = true;
      endpoint.removeEventListener('message', onMessage);
      queue.length = 0;
      for (const controller of running.values()) {
        controller.abort();
      }
    }
  };
}
