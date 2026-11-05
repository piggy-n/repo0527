import { createNanoEvents, type EventsMap } from 'nanoevents';
import type { Unsubscribe } from './events';

/** 会话各模型共用的事件与释放，各模型持有一个实例（组合，ADR 0034 第 7 条）：释放后订阅和写入都抛错，监听器随之清空 */
export class ModelEvents<Events extends EventsMap> implements Disposable {
  readonly #emitter = createNanoEvents<Events>();
  readonly #owner: string;
  #disposed = false;

  /** owner 是模型的名称，用在释放后的报错里 */
  constructor(owner: string) {
    this.#owner = owner;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  /** 已释放时抛错；模型的写入方法先调用它 */
  assertAlive(): void {
    if (this.#disposed) {
      throw new Error(`${this.#owner} 已释放`);
    }
  }

  on<K extends keyof Events>(event: K, callback: Events[K]): Unsubscribe {
    this.assertAlive();
    return this.#emitter.on(event, callback);
  }

  /** 释放后监听器已清空，发出的事件没有人收到 */
  emit<K extends keyof Events>(event: K, ...args: Parameters<Events[K]>): void {
    this.#emitter.emit(event, ...args);
  }

  [Symbol.dispose](): void {
    this.#disposed = true;
    this.#emitter.events = {};
  }
}
