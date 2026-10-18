// @vitest-environment node
import type { GeoJSONSourceSpecification } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it, vi } from 'vitest';
import { GeoJsonSources } from './geojson-source';

const DATA = { type: 'Point', coordinates: [118, 32] };
const OTHER = { type: 'Point', coordinates: [119, 33] };
const source = (): GeoJSONSourceSpecification => ({ type: 'geojson', data: '/local/area.json' });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
}

// 中止必须早于下一轮定时任务结束，故障时是断言失败而不是挂起或超时
function settled(promise: Promise<unknown>): Promise<unknown> {
  return Promise.race([promise.catch((error: unknown) => error),
    new Promise(resolve => setTimeout(() => resolve('未取消'), 0))]);
}

describe('URL GeoJSON 来源租约', () => {
  it('相同来源共用下载与解析，新租约先取得再替换旧租约时复用，最后释放后重新下载', async () => {
    const fetchSource = vi.fn<typeof fetch>(async () => Response.json(DATA));
    using sources = new GeoJsonSources({ fetch: fetchSource });
    const input = source();
    const first = sources.acquire(input);
    const second = sources.acquire(input);
    const initial = await first.promise;
    expect(await second.promise).toBe(initial);
    const replacement = sources.acquire(input);
    first[Symbol.dispose]();
    second[Symbol.dispose]();
    expect(await replacement.promise).toBe(initial);
    expect(fetchSource).toHaveBeenCalledTimes(1);
    replacement[Symbol.dispose]();
    expect(replacement.signal.aborted).toBe(true);
    using next = sources.acquire(input);
    expect(await next.promise).toEqual(DATA);
    expect(fetchSource).toHaveBeenCalledTimes(2);
  });

  it('一个租约取消立即结束等待，不取消其他租约的下载', async () => {
    const response = deferred<Response>();
    let transport: AbortSignal | undefined;
    using sources = new GeoJsonSources({ fetch: vi.fn<typeof fetch>((_url, options) => {
      transport = options?.signal ?? undefined;
      return response.promise;
    }) });
    const input = source();
    const first = sources.acquire(input);
    using second = sources.acquire(input);
    const result = settled(first.promise);
    first[Symbol.dispose]();
    expect(await result).toMatchObject({ name: 'AbortError' });
    expect(transport?.aborted).toBe(false);
    response.resolve(Response.json(DATA));
    expect(await second.promise).toEqual(DATA);
    expect(second.signal.aborted).toBe(false);
  });

  it('最后的租约取消下载；忽略中止后晚到的响应不解析，也不覆盖新请求', async () => {
    const response = deferred<Response>();
    const late = Response.json(DATA);
    const json = vi.spyOn(late, 'json');
    const fetchSource = vi.fn<typeof fetch>().mockReturnValueOnce(response.promise)
      .mockResolvedValueOnce(Response.json(OTHER));
    using sources = new GeoJsonSources({ fetch: fetchSource });
    const input = source();
    const first = sources.acquire(input);
    const result = settled(first.promise);
    first[Symbol.dispose]();
    expect(await result).toMatchObject({ name: 'AbortError' });
    expect(fetchSource.mock.calls[0][1]?.signal?.aborted).toBe(true);
    using replacement = sources.acquire(input);
    response.resolve(late);
    expect(await replacement.promise).toEqual(OTHER);
    expect(json).not.toHaveBeenCalled();
    using retained = sources.acquire(input);
    expect(await retained.promise).toBe(await replacement.promise);
    expect(fetchSource).toHaveBeenCalledTimes(2);
  });

  it('解析等待期间取消，晚到的数据不能使已取消租约成功', async () => {
    const body = deferred<unknown>();
    const response = Response.json(DATA);
    const reading = deferred<void>();
    vi.spyOn(response, 'json').mockImplementation(() => { reading.resolve(); return body.promise; });
    using sources = new GeoJsonSources({ fetch: vi.fn<typeof fetch>().mockResolvedValue(response) });
    const lease = sources.acquire(source());
    const result = settled(lease.promise);
    await reading.promise;
    lease[Symbol.dispose]();
    body.resolve(DATA);
    expect(await result).toMatchObject({ name: 'AbortError' });
  });

  it('HTTP失败不缓存，即使旧租约未释放也能重试，同地址的新source身份独立', async () => {
    const fetchSource = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockImplementation(async () => Response.json(DATA));
    using sources = new GeoJsonSources({ fetch: fetchSource });
    const input = source();
    using failed = sources.acquire(input);
    await expect(failed.promise).rejects.toThrow('503');
    using retry = sources.acquire(input);
    expect(await retry.promise).toEqual(DATA);
    using independent = sources.acquire(source());
    expect(await independent.promise).toEqual(DATA);
    expect(fetchSource).toHaveBeenCalledTimes(3);
  });

  it('拒绝非GeoJSON和无效嵌套坐标，允许空集合、null几何及正常属性', async () => {
    const fetchSource = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ code: 500, message: '不是地理数据' }))
      .mockResolvedValueOnce(Response.json({ type: 'Polygon', coordinates: [[[118, '32']]] }))
      .mockResolvedValueOnce(Response.json({ type: 'FeatureCollection', features: [] }))
      .mockResolvedValueOnce(Response.json({ type: 'Feature', geometry: null, properties: { name: '空几何' } }));
    using sources = new GeoJsonSources({ fetch: fetchSource });
    using first = sources.acquire(source());
    await expect(first.promise).rejects.toThrow('Invalid input');
    using second = sources.acquire(source());
    await expect(second.promise).rejects.toThrow('Invalid input');
    using empty = sources.acquire(source());
    expect(await empty.promise).toEqual({ type: 'FeatureCollection', features: [] });
    using nullable = sources.acquire(source());
    expect(await nullable.promise).toEqual({ type: 'Feature', geometry: null, properties: { name: '空几何' } });
  });

  it('释放服务取消所有活跃租约，重复释放安全，释放后不能再申请', async () => {
    const response = deferred<Response>();
    const sources = new GeoJsonSources({ fetch: vi.fn<typeof fetch>().mockReturnValue(response.promise) });
    const first = sources.acquire(source());
    const second = sources.acquire(source());
    const results = [settled(first.promise), settled(second.promise)];
    sources[Symbol.dispose]();
    sources[Symbol.dispose]();
    expect(await Promise.all(results)).toEqual([
      expect.objectContaining({ name: 'AbortError' }), expect.objectContaining({ name: 'AbortError' })
    ]);
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(true);
    expect(() => sources.acquire(source())).toThrow('已释放');
    first[Symbol.dispose]();
    second[Symbol.dispose]();
    response.resolve(Response.json(DATA));
  });
});
