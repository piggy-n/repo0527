// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PausableClock, systemClock } from './clock';
import { ManualClock } from './test-clock';

// 记下 promise 是否已经结束，不等它
function track(promise: Promise<void>) {
  const state: { done: boolean; error: unknown } = { done: false, error: null };
  void (async () => {
    try {
      await promise;
      state.done = true;
    } catch (error) {
      state.error = error;
    }
  })();
  return state;
}

const signal = () => new AbortController().signal;

describe('PausableClock', () => {
  it('没有暂停时按基础时钟等待', async () => {
    const base = new ManualClock();
    const clock = new PausableClock(base);
    const sleep = track(clock.sleep(1000, signal()));

    await base.advance(999);
    expect(sleep.done).toBe(false);
    await base.advance(1);
    expect(sleep.done).toBe(true);
  });

  it('暂停期间 now() 不走、等待顺延，解除后只等剩下的', async () => {
    const base = new ManualClock();
    const clock = new PausableClock(base);
    const sleep = track(clock.sleep(1000, signal()));
    await base.advance(400);

    const release = clock.pause();
    await base.advance(5000);
    expect(clock.now()).toBe(400);
    expect(sleep.done).toBe(false);

    release();
    await base.advance(599);
    expect(clock.now()).toBe(999);
    expect(sleep.done).toBe(false);
    await base.advance(1);
    expect(sleep.done).toBe(true);
  });

  it('暂停可以叠加：全部解除才继续；同一个解除函数调用两次只算一次', async () => {
    const base = new ManualClock();
    const clock = new PausableClock(base);
    const sleep = track(clock.sleep(100, signal()));
    const first = clock.pause();
    const second = clock.pause();

    first();
    first();
    await base.advance(1000);
    expect(clock.paused).toBe(true);
    expect(sleep.done).toBe(false);

    second();
    await base.advance(100);
    expect(clock.paused).toBe(false);
    expect(sleep.done).toBe(true);
  });

  it('暂停中开始的等待，解除后才开始计时', async () => {
    const base = new ManualClock();
    const clock = new PausableClock(base);
    const release = clock.pause();
    const sleep = track(clock.sleep(100, signal()));
    await base.advance(1000);
    expect(sleep.done).toBe(false);

    release();
    await base.advance(99);
    expect(sleep.done).toBe(false);
    await base.advance(1);
    expect(sleep.done).toBe(true);
  });

  it('暂停中不等待的调用也等解除', async () => {
    const base = new ManualClock();
    const clock = new PausableClock(base);
    const release = clock.pause();
    const sleep = track(clock.sleep(0, signal()));
    await base.advance(1000);
    expect(sleep.done).toBe(false);

    release();
    await base.advance(0);
    expect(sleep.done).toBe(true);
  });

  it('暂停中中止：以 AbortError 结束', async () => {
    const base = new ManualClock();
    const clock = new PausableClock(base);
    const controller = new AbortController();
    const sleep = track(clock.sleep(1000, controller.signal));
    clock.pause();
    await base.advance(2000);

    controller.abort();
    await base.advance(0);
    expect(sleep.error).toMatchObject({ name: 'AbortError' });
  });
});

describe('systemClock', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('按 setTimeout 等待；中止时清掉计时器并以 AbortError 结束', async () => {
    vi.useFakeTimers();
    const sleep = track(systemClock.sleep(100, signal()));
    await vi.advanceTimersByTimeAsync(100);
    expect(sleep.done).toBe(true);

    const controller = new AbortController();
    const aborted = track(systemClock.sleep(100, controller.signal));
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(aborted.error).toMatchObject({ name: 'AbortError' });
  });
});
