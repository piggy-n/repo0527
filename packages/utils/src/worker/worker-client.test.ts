// @vitest-environment node
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { transfer, WorkerCrashedError } from './protocol';
import { connect, flushMessages, gate, settled } from './testing';
import type { WorkerClientOptions } from './worker-client';
import type { WorkerHandlers } from './worker-server';

interface TestProtocol {
  echo: { request: string; response: string };
  hold: { request: undefined; response: string };
  bytes: { request: number; response: ArrayBuffer };
}

function setup(client?: WorkerClientOptions<TestProtocol>) {
  const released = gate();
  const received: string[] = [];
  const handlers: WorkerHandlers<TestProtocol> = {
    echo: text => {
      received.push(text);
      return text;
    },
    hold: async () => {
      await released.opened;
      return 'released';
    },
    bytes: async size => {
      await released.opened;
      const buffer = new ArrayBuffer(size);
      return transfer(buffer, [buffer]);
    }
  };
  return { ...connect(handlers, { client }), received, release: released.open };
}

describe('WorkerClient', () => {
  it('infers the payload and response types from the method name', async () => {
    using ctx = setup();

    expectTypeOf(ctx.client.request('echo', 'hello')).resolves.toEqualTypeOf<string>();
    const typeErrors = () => {
      // @ts-expect-error 协议里没有这个方法
      void ctx.client.request('missing', 'hello');
      // @ts-expect-error echo 的请求是字符串
      void ctx.client.request('echo', 1);
    };

    expect(typeErrors).toBeTypeOf('function');
    await expect(ctx.client.request('echo', 'hello')).resolves.toBe('hello');
  });

  it('rejects at once without sending when the signal is already aborted', async () => {
    using ctx = setup();

    await expect(ctx.client.request('echo', 'hello', { signal: AbortSignal.abort() })).rejects.toMatchObject({
      name: 'AbortError'
    });
    await flushMessages();
    expect(ctx.received).toEqual([]);
  });

  it('rejects with the reason of the signal, such as TimeoutError', async () => {
    using ctx = setup();

    await expect(ctx.client.request('hold', undefined, { signal: AbortSignal.timeout(10) })).rejects.toMatchObject({
      name: 'TimeoutError'
    });
  });

  it('releases a result that arrives after the request was cancelled', async () => {
    const discarded: number[] = [];
    using ctx = setup({ discard: { bytes: buffer => discarded.push(buffer.byteLength) } });
    const controller = new AbortController();

    const request = ctx.client.request('bytes', 32, { signal: controller.signal });
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    ctx.release();

    await vi.waitFor(() => expect(discarded).toEqual([32]));
  });

  it('rejects only the request whose payload cannot be cloned', async () => {
    using ctx = setup();
    const unclonable = (() => 'functions cannot be cloned') as unknown as string;

    const failed = ctx.client.request('echo', unclonable);
    const other = ctx.client.request('echo', 'still works');

    await expect(failed).rejects.toMatchObject({ name: 'DataCloneError' });
    await expect(other).resolves.toBe('still works');
  });

  it.each(['error', 'messageerror'] as const)('fails every pending request when the endpoint reports %s', async type => {
    const crashes: WorkerCrashedError[] = [];
    using ctx = setup({ onCrash: error => crashes.push(error) });

    const pending = [ctx.client.request('hold', undefined), ctx.client.request('echo', 'queued')];
    ctx.endpoint.crash(type);

    // settled：实现出错时请求会一直挂着，用它让测试因断言失败而不是超时
    await Promise.all(pending.map(request => expect(settled(request)).rejects.toBeInstanceOf(WorkerCrashedError)));
    expect(crashes).toHaveLength(1);
    expect(ctx.client.crashed).toBe(true);
    // 崩溃后的请求立即以同一个错误结束
    await expect(settled(ctx.client.request('echo', 'later'))).rejects.toBe(crashes[0]);
    expect(ctx.endpoint.listenerCount()).toBe(0);
  });

  it('fails every pending request when the worker cannot deserialize a message', async () => {
    const crashes: WorkerCrashedError[] = [];
    using ctx = setup({ onCrash: error => crashes.push(error) });

    const pending = [ctx.client.request('hold', undefined), ctx.client.request('echo', 'queued')];
    // Worker 一侧触发 messageerror：它不知道是哪条消息，主线程也收不到任何事件
    ctx.serverEndpoint.crash('messageerror');

    await Promise.all(pending.map(request => expect(settled(request)).rejects.toBeInstanceOf(WorkerCrashedError)));
    expect(crashes).toHaveLength(1);
    expect(ctx.client.crashed).toBe(true);
  });

  it('ignores messages that are not part of the protocol', async () => {
    using ctx = setup();

    ctx.serverPort.postMessage({ hello: 'world' }, []);
    ctx.serverPort.postMessage({ kind: 'result', id: 999, method: 'echo', value: 'stray' }, []);

    await expect(ctx.client.request('echo', 'hello')).resolves.toBe('hello');
    expect(ctx.client.crashed).toBe(false);
  });

  it('rejects pending requests with AbortError on disposal and refuses new ones', async () => {
    using ctx = setup();

    const pending = ctx.client.request('hold', undefined);
    ctx.client[Symbol.dispose]();

    await expect(settled(pending)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(ctx.client.request('echo', 'hello')).rejects.toThrow('WorkerClient 已释放');
    expect(() => ctx.client[Symbol.dispose]()).not.toThrow();
  });
});
