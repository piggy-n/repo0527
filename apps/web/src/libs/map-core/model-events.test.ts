// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { ModelEvents } from './model-events';

interface TestEvents {
  change: (value: number) => void;
}

describe('ModelEvents', () => {
  it('订阅后收到发出的事件，取消订阅后不再收到', () => {
    const events = new ModelEvents<TestEvents>('TestModel');
    const listener = vi.fn<(value: number) => void>();

    const unsubscribe = events.on('change', listener);
    events.emit('change', 1);
    unsubscribe();
    events.emit('change', 2);

    expect(listener.mock.calls).toStrictEqual([[1]]);
  });

  it('释放后清空监听器，再订阅或写入时以模型的名称报错', () => {
    const events = new ModelEvents<TestEvents>('TestModel');
    const listener = vi.fn<(value: number) => void>();
    events.on('change', listener);

    expect(events.disposed).toBe(false);
    expect(() => events.assertAlive()).not.toThrow();
    events[Symbol.dispose]();
    events.emit('change', 1);

    expect(events.disposed).toBe(true);
    expect(listener).not.toHaveBeenCalled();
    expect(() => events.assertAlive()).toThrow('TestModel 已释放');
    expect(() => events.on('change', listener)).toThrow('TestModel 已释放');
  });
});
