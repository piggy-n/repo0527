import { abortReason } from '@yzt/utils';

/** 推演用的时钟：读时间、等待；测试注入手动推进的时钟 */
export interface Clock {
  /** 当前时间（毫秒），只用来算间隔 */
  now(): number;
  /** 等 ms 毫秒；信号中止时以 AbortError 结束 */
  sleep(ms: number, signal: AbortSignal): Promise<void>;
}

export const systemClock: Clock = {
  now: () => performance.now(),
  sleep: (ms, signal) =>
    new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(abortReason(signal));
        return;
      }
      const onAbort = () => {
        clearTimeout(timer);
        reject(abortReason(signal));
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal.addEventListener('abort', onAbort, { once: true });
    })
};

// 等 promise 完成，信号中止时提前以 AbortError 结束
function abortable(promise: Promise<void>, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    void promise.finally(() => signal.removeEventListener('abort', onAbort)).then(resolve);
  });
}

/** 可暂停的时钟：暂停期间 now() 不走，等待顺延；暂停可以叠加，全部解除后才继续 */
export class PausableClock implements Clock {
  readonly #base: Clock;
  #holds = 0;
  #pausedAt = 0;
  // 累计暂停的时长
  #offset = 0;
  // 暂停期间有值，全部解除时完成
  #resumed: Promise<void> | null = null;
  #resume: (() => void) | null = null;

  constructor(base: Clock) {
    this.#base = base;
  }

  get paused(): boolean {
    return this.#holds > 0;
  }

  now(): number {
    return (this.paused ? this.#pausedAt : this.#base.now()) - this.#offset;
  }

  /** 暂停，返回解除这一次暂停的函数；解除函数可以重复调用 */
  pause(): () => void {
    if (this.#holds === 0) {
      this.#pausedAt = this.#base.now();
      this.#resumed = new Promise<void>(resolve => {
        this.#resume = resolve;
      });
    }
    this.#holds++;
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      this.#holds--;
      if (this.#holds === 0) {
        this.#offset += this.#base.now() - this.#pausedAt;
        this.#resume?.();
        this.#resume = null;
        this.#resumed = null;
      }
    };
  }

  async sleep(ms: number, signal: AbortSignal): Promise<void> {
    const due = this.now() + ms;
    // 基础时钟醒来时可能经过了暂停：暂停中就等解除，没到时间就再等剩下的
    while (this.paused || this.now() < due) {
      if (signal.aborted) {
        throw abortReason(signal);
      }
      // oxlint-disable-next-line no-await-in-loop -- 每次醒来都要按暂停后的时间重新判断
      await (this.#resumed ? abortable(this.#resumed, signal) : this.#base.sleep(due - this.now(), signal));
    }
    if (signal.aborted) {
      throw abortReason(signal);
    }
  }
}
