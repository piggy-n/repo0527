// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { LatestController } from './latest-controller';

describe('LatestController', () => {
  it('创建时就有一个没中止的信号', () => {
    using latest = new LatestController();

    expect(latest.signal.aborted).toBe(false);
  });

  it('开始新的一次时中止上一次，signal 总是最新的那一次', () => {
    using latest = new LatestController();
    const initial = latest.signal;

    const first = latest.next();
    expect(initial.aborted).toBe(true);
    expect(first.aborted).toBe(false);
    expect(latest.signal).toBe(first);

    const second = latest.next();
    expect(first.aborted).toBe(true);
    expect(second.aborted).toBe(false);
    expect(latest.signal).toBe(second);
  });

  it('上一次的中止原因是传入的 reason，不传时为 AbortError', () => {
    using latest = new LatestController();
    const reason = new DOMException('有新的选择', 'AbortError');

    const first = latest.next();
    latest.next(reason);
    expect(first.reason).toBe(reason);

    const second = latest.signal;
    latest.next();
    expect(second.reason).toMatchObject({ name: 'AbortError' });
  });

  it('abort 只中止当前这一次，不开始新的', () => {
    using latest = new LatestController();
    const current = latest.signal;
    const reason = new Error('作用域销毁');

    latest.abort(reason);
    latest.abort(new Error('第二次'));

    expect(current.aborted).toBe(true);
    expect(current.reason).toBe(reason);
    expect(latest.signal).toBe(current);
  });

  it('abort 之后还能开始新的一次', () => {
    using latest = new LatestController();
    latest.abort();

    const next = latest.next();

    expect(next.aborted).toBe(false);
  });

  it('释放时以 AbortError 中止当前这一次，之后不能再开始新的', () => {
    const latest = new LatestController();
    const current = latest.signal;

    latest[Symbol.dispose]();

    expect(current.reason).toMatchObject({ name: 'AbortError', message: 'LatestController 已释放' });
    expect(() => latest.next()).toThrow('LatestController 已释放');
    expect(() => latest[Symbol.dispose]()).not.toThrow();
  });

  it('释放前已经中止的，保留原来的原因', () => {
    const latest = new LatestController();
    const reason = new Error('先中止');
    latest.abort(reason);

    latest[Symbol.dispose]();

    expect(latest.signal.reason).toBe(reason);
  });
});
