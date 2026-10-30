import { abortReason } from '@yzt/utils';
import type { Clock } from './clock';

interface Sleeper {
  readonly due: number;
  readonly wake: () => void;
}

// 让出事件循环：等待返回后接着执行的代码（可能登记新的等待）都跑完
const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/** 只供测试：手动推进的时钟 */
export class ManualClock implements Clock {
  #now = 0;
  readonly #sleepers = new Set<Sleeper>();

  now(): number {
    return this.#now;
  }

  /** 还没到期的等待有几个 */
  get pending(): number {
    return this.#sleepers.size;
  }

  sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(abortReason(signal));
        return;
      }
      const onAbort = () => {
        this.#sleepers.delete(sleeper);
        reject(abortReason(signal));
      };
      const sleeper: Sleeper = {
        due: this.#now + ms,
        wake: () => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        }
      };
      this.#sleepers.add(sleeper);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  /** 推进 ms 毫秒：按到期先后逐个唤醒，每唤醒一个让出一次事件循环，期间新登记的等待到期了也在这次唤醒 */
  async advance(ms: number): Promise<void> {
    const target = this.#now + ms;
    await settle();
    for (let next = this.#earliest(); next && next.due <= target; next = this.#earliest()) {
      this.#sleepers.delete(next);
      this.#now = next.due;
      next.wake();
      // oxlint-disable-next-line no-await-in-loop -- 唤醒一个后要等它登记新的等待，才知道下一个到期的是谁
      await settle();
    }
    this.#now = target;
  }

  #earliest(): Sleeper | undefined {
    let earliest: Sleeper | undefined;
    for (const sleeper of this.#sleepers) {
      if (!earliest || sleeper.due < earliest.due) {
        earliest = sleeper;
      }
    }
    return earliest;
  }
}
