// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { yieldToEventLoop } from '@yzt/utils';
import { TileDataService, type TileDataRequest } from './tile-data-service';
import { gate, sampleTile, tileBytes } from './testing';

const server = setupServer();
const SIGNAL = new AbortController().signal;
const REQUEST: TileDataRequest = {
  source: { tiles: ['https://tiles.test/{z}/{x}/{y}.pbf'], dataVersion: 'v1', permissionScope: 'user-a' },
  coordinate: { z: 1, x: 0, y: 0 }, url: 'https://tiles.test/1/0/0.pbf', fields: ['class']
};

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/** 调用方取消只经过微任务；若没有结束等待，以明确的 pending 断言失败 */
async function cancellationResult(promise: Promise<unknown>): Promise<string> {
  return Promise.race([
    promise.then(() => 'resolved', (error: unknown) => error instanceof Error ? error.name : 'unknown'),
    new Promise<string>(resolve => setTimeout(() => resolve('pending'), 0))
  ]);
}

describe('Worker 瓦片数据服务', () => {
  it('调用下载端口不把服务实例当作 this，兼容 WorkerGlobalScope 的原生 fetch', async () => {
    const receivers: unknown[] = [];
    const fetchTile: typeof fetch = function (this: unknown) {
      receivers.push(this);
      return Promise.resolve(new Response(sampleTile()));
    };
    using service = new TileDataService({ budgetBytes: 10_000, fetch: fetchTile });
    await service.acquire(REQUEST, { signal: SIGNAL });
    expect(receivers).toEqual([undefined]);
  });

  it('同一原生瓦片共享下载和解码，字段取并集并原样传入鉴权头', async () => {
    const started = gate<void>();
    const download = gate<void>();
    let requests = 0;
    server.use(http.get(REQUEST.url, async ({ request }) => {
      requests++;
      expect(request.headers.get('authorization')).toBe('Bearer example');
      started.resolve();
      await download.promise;
      return HttpResponse.arrayBuffer(sampleTile());
    }));
    using service = new TileDataService({ budgetBytes: 10_000 });
    const first = service.acquire({ ...REQUEST, headers: { authorization: 'Bearer example' } }, { signal: SIGNAL });
    const second = service.acquire({ ...REQUEST, fields: ['name'] }, { signal: SIGNAL });
    await started.promise;
    expect(service.stats.inflight).toBe(1);
    download.resolve();
    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(b);
    expect(a.layers['地块'].features[0].properties).toEqual({ class: '林地', name: '样本' });
    expect(requests).toBe(1);
    expect(service.stats).toMatchObject({ downloads: 1, decodes: 1, inflight: 0, tiles: 1 });
    expect(service.stats.bytes).toBe(sampleTile().byteLength + a.bytes);
    expect(await service.acquire({ ...REQUEST, url: 'https://another.test/same-tile' }, { signal: SIGNAL })).toBe(a);
    expect(service.stats.hits).toBe(1);
    expect(requests).toBe(1);
  });

  it('新增字段与全部属性只重解原始 PBF，纯样式修改直接复用', async () => {
    const fetchTile = vi.fn<typeof fetch>(async () => new Response(sampleTile()));
    using service = new TileDataService({ budgetBytes: 10_000, fetch: fetchTile });
    const first = await service.acquire(REQUEST, { signal: SIGNAL });
    expect(first.layers['地块'].features[0].properties).toEqual({ class: '林地' });
    const expanded = await service.acquire({ ...REQUEST, fields: ['name'] }, { signal: SIGNAL });
    expect(expanded.layers['地块'].features[0].properties).toEqual({ class: '林地', name: '样本' });
    const full = await service.acquire({ ...REQUEST, fields: null }, { signal: SIGNAL });
    expect(full.layers['地块'].features[0].properties).toEqual({ class: '林地', name: '样本', enabled: true });
    expect(await service.acquire(REQUEST, { signal: SIGNAL })).toBe(full);
    expect(fetchTile).toHaveBeenCalledTimes(1);
    expect(service.stats.decodes).toBe(3);
  });

  it('新消费者在解码让出期间增加字段，所有等待者都收到最新并集', async () => {
    const fetched = gate<void>();
    const fetchTile = vi.fn<typeof fetch>(async () => {
      fetched.resolve();
      return new Response(tileBytes([{ name: '地块', features: Array.from({ length: 130 }, () => ({
        type: 1, properties: { class: '林地', name: '样本' }, paths: [[[0, 0]]] as const
      })) }]));
    });
    using service = new TileDataService({ budgetBytes: 100_000, fetch: fetchTile });
    const first = service.acquire(REQUEST, { signal: SIGNAL });
    await fetched.promise;
    // 进入真实解码的第一批让出，后续调用扩大该任务尚未完成的字段集合
    await yieldToEventLoop();
    const second = service.acquire({ ...REQUEST, fields: ['name'] }, { signal: SIGNAL });
    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(b);
    expect(a.layers['地块'].features[129].properties).toEqual({ class: '林地', name: '样本' });
    expect(fetchTile).toHaveBeenCalledTimes(1);
    expect(service.stats.decodes).toBeGreaterThanOrEqual(2);
  });

  it('一位消费者取消立即结束自己的等待，其余消费者继续完成同一次下载', async () => {
    const started = gate<void>();
    const download = gate<Response>();
    let underlying: AbortSignal | undefined;
    const fetchTile = vi.fn<typeof fetch>((_url, init) => {
      underlying = init?.signal ?? undefined;
      started.resolve();
      return download.promise;
    });
    using service = new TileDataService({ budgetBytes: 10_000, fetch: fetchTile });
    const controller = new AbortController();
    const first = service.acquire(REQUEST, { signal: controller.signal });
    const firstResult = cancellationResult(first);
    const second = service.acquire(REQUEST, { signal: SIGNAL });
    await started.promise;
    controller.abort();
    expect(await firstResult).toBe('AbortError');
    expect(underlying?.aborted).toBe(false);
    expect(service.stats.aborts).toBe(0);
    download.resolve(new Response(sampleTile()));
    expect((await second).layers['地块'].features[0].id).toBe(7);
    expect(service.stats.downloads).toBe(1);
  });

  it('所有消费者离开才中止底层请求，晚到旧下载不覆盖同键的新任务', async () => {
    const started = gate<void>();
    const oldDownload = gate<Response>();
    let underlying: AbortSignal | undefined;
    const fetchTile = vi.fn<typeof fetch>()
      .mockImplementationOnce((_url, init) => {
        underlying = init?.signal ?? undefined;
        started.resolve();
        return oldDownload.promise;
      })
      .mockImplementation(async () => new Response(sampleTile()));
    using service = new TileDataService({ budgetBytes: 10_000, fetch: fetchTile });
    const controller = new AbortController();
    const previous = service.acquire(REQUEST, { signal: controller.signal });
    const previousResult = cancellationResult(previous);
    await started.promise;
    controller.abort();
    expect(await previousResult).toBe('AbortError');
    expect(underlying?.aborted).toBe(true);
    expect(service.stats).toMatchObject({ inflight: 0, aborts: 1 });
    const next = await service.acquire(REQUEST, { signal: SIGNAL });
    oldDownload.resolve(new Response(new ArrayBuffer(0)));
    await yieldToEventLoop();
    expect(await service.acquire(REQUEST, { signal: SIGNAL })).toBe(next);
    expect(service.stats).toMatchObject({ tiles: 1, downloads: 2, decodes: 1 });
  });

  it('取消发生在 arrayBuffer 等待期间时，不解码也不缓存晚到内容', async () => {
    const reading = gate<void>();
    const body = gate<ArrayBuffer>();
    const response = new Response();
    vi.spyOn(response, 'arrayBuffer').mockImplementation(() => {
      reading.resolve();
      return body.promise;
    });
    const fetchTile = vi.fn<typeof fetch>(async () => response);
    using service = new TileDataService({ budgetBytes: 10_000, fetch: fetchTile });
    const controller = new AbortController();
    const result = cancellationResult(service.acquire(REQUEST, { signal: controller.signal }));
    await reading.promise;
    controller.abort();
    expect(await result).toBe('AbortError');
    body.resolve(sampleTile());
    await yieldToEventLoop();
    expect(service.stats).toMatchObject({ tiles: 0, decodes: 0, inflight: 0, aborts: 1 });
  });

  it('立即取消不发请求，释放清空缓存并让所有等待者以 AbortError 结束', async () => {
    const download = gate<Response>();
    const fetchTile = vi.fn<typeof fetch>(() => download.promise);
    const service = new TileDataService({ budgetBytes: 10_000, fetch: fetchTile });
    const controller = new AbortController();
    const early = cancellationResult(service.acquire(REQUEST, { signal: controller.signal }));
    controller.abort();
    expect(await early).toBe('AbortError');
    expect(fetchTile).not.toHaveBeenCalled();
    const first = cancellationResult(service.acquire(REQUEST, { signal: SIGNAL }));
    const second = cancellationResult(service.acquire({ ...REQUEST, coordinate: { z: 1, x: 1, y: 0 } }, { signal: SIGNAL }));
    await Promise.resolve();
    service[Symbol.dispose]();
    service[Symbol.dispose]();
    expect(await first).toBe('AbortError');
    expect(await second).toBe('AbortError');
    expect(service.stats).toMatchObject({ bytes: 0, tiles: 0, inflight: 0, aborts: 3 });
    download.resolve(new Response(sampleTile()));
    await yieldToEventLoop();
    expect(service.stats.tiles).toBe(0);
    await expect(service.acquire(REQUEST, { signal: SIGNAL })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('空成功瓦片可以缓存，HTTP 和解码失败不能变成长期空数据', async () => {
    let response = new HttpResponse(null, { status: 503 });
    server.use(http.get(REQUEST.url, () => response));
    using service = new TileDataService({ budgetBytes: 10_000 });
    await expect(service.acquire(REQUEST, { signal: SIGNAL })).rejects.toThrow('HTTP 503');
    expect(service.stats.tiles).toBe(0);
    response = HttpResponse.arrayBuffer(new Uint8Array([15]).buffer);
    await expect(service.acquire(REQUEST, { signal: SIGNAL })).rejects.toThrow(/type/);
    expect(service.stats.tiles).toBe(0);
    response = HttpResponse.arrayBuffer(new ArrayBuffer(0));
    expect((await service.acquire(REQUEST, { signal: SIGNAL })).layers).toEqual({});
    await service.acquire(REQUEST, { signal: SIGNAL });
    expect(service.stats).toMatchObject({ tiles: 1, downloads: 3, hits: 1, bytes: 64 });
  });

  it('同坐标的不同权限、数据版本和模板独立缓存', async () => {
    const fetchTile = vi.fn<typeof fetch>(async () => new Response(sampleTile()));
    using service = new TileDataService({ budgetBytes: 10_000, fetch: fetchTile });
    await service.acquire(REQUEST, { signal: SIGNAL });
    for (const source of [
      { ...REQUEST.source, permissionScope: 'user-b' },
      { ...REQUEST.source, dataVersion: 'v2' },
      { ...REQUEST.source, tiles: ['https://tiles.test/2025/{z}/{x}/{y}.pbf'] },
      { ...REQUEST.source, scheme: 'tms' as const }
    ]) {
      // oxlint-disable-next-line no-await-in-loop -- 顺序加载用于验证已驻留的其他身份不会误命中
      await service.acquire({ ...REQUEST, source }, { signal: SIGNAL });
    }
    expect(fetchTile).toHaveBeenCalledTimes(5);
    expect(service.stats.tiles).toBe(5);
  });

  it('预算统计同时包含原始与解码字节，最近命中顺序决定淘汰', async () => {
    const fetchTile = vi.fn<typeof fetch>(async () => new Response(sampleTile()));
    using measuring = new TileDataService({ budgetBytes: 10_000, fetch: fetchTile });
    await measuring.acquire(REQUEST, { signal: SIGNAL });
    const bytes = measuring.stats.bytes;
    using service = new TileDataService({ budgetBytes: bytes * 2, fetch: fetchTile });
    const second = { ...REQUEST, coordinate: { z: 1, x: 1, y: 0 } };
    const third = { ...REQUEST, coordinate: { z: 1, x: 1, y: 1 } };
    const firstValue = await service.acquire(REQUEST, { signal: SIGNAL });
    await service.acquire(second, { signal: SIGNAL });
    expect(await service.acquire(REQUEST, { signal: SIGNAL })).toBe(firstValue);
    await service.acquire(third, { signal: SIGNAL });
    expect(service.stats.bytes).toBe(bytes * 2);
    expect(await service.acquire(REQUEST, { signal: SIGNAL })).toBe(firstValue);
    await service.acquire(second, { signal: SIGNAL });
    expect(service.stats.downloads).toBe(4);
    using oversized = new TileDataService({ budgetBytes: bytes - 1, fetch: fetchTile });
    await oversized.acquire(REQUEST, { signal: SIGNAL });
    await oversized.acquire(REQUEST, { signal: SIGNAL });
    expect(oversized.stats).toMatchObject({ downloads: 2, tiles: 0, bytes: 0 });
  });

  it('源的最后一张驻留瓦片淘汰后清理字段登记，切年份不累积元数据', async () => {
    const fetchTile = vi.fn<typeof fetch>(async () => new Response(sampleTile()));
    using measuring = new TileDataService({ budgetBytes: 10_000, fetch: fetchTile });
    await measuring.acquire(REQUEST, { signal: SIGNAL });
    using service = new TileDataService({ budgetBytes: measuring.stats.bytes, fetch: fetchTile });
    for (let year = 2000; year < 2020; year++) {
      // oxlint-disable-next-line no-await-in-loop -- 每次等待淘汰完成后检查该历史来源的登记已释放
      await service.acquire({ ...REQUEST, source: { ...REQUEST.source, dataVersion: String(year) } }, { signal: SIGNAL });
      expect(service.stats).toMatchObject({ sources: 1, tiles: 1 });
    }
    using uncached = new TileDataService({ budgetBytes: 0, fetch: fetchTile });
    await uncached.acquire(REQUEST, { signal: SIGNAL });
    expect(uncached.stats).toMatchObject({ sources: 0, tiles: 0, inflight: 0 });
  });

  it('同源仍有其他驻留瓦片时保留字段修订，不会把旧裁剪结果当作新并集', async () => {
    const fetchTile = vi.fn<typeof fetch>(async () => new Response(sampleTile()));
    using service = new TileDataService({ budgetBytes: 10_000, fetch: fetchTile });
    await service.acquire(REQUEST, { signal: SIGNAL });
    await service.acquire({ ...REQUEST, coordinate: { z: 1, x: 1, y: 0 }, fields: ['name'] }, { signal: SIGNAL });
    const first = await service.acquire(REQUEST, { signal: SIGNAL });
    expect(first.layers['地块'].features[0].properties).toEqual({ class: '林地', name: '样本' });
    expect(service.stats).toMatchObject({ sources: 1, tiles: 2, downloads: 2, decodes: 3 });
  });

  it('取消的 signal 和相对 URL 不开始下载', async () => {
    const fetchTile = vi.fn<typeof fetch>();
    using service = new TileDataService({ budgetBytes: 1000, fetch: fetchTile });
    const controller = new AbortController();
    controller.abort();
    await expect(service.acquire(REQUEST, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    await expect(service.acquire({ ...REQUEST, url: '/relative.pbf' }, { signal: SIGNAL })).rejects.toThrow(TypeError);
    expect(fetchTile).not.toHaveBeenCalled();
  });
});
