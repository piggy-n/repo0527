import { describe, expect, it, vi } from 'vitest';
import { transfer, WorkerCrashedError, WorkerTaskError } from './protocol';
import { connect, gate, settled } from './testing';
import type { WorkerClient } from './worker-client';
import type { ServeOptions, WorkerHandlers } from './worker-server';

interface TestProtocol {
  echo: { request: string; response: string };
  fail: { request: string; response: never };
  hold: { request: string; response: string };
  watch: { request: undefined; response: string };
  count: { request: number; response: number };
  bytes: { request: number; response: ArrayBuffer };
  unclonable: { request: undefined; response: unknown };
}

function setup(overrides: Partial<WorkerHandlers<TestProtocol>> = {}, serve?: ServeOptions) {
  const started: string[] = [];
  const gates = new Map<string, () => void>();
  const handlers: WorkerHandlers<TestProtocol> = {
    echo: text => text,
    fail: message => {
      throw new RangeError(message);
    },
    hold: name => {
      started.push(name);
      return new Promise(resolve => gates.set(name, () => resolve(name)));
    },
    watch: () => 'unused',
    count: iterations => iterations,
    bytes: size => new ArrayBuffer(size),
    unclonable: () => () => 'functions cannot be cloned',
    ...overrides
  };
  const connection = connect(handlers, { serve });
  return { ...connection, started, release: (name: string) => gates.get(name)?.() };
}

describe('serveWorker', () => {
  it('answers a request with the result of its handler', async () => {
    using ctx = setup();

    await expect(ctx.client.request('echo', 'hello')).resolves.toBe('hello');
  });

  it('reports a handler error with its name and message', async () => {
    using ctx = setup();

    const failure = ctx.client.request('fail', 'boom');

    await expect(failure).rejects.toBeInstanceOf(WorkerTaskError);
    await expect(failure).rejects.toMatchObject({ name: 'RangeError', message: 'boom' });
  });

  it('reports a method it does not implement', async () => {
    using ctx = setup();
    // 方法名来自外部消息：模拟另一侧用了不同版本的协议
    const client = ctx.client as unknown as WorkerClient<{ missing: { request: undefined; response: unknown } }>;

    await expect(settled(client.request('missing', undefined))).rejects.toMatchObject({
      name: 'TypeError',
      message: '未知的方法：missing'
    });
  });

  it('runs one task at a time by default and starts the next when one finishes', async () => {
    using ctx = setup();

    const first = ctx.client.request('hold', 'first');
    const second = ctx.client.request('hold', 'second');
    await vi.waitFor(() => expect(ctx.started).toEqual(['first']));
    expect(await settled(second)).toBe('pending');

    ctx.release('first');
    await expect(first).resolves.toBe('first');
    await vi.waitFor(() => expect(ctx.started).toEqual(['first', 'second']));
    ctx.release('second');
    await expect(second).resolves.toBe('second');
  });

  it('runs tasks side by side up to the configured concurrency', async () => {
    using ctx = setup({}, { concurrency: 2 });

    const tasks = ['a', 'b', 'c'].map(name => ctx.client.request('hold', name));
    await vi.waitFor(() => expect(ctx.started).toEqual(['a', 'b']));

    ctx.release('a');
    await vi.waitFor(() => expect(ctx.started).toEqual(['a', 'b', 'c']));
    ctx.release('b');
    ctx.release('c');
    await expect(Promise.all(tasks)).resolves.toEqual(['a', 'b', 'c']);
  });

  it('drops a queued task when it is cancelled', async () => {
    using ctx = setup();
    const controller = new AbortController();

    const first = ctx.client.request('hold', 'first');
    const second = ctx.client.request('hold', 'second', { signal: controller.signal });
    await vi.waitFor(() => expect(ctx.started).toEqual(['first']));
    controller.abort();

    await expect(second).rejects.toMatchObject({ name: 'AbortError' });
    // 取消消息要等下一个任务才送达；先等它到达，才是"还在排队时被取消"（已经开始的任务由 signal 中止）
    await settled(new Promise(() => undefined));
    ctx.release('first');
    await first;
    await settled(new Promise(() => undefined));
    expect(ctx.started).toEqual(['first']);
  });

  it('aborts the signal of a running task when it is cancelled', async () => {
    const running = gate();
    let aborted = false;
    using ctx = setup({
      watch: (_, { signal }) => {
        running.open();
        return new Promise(resolve => {
          signal.addEventListener('abort', () => {
            aborted = true;
            resolve('aborted');
          });
        });
      }
    });
    const controller = new AbortController();

    const watching = ctx.client.request('watch', undefined, { signal: controller.signal });
    await running.opened;
    controller.abort();

    await expect(watching).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(aborted).toBe(true));
  });

  it('stops a long computation at the next checkpoint after it is cancelled', async () => {
    const running = gate();
    const finished = gate();
    let completed = 0;
    using ctx = setup({
      count: async (iterations, { checkpoint }) => {
        try {
          for (let index = 0; index < iterations; index++) {
            completed++;
            running.open();
            // oxlint-disable-next-line no-await-in-loop -- 分段执行：每段之间让出事件循环，取消消息才能被处理
            await checkpoint();
          }
          return completed;
        } finally {
          finished.open();
        }
      }
    });
    const controller = new AbortController();

    const counting = ctx.client.request('count', 10_000, { signal: controller.signal });
    await running.opened;
    controller.abort();

    await expect(counting).rejects.toMatchObject({ name: 'AbortError' });
    await finished.opened;
    expect(completed).toBeLessThan(10_000);
  });

  it('transfers the objects a handler marks', async () => {
    let sent: ArrayBuffer | undefined;
    using ctx = setup({
      bytes: size => {
        sent = new ArrayBuffer(size);
        return transfer(sent, [sent]);
      }
    });

    const received = await ctx.client.request('bytes', 16);

    expect(received.byteLength).toBe(16);
    // 所有权已经转移：发送方手里的缓冲区被清空
    expect(sent?.byteLength).toBe(0);
  });

  it('replies a failure when the result cannot be cloned', async () => {
    using ctx = setup();

    await expect(ctx.client.request('unclonable', undefined)).rejects.toMatchObject({ name: 'DataCloneError' });
  });

  it('reports a message it cannot deserialize and stops serving', async () => {
    const running = gate();
    let aborted = false;
    using ctx = setup({
      watch: (_, { signal }) => {
        running.open();
        return new Promise(resolve => {
          signal.addEventListener('abort', () => {
            aborted = true;
            resolve('aborted');
          });
        });
      }
    });

    const watching = ctx.client.request('watch', undefined);
    await running.opened;
    ctx.serverEndpoint.crash('messageerror');

    await expect(settled(watching)).rejects.toBeInstanceOf(WorkerCrashedError);
    // 客户端已经失效，执行中的任务没有意义了
    expect(aborted).toBe(true);
    expect(ctx.serverEndpoint.listenerCount()).toBe(0);
  });

  it('stops handling requests after disposal', async () => {
    using ctx = setup();

    ctx.server[Symbol.dispose]();

    expect(await settled(ctx.client.request('echo', 'hello'))).toBe('pending');
  });
});
