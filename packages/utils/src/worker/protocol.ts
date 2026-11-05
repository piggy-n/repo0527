/** 一个方法的请求与响应类型 */
export interface WorkerMethod {
  readonly request: unknown;
  readonly response: unknown;
}

/** Worker 协议：方法名 → 请求与响应；用普通 interface 描述，主线程和 Worker 入口 import type 同一份 */
export type WorkerProtocol<P> = { readonly [M in keyof P]: WorkerMethod };

/** Worker、MessagePort 以及 Worker 里的 self 都满足这个接口 */
export interface WorkerEndpoint {
  postMessage(message: unknown, transfer: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  addEventListener(type: 'messageerror' | 'error', listener: (event: Event) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'messageerror' | 'error', listener: (event: Event) => void): void;
  /** MessagePort 用 addEventListener 监听时要先 start */
  start?(): void;
  /** 只有 Worker 有 */
  terminate?(): void;
}

export interface RequestMessage {
  readonly kind: 'request';
  readonly id: number;
  readonly method: string;
  readonly payload: unknown;
}

export interface CancelMessage {
  readonly kind: 'cancel';
  readonly id: number;
}

// 结果带上方法名：调用方取消后才到达的结果，客户端据此找到对应的释放钩子
export interface ResultMessage {
  readonly kind: 'result';
  readonly id: number;
  readonly method: string;
  readonly value: unknown;
}

export interface FailureMessage {
  readonly kind: 'failure';
  readonly id: number;
  readonly error: SerializedError;
}

// Worker 一侧收到无法反序列化的消息：拿不到请求 ID，只能通知客户端按崩溃处理（ADR 0025）
export interface FaultMessage {
  readonly kind: 'fault';
  readonly type: 'messageerror';
}

export type ClientMessage = RequestMessage | CancelMessage;
export type ServerMessage = ResultMessage | FailureMessage | FaultMessage;

/** Safari 不能用结构化克隆传递错误对象，只传这几个字段 */
export interface SerializedError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSerializedError(value: unknown): value is SerializedError {
  return isRecord(value) && typeof value.name === 'string' && typeof value.message === 'string';
}

export function isClientMessage(data: unknown): data is ClientMessage {
  if (!isRecord(data) || typeof data.id !== 'number') {
    return false;
  }
  return data.kind === 'cancel' || (data.kind === 'request' && typeof data.method === 'string');
}

export function isServerMessage(data: unknown): data is ServerMessage {
  if (!isRecord(data)) {
    return false;
  }
  if (data.kind === 'fault') {
    return data.type === 'messageerror';
  }
  if (typeof data.id !== 'number') {
    return false;
  }
  return (
    (data.kind === 'result' && typeof data.method === 'string') ||
    (data.kind === 'failure' && isSerializedError(data.error))
  );
}

// 浏览器里 DOMException（AbortError、DataCloneError 等）是 Error 的实例，jsdom 里不是，两者都要认
function isError(value: unknown): value is Error {
  return value instanceof Error || value instanceof DOMException;
}

export function serializeError(error: unknown): SerializedError {
  if (isError(error)) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { name: 'Error', message: String(error) };
}

/** Worker 里的处理函数抛出的错误；name 保留原来的错误名，原来的调用栈在 workerStack */
export class WorkerTaskError extends Error {
  readonly workerStack: string | undefined;

  constructor({ name, message, stack }: SerializedError) {
    super(message);
    this.name = name;
    this.workerStack = stack;
  }
}

/** Worker 触发了 error 或 messageerror 事件，等待中的请求都以它结束 */
export class WorkerCrashedError extends Error {
  constructor(message = 'Worker 已崩溃') {
    super(message);
    this.name = 'WorkerCrashedError';
  }
}

/** WorkerHost 连续崩溃超过上限后不再重建 Worker */
export class WorkerUnavailableError extends Error {
  constructor(message = 'Worker 连续崩溃，已停止重建') {
    super(message);
    this.name = 'WorkerUnavailableError';
  }
}

export function abortError(message: string): DOMException {
  return new DOMException(message, 'AbortError');
}

/** Promise 的拒绝原因统一为 Error；DataCloneError 等 DOMException 本身就是 Error */
export function toError(value: unknown): Error {
  return isError(value) ? value : new Error(String(value));
}

/** signal.reason 的类型是 any，调用方可以传任意值作为原因；不是 Error 时改用 AbortError */
export function abortReason(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  return isError(reason) ? reason : abortError('请求已取消');
}

const TRANSFER = Symbol('transfer');

/** 带有待转移对象的响应 */
export interface Transferring<T> {
  readonly [TRANSFER]: readonly Transferable[];
  readonly value: T;
}

/** 标记响应中要转移所有权的对象（如 ImageBitmap、ArrayBuffer），发送之后发送方不能再使用它们 */
export function transfer<T>(value: T, transferables: readonly Transferable[]): Transferring<T> {
  return { [TRANSFER]: transferables, value };
}

export function unwrapTransfer(result: unknown): { value: unknown; transferables: Transferable[] } {
  if (isRecord(result) && TRANSFER in result) {
    const marked = result as unknown as Transferring<unknown>;
    return { value: marked.value, transferables: [...marked[TRANSFER]] };
  }
  return { value: result, transferables: [] };
}
