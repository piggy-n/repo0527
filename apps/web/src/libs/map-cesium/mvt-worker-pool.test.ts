// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { serveWorker } from '@yzt/utils';
import { MvtWorkerPool } from './mvt-worker-pool';
import type { MvtRenderRequest, MvtWorkerProtocol } from './mvt-worker-protocol';

const resources: Disposable[] = [];
afterEach(() => { resources.toReversed().forEach(resource => resource[Symbol.dispose]()); resources.length = 0; });

// 使用真实消息端口验证池的分片和所有权；真正位图转移留给浏览器用例
function fixture(wait = false) {
  const calls: { worker: number; payload: MvtRenderRequest }[] = [];
  let workers = 0;
  const terminate = vi.fn<() => void>();
  const createWorker = () => {
    const worker = workers++;
    const channel = new MessageChannel();
    const server = serveWorker<MvtWorkerProtocol>(channel.port2, {
      render: (payload, { signal }) => {
        calls.push({ worker, payload });
        if (wait) {
          return new Promise<ImageBitmap>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true });
          });
        }
        return { width: 512, height: 512 } as ImageBitmap;
      },
      stats: () => null
    }, { concurrency: 4 });
    resources.push({ [Symbol.dispose]: () => { server[Symbol.dispose](); channel.port1.close(); channel.port2.close(); } });
    return {
      postMessage: channel.port1.postMessage.bind(channel.port1),
      addEventListener: channel.port1.addEventListener.bind(channel.port1),
      removeEventListener: channel.port1.removeEventListener.bind(channel.port1),
      start: () => channel.port1.start(),
      terminate
    };
  };
  const pool = new MvtWorkerPool({ createWorker, workerCount: 2, budgetBytes: 4096, maxPending: 2 });
  resources.push(pool);
  return { pool, calls, terminate, workers: () => workers };
}

function request(tile = { x: 0, y: 0, z: 0 }): Omit<MvtRenderRequest, 'budgetBytes'> {
  return {
    source: { type: 'vector', tiles: ['https://example.test/{z}/{x}/{y}.pbf'] },
    data: {
      source: { tiles: ['https://example.test/{z}/{x}/{y}.pbf'], dataVersion: '1', permissionScope: 'test' },
      coordinate: { x: 0, y: 0, z: 0 }, url: 'https://example.test/0/0/0.pbf', fields: []
    },
    layer: { id: 'area', type: 'fill', source: 'data', 'source-layer': 'land' },
    tile, cameraZoom: 2, tileSize: 512
  };
}

describe('MVT 视图 Worker 池', () => {
  it('统计不创建线程，同父瓦片不同子块固定同线程并平分总预算', async () => {
    const { pool, workers, calls } = fixture();
    expect(await pool.stats()).toEqual([]);
    expect(workers()).toBe(0);
    const signal = new AbortController().signal;
    await pool.render(request({ x: 0, y: 0, z: 1 }), signal);
    await pool.render(request({ x: 1, y: 1, z: 1 }), signal);
    expect(workers()).toBe(1);
    expect(calls.map(call => call.worker)).toEqual([0, 0]);
    expect(calls.map(call => call.payload.budgetBytes)).toEqual([2048, 2048]);
    expect(await pool.stats()).toEqual([null]);
  });

  it('并发上限返回背压，暂停立即结束等待，恢复可再发任务，释放终止线程', async () => {
    const { pool, terminate } = fixture(true);
    const signal = new AbortController().signal;
    const first = pool.render(request(), signal).catch(error => error as Error);
    const second = pool.render(request(), signal).catch(error => error as Error);
    expect(pool.hasCapacity).toBe(false);
    pool.pause();
    expect(await first).toMatchObject({ name: 'AbortError' });
    expect(await second).toMatchObject({ name: 'AbortError' });
    expect(pool.hasCapacity).toBe(false);
    pool.resume();
    expect(pool.hasCapacity).toBe(true);
    pool[Symbol.dispose]();
    expect(pool.hasCapacity).toBe(false);
    expect(terminate).toHaveBeenCalledOnce();
  });

  it('非法数据身份不占任务名额，预先取消不创建 Worker', async () => {
    const { pool, workers } = fixture();
    const valid = request();
    const invalid = { ...valid, data: { ...valid.data, coordinate: { x: -1, y: 0, z: 0 } } };
    await expect(pool.render(invalid, new AbortController().signal)).rejects.toThrow('瓦片坐标');
    expect(pool.hasCapacity).toBe(true);
    expect(workers()).toBe(0);
    const controller = new AbortController();
    controller.abort();
    await expect(pool.render(request(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(workers()).toBe(0);
  });
});
