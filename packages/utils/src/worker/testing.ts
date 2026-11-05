// 只供测试使用

import type { WorkerEndpoint, WorkerProtocol } from './protocol';
import { WorkerClient, type WorkerClientOptions } from './worker-client';
import { type ServeOptions, serveWorker, type WorkerHandlers } from './worker-server';

type FailureType = 'error' | 'messageerror';

/** 消息转发给 MessagePort，可以手动触发 error、messageerror；jsdom 里不能往真实的端口派发事件 */
export class TestEndpoint implements WorkerEndpoint {
  readonly #port: MessagePort;
  readonly #failureListeners = new Map<string, Set<(event: Event) => void>>();
  terminated = false;

  constructor(port: MessagePort) {
    this.#port = port;
  }

  postMessage(message: unknown, transfer: Transferable[]): void {
    this.#port.postMessage(message, transfer);
  }

  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  addEventListener(type: FailureType, listener: (event: Event) => void): void;
  addEventListener(type: string, listener: (event: never) => void): void {
    if (type === 'message') {
      this.#port.addEventListener('message', listener as (event: MessageEvent) => void);
      return;
    }
    const listeners = this.#failureListeners.get(type) ?? new Set();
    this.#failureListeners.set(type, listeners.add(listener as (event: Event) => void));
  }

  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: FailureType, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: never) => void): void {
    if (type === 'message') {
      this.#port.removeEventListener('message', listener as (event: MessageEvent) => void);
      return;
    }
    this.#failureListeners.get(type)?.delete(listener as (event: Event) => void);
  }

  start(): void {
    this.#port.start();
  }

  terminate(): void {
    this.terminated = true;
    this.#port.close();
  }

  /** 模拟 Worker 崩溃或消息无法反序列化 */
  crash(type: FailureType = 'error'): void {
    for (const listener of this.#failureListeners.get(type) ?? []) {
      listener(new Event(type));
    }
  }

  listenerCount(): number {
    return [...this.#failureListeners.values()].reduce((count, listeners) => count + listeners.size, 0);
  }
}

/** 客户端和服务端分别接在同一个 MessageChannel 的两端，消息真实地经过结构化克隆 */
export function connect<P extends WorkerProtocol<P>>(
  handlers: WorkerHandlers<P>,
  { serve, client }: { serve?: ServeOptions; client?: WorkerClientOptions<P> } = {}
) {
  const stack = new DisposableStack();
  const { port1, port2 } = new MessageChannel();
  const endpoint = new TestEndpoint(port1);
  const serverEndpoint = new TestEndpoint(port2);
  const server = stack.use(serveWorker(serverEndpoint, handlers, serve));
  const workerClient = stack.use(new WorkerClient<P>(endpoint, client));
  stack.defer(() => {
    port1.close();
    port2.close();
  });
  return {
    client: workerClient,
    server,
    endpoint,
    serverEndpoint,
    serverPort: port2,
    [Symbol.dispose]: () => stack.dispose()
  };
}

/** 一个由测试控制何时放行的开关 */
export function gate() {
  let open!: () => void;
  const opened = new Promise<void>(resolve => {
    open = resolve;
  });
  return { opened, open };
}

// 按轮数而不是时长等，原因见 docs/modules/utils.md 的测试；每轮送达一跳，测试里最多等一次请求加一次回复
const MESSAGE_TURNS = 10;

// 自己发一条消息并等它到达；不用被测的 yieldToEventLoop，改坏它时这里不跟着坏
function nextMessageTurn(): Promise<void> {
  const { port1, port2 } = new MessageChannel();
  return new Promise(resolve => {
    port1.addEventListener(
      'message',
      () => {
        port1.close();
        port2.close();
        resolve();
      },
      { once: true }
    );
    port1.start();
    port2.postMessage(null);
  });
}

/** 推进若干轮事件循环，之前发出的消息都已送达；用来等取消这类没有回复的消息 */
export async function flushMessages(): Promise<void> {
  for (let turn = 0; turn < MESSAGE_TURNS; turn++) {
    // oxlint-disable-next-line no-await-in-loop -- 一轮只送达一跳，必须等上一轮结束
    await nextMessageTurn();
  }
}

/** 推进若干轮事件循环后还没结束就得到 'pending'，测试因断言失败而不是超时 */
export function settled<T>(promise: Promise<T>): Promise<T | 'pending'> {
  return Promise.race([promise, flushMessages().then(() => 'pending' as const)]);
}
