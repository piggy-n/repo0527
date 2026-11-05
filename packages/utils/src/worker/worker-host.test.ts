// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { transfer, WorkerCrashedError, WorkerUnavailableError } from './protocol';
import { gate, settled, TestEndpoint } from './testing';
import { WorkerHost, type WorkerHostOptions } from './worker-host';
import { serveWorker, type WorkerHandlers } from './worker-server';

interface TestProtocol {
  echo: { request: string; response: string };
  hold: { request: undefined; response: string };
  bytes: { request: number; response: ArrayBuffer };
}

function setup(options: Partial<WorkerHostOptions<TestProtocol>> = {}) {
  const stack = new DisposableStack();
  const released = gate();
  const workers: TestEndpoint[] = [];
  const serverEndpoints: TestEndpoint[] = [];
  const handlers: WorkerHandlers<TestProtocol> = {
    echo: text => text,
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
  // 每次"创建 Worker"都是一对新的端口，另一端挂上 serveWorker
  const createWorker = () => {
    const { port1, port2 } = new MessageChannel();
    const serverEndpoint = new TestEndpoint(port2);
    serverEndpoints.push(serverEndpoint);
    stack.use(serveWorker(serverEndpoint, handlers));
    stack.defer(() => port2.close());
    const worker = new TestEndpoint(port1);
    workers.push(worker);
    return worker;
  };
  const host = new WorkerHost<TestProtocol>({ createWorker, ...options });
  stack.use(host);
  return {
    host,
    workers,
    serverEndpoints,
    createWorker,
    release: released.open,
    [Symbol.dispose]: () => stack.dispose()
  };
}

// 让最近创建的 Worker 在请求进行中崩溃
async function crashWhileBusy({ host, workers }: ReturnType<typeof setup>) {
  const pending = host.request('hold', undefined);
  workers.at(-1)?.crash();
  await expect(settled(pending)).rejects.toBeInstanceOf(WorkerCrashedError);
}

describe('WorkerHost', () => {
  it('creates the worker on the first request and reuses it', async () => {
    using ctx = setup();
    expect(ctx.workers).toHaveLength(0);

    await ctx.host.request('echo', 'first');
    await ctx.host.request('echo', 'second');

    expect(ctx.workers).toHaveLength(1);
  });

  it('terminates a crashed worker and creates a new one for the next request', async () => {
    using ctx = setup();

    const pending = ctx.host.request('hold', undefined);
    ctx.workers[0]?.crash();

    await expect(settled(pending)).rejects.toBeInstanceOf(WorkerCrashedError);
    expect(ctx.workers[0]?.terminated).toBe(true);
    await expect(ctx.host.request('echo', 'after crash')).resolves.toBe('after crash');
    expect(ctx.workers).toHaveLength(2);
  });

  it('replaces the worker when the worker cannot deserialize a message', async () => {
    using ctx = setup();

    const pending = ctx.host.request('hold', undefined);
    ctx.serverEndpoints[0]?.crash('messageerror');

    await expect(settled(pending)).rejects.toBeInstanceOf(WorkerCrashedError);
    expect(ctx.workers[0]?.terminated).toBe(true);
    await expect(ctx.host.request('echo', 'after messageerror')).resolves.toBe('after messageerror');
    expect(ctx.workers).toHaveLength(2);
  });

  it('stops recreating the worker after too many consecutive crashes', async () => {
    using ctx = setup({ maxRestarts: 1 });

    await crashWhileBusy(ctx);
    await crashWhileBusy(ctx);

    await expect(ctx.host.request('echo', 'hello')).rejects.toBeInstanceOf(WorkerUnavailableError);
    expect(ctx.workers).toHaveLength(2);
  });

  it('counts crashes again from zero after a request succeeds', async () => {
    using ctx = setup({ maxRestarts: 1 });

    await crashWhileBusy(ctx);
    await expect(ctx.host.request('echo', 'first')).resolves.toBe('first');
    await crashWhileBusy(ctx);
    await expect(ctx.host.request('echo', 'second')).resolves.toBe('second');
    await crashWhileBusy(ctx);
    await expect(ctx.host.request('echo', 'third')).resolves.toBe('third');
  });

  it('rejects without counting a crash when the worker cannot be created', async () => {
    using ctx = setup();
    let supported = false;
    using host = new WorkerHost<TestProtocol>({
      createWorker: () => {
        if (!supported) {
          throw new Error('Worker is not supported');
        }
        return ctx.createWorker();
      },
      maxRestarts: 0
    });

    await expect(host.request('echo', 'hello')).rejects.toThrow('Worker is not supported');
    supported = true;
    // 创建失败不算崩溃：maxRestarts 为 0 也可以再次尝试
    await expect(host.request('echo', 'hello')).resolves.toBe('hello');
  });

  it('passes the discard handlers to its client', async () => {
    const discarded: number[] = [];
    using ctx = setup({ discard: { bytes: buffer => discarded.push(buffer.byteLength) } });
    const controller = new AbortController();

    const request = ctx.host.request('bytes', 8, { signal: controller.signal });
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    ctx.release();

    await vi.waitFor(() => expect(discarded).toEqual([8]));
  });

  it('terminates the worker and rejects pending requests on disposal', async () => {
    using ctx = setup();

    const pending = ctx.host.request('hold', undefined);
    ctx.host[Symbol.dispose]();

    await expect(settled(pending)).rejects.toMatchObject({ name: 'AbortError' });
    expect(ctx.workers[0]?.terminated).toBe(true);
    await expect(ctx.host.request('echo', 'hello')).rejects.toThrow('WorkerHost 已释放');
  });
});
