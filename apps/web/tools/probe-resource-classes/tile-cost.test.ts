// @vitest-environment node
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { ProbeAuthError } from './probe.ts';
import { encodeTile } from './test-tile.ts';
import {
  formatTileCost,
  minZoomConfig,
  runTileCost,
  suggestMinZoom,
  type TileCostIO,
  type TileCostOptions,
  type TileCostResult,
  type ZoomCost
} from './tile-cost.ts';

const TREE = {
  code: 200,
  data: [
    {
      code: null,
      name: '测试',
      children: [
        { code: 'csxhjctb_lrdl', name: '公路线层', geoType: 'Line', yearList: [2025] },
        { code: 'lcsh_sltb', name: '森林分布图斑', geoType: 'Polygon', yearList: [2023, 2024] },
        { code: 'bgdc_dltb', name: '地类图斑', geoType: 'Polygon', yearList: [2025] }
      ]
    }
  ]
};

const LIMITS = { maxBytes: 1000, maxMs: 2000 };

const OPTIONS: TileCostOptions = {
  baseUrl: 'http://backend.test',
  token: 'secret-token',
  codes: new Set(['lcsh_sltb']),
  years: 'latest',
  zooms: [7, 9, 8, 10],
  concurrency: 1,
  exact: false,
  exactLimit: 500000,
  refresh: false,
  timeoutSeconds: 120,
  tilesPerZoom: 2,
  limits: LIMITS
};

// 一张瓦片的回答：大小、生成和传输的耗时，或者直接给响应
interface FakeTile {
  readonly size?: number;
  readonly features?: number;
  readonly firstByteMs?: number;
  readonly transferMs?: number;
  readonly response?: Response;
  readonly error?: Error;
}

const failingResponse = () => Response.json({ success: false, code: 500, msg: '系统异常' });

function tileOfSize(size: number, features: number): Uint8Array {
  if (features === 0) {
    return new Uint8Array();
  }
  // 用属性把瓦片撑到大约这么大；只比较是否超标，不要求精确
  const properties = { pad: 'x'.repeat(Math.max(0, size - 60)) };
  return encodeTile('t', Array.from({ length: features }, () => ({ properties })));
}

interface FakeBackend {
  readonly io: TileCostIO;
  /** 请求过的瓦片：瓦片集/级别 */
  readonly requests: string[];
  readonly tokens: (string | null)[];
  readonly slept: number[];
  readonly saved: (readonly TileCostResult[])[];
}

function fakeBackend(answer: (zoom: number, tileset: string) => FakeTile, loaded: readonly TileCostResult[] = []): FakeBackend {
  let clock = 0;
  const requests: string[] = [];
  const tokens: (string | null)[] = [];
  const slept: number[] = [];
  const saved: (readonly TileCostResult[])[] = [];
  const io: TileCostIO = {
    now: () => clock,
    sleep: milliseconds => {
      slept.push(milliseconds);
      clock += milliseconds;
      return Promise.resolve();
    },
    log: () => undefined,
    load: () => loaded,
    save: results => saved.push([...results]),
    fetch: (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input);
      tokens.push(new Headers(init?.headers).get('token'));
      if (url.pathname === '/resource-map/base/tree') {
        return Promise.resolve(Response.json(TREE));
      }
      const match = /\/api\/tiles\/([^/]+)\/(\d+)\//.exec(url.pathname);
      const tileset = match?.[1] ?? '';
      const zoom = Number(match?.[2]);
      requests.push(`${tileset}/${zoom}`);
      const tile = answer(zoom, tileset);
      if (tile.error) {
        return Promise.reject(tile.error);
      }
      clock += tile.firstByteMs ?? 10;
      const response = tile.response ?? new Response(tileOfSize(tile.size ?? 100, tile.features ?? 1).slice());
      // 传输的耗时算在读取内容的时候
      const read = response.arrayBuffer.bind(response);
      Object.defineProperty(response, 'arrayBuffer', {
        value: () => {
          clock += tile.transferMs ?? 0;
          return read();
        }
      });
      return Promise.resolve(response);
    }
  };
  return { io, requests, tokens, slept, saved };
}

const zoomsOf = (requests: readonly string[]) => [...new Set(requests.map(path => Number(path.split('/')[1])))];

async function firstResult(options: TileCostOptions, io: TileCostIO): Promise<TileCostResult> {
  const [result] = await runTileCost(options, io);
  if (!result) {
    throw new Error('没有结果');
  }
  return result;
}

describe('实测', () => {
  it('从高级别往低查，大小超标就停：更低的级别不请求，建议是上一级', async () => {
    const { io, requests } = fakeBackend(zoom => ({ size: zoom === 8 ? 5000 : 100 }));
    const result = await firstResult(OPTIONS, io);
    expect(zoomsOf(requests)).toStrictEqual([10, 9, 8]);
    expect(result.suggested).toBe(9);
    expect(result.zooms.map(({ zoom, verdict }) => [zoom, verdict])).toStrictEqual([
      [10, 'ok'],
      [9, 'ok'],
      [8, 'heavy']
    ]);
    expect(result.tileset).toBe('lcsh_sltb_2024');
  });

  it('耗时超标同样停：生成慢和传输慢都算', async () => {
    const slowGenerate = await firstResult(OPTIONS, fakeBackend(zoom => ({ firstByteMs: zoom === 9 ? 2500 : 10 })).io);
    expect(slowGenerate.suggested).toBe(10);
    const slowTransfer = await firstResult(OPTIONS, fakeBackend(zoom => ({ transferMs: zoom === 9 ? 2500 : 0 })).io);
    expect(slowTransfer.suggested).toBe(10);
    expect(slowTransfer.zooms[1]?.tiles[0]).toMatchObject({ firstByteMs: 10, totalMs: 2510 });
  });

  it('耗时超标时复测：第二次不慢就不算超标，记下第一次的耗时', async () => {
    let slow = true;
    const { io, requests } = fakeBackend(zoom => {
      if (zoom === 9 && slow) {
        slow = false;
        return { firstByteMs: 3000 };
      }
      return {};
    });
    const result = await firstResult(OPTIONS, io);
    expect(result.suggested).toBe('none');
    expect(result.zooms[1]?.verdict).toBe('ok');
    expect(result.zooms[1]?.tiles[0]).toMatchObject({ firstTryMs: 3000, totalMs: 10 });
    expect(result.zooms[1]?.tiles[1]).not.toHaveProperty('firstTryMs');
    // 第一张测了两次，第二张一次
    expect(requests.filter(path => path.endsWith('/9'))).toHaveLength(3);
  });

  it('大小已经超标时不复测：瓦片很重，不多请求一次', async () => {
    const { io, requests } = fakeBackend(zoom => (zoom === 9 ? { size: 5000, firstByteMs: 3000 } : {}));
    const result = await firstResult(OPTIONS, io);
    expect(result.suggested).toBe(10);
    expect(requests.filter(path => path.endsWith('/9'))).toHaveLength(1);
  });

  it('复测失败时记为失败，不算超标', async () => {
    let count = 0;
    const { io } = fakeBackend(zoom => {
      if (zoom !== 10) {
        return {};
      }
      count += 1;
      if (count === 1) {
        return { firstByteMs: 3000 };
      }
      // 复测失败；同级别的第二张瓦片正常，所以这一级不算全部失败
      return count === 2 ? { response: new Response('', { status: 500 }) } : {};
    });
    const result = await firstResult(OPTIONS, io);
    expect(result.zooms[0]?.errors[0]).toContain('HTTP 500');
    expect(result.zooms[0]?.reason).toBeNull();
    expect(result.suggested).toBe('none');
  });

  it('一个级别里一张超标就不再请求同级别的其他瓦片', async () => {
    const { io, requests } = fakeBackend(zoom => ({ size: zoom === 10 ? 5000 : 100 }));
    const result = await firstResult(OPTIONS, io);
    expect(requests).toStrictEqual(['lcsh_sltb_2024/10']);
    expect(result.zooms[0]?.requested).toBe(2);
    expect(result.zooms[0]?.tiles).toHaveLength(1);
  });

  it('没有超标时查到最低级别，建议不限制；级别的顺序不受参数影响', async () => {
    const { io, requests } = fakeBackend(() => ({}));
    const result = await firstResult(OPTIONS, io);
    expect(zoomsOf(requests)).toStrictEqual([10, 9, 8, 7]);
    expect(result.suggested).toBe('none');
  });

  it('是否超标按解压后的大小；传输大小取响应头；记下压缩和缓存的响应头', async () => {
    const compressed = new Uint8Array(gzipSync(tileOfSize(5000, 1)));
    const response = () =>
      new Response(compressed.slice(), {
        headers: { 'content-length': String(compressed.length), 'content-encoding': 'gzip', 'cache-control': 'max-age=300' }
      });
    const { io } = fakeBackend(() => ({ response: response() }));
    const result = await firstResult(OPTIONS, io);
    const [tile] = result.zooms[0]?.tiles ?? [];
    expect(compressed.length).toBeLessThan(LIMITS.maxBytes);
    expect(tile?.bytes).toBeGreaterThan(LIMITS.maxBytes);
    expect(tile?.transferBytes).toBe(compressed.length);
    expect(result.suggested).toBe(11);
    expect(result.headers).toMatchObject({ 'content-encoding': 'gzip', 'cache-control': 'max-age=300' });
  });

  it('fetch 已经自动解压时，传输大小仍取响应头；没有响应头时取收到的字节数', async () => {
    const body = tileOfSize(500, 1);
    const withHeader = new Response(body.slice(), { headers: { 'content-length': '321', 'content-encoding': 'gzip' } });
    const compressed = await firstResult(OPTIONS, fakeBackend(() => ({ response: withHeader.clone() })).io);
    expect(compressed.zooms[0]?.tiles[0]?.transferBytes).toBe(321);
    const plain = await firstResult(OPTIONS, fakeBackend(() => ({ response: new Response(body.slice()) })).io);
    expect(plain.zooms[0]?.tiles[0]?.transferBytes).toBe(body.length);
  });

  it('超时算超标、不重试；上一级的请求不受影响', async () => {
    const { io, requests, slept } = fakeBackend(zoom =>
      zoom === 9 ? { error: new DOMException('timed out', 'TimeoutError') } : {}
    );
    const result = await firstResult(OPTIONS, io);
    expect(result.suggested).toBe(10);
    expect(result.zooms[1]?.reason).toContain('超过 120 秒');
    expect(requests.filter(path => path.endsWith('/9'))).toHaveLength(1);
    expect(slept).toStrictEqual([]);
  });

  it('5xx 不重试，等待不算进耗时；只有一张失败时照常往下查', async () => {
    let count = 0;
    const { io, slept, requests } = fakeBackend(() => {
      count += 1;
      return count === 1 ? { response: new Response('', { status: 500 }) } : {};
    });
    const result = await firstResult(OPTIONS, io);
    expect(slept).toStrictEqual([]);
    expect(result.zooms[0]?.errors[0]).toContain('HTTP 500');
    expect(result.zooms[0]?.verdict).toBe('ok');
    expect(zoomsOf(requests)).toStrictEqual([10, 9, 8, 7]);
    expect(result.suggested).toBe('none');
  });

  it('全部是空瓦片时判断不了，不能当成可以不限制', async () => {
    const { io } = fakeBackend(() => ({ features: 0 }));
    expect((await firstResult(OPTIONS, io)).suggested).toBe('unknown');
  });

  it('一开始就全部失败时判断不了；查到过要素后全部失败，建议上一级', async () => {
    const none = await firstResult(OPTIONS, fakeBackend(() => ({ response: failingResponse() })).io);
    expect(none.suggested).toBe('unknown');
    expect(none.zooms).toHaveLength(1);
    expect(none.zooms[0]?.errors[0]).toContain('系统异常');
    const partial = await firstResult(OPTIONS, fakeBackend(zoom => (zoom === 8 ? { response: failingResponse() } : {})).io);
    expect(partial.suggested).toBe(9);
    expect(partial.zooms.at(-1)?.verdict).toBe('failed');
  });

  it('地类图斑超标也不停，建议里写出数字，但不进配置', async () => {
    const { io, requests } = fakeBackend(zoom => ({ size: zoom <= 8 ? 5000 : 100 }));
    const result = await firstResult({ ...OPTIONS, codes: new Set(['bgdc_dltb']) }, io);
    expect(zoomsOf(requests)).toStrictEqual([10, 9, 8, 7]);
    expect(requests.filter(path => path.endsWith('/8'))).toHaveLength(2);
    expect(result).toMatchObject({ exempt: true, suggested: 9 });
    expect(minZoomConfig([result])).toStrictEqual({});
  });

  it('现在的值取自代码；带 token；每测完一个瓦片集存一次', async () => {
    const { io, tokens, saved } = fakeBackend(() => ({}));
    const options = { ...OPTIONS, codes: new Set(['csxhjctb_lrdl', 'lcsh_sltb']) };
    const results = await runTileCost(options, io);
    expect(results.find(({ code }) => code === 'csxhjctb_lrdl')?.current).toBe(9);
    expect(results.find(({ code }) => code === 'lcsh_sltb')?.current).toBeNull();
    expect(new Set(tokens)).toStrictEqual(new Set(['secret-token']));
    expect(saved.map(list => list.length)).toStrictEqual([1, 2]);
  });

  it('已有结果的瓦片集不再请求；--refresh 时重测', async () => {
    const previous = await firstResult(OPTIONS, fakeBackend(() => ({})).io);
    const resumed = fakeBackend(() => ({}), [previous]);
    expect(await runTileCost(OPTIONS, resumed.io)).toStrictEqual([previous]);
    expect(resumed.requests).toStrictEqual([]);
    const refreshed = fakeBackend(() => ({}), [previous]);
    await runTileCost({ ...OPTIONS, refresh: true }, refreshed.io);
    expect(refreshed.requests.length).toBeGreaterThan(0);
  });

  it('全部年份时每年一条结果', async () => {
    const { io, requests } = fakeBackend(() => ({}));
    const results = await runTileCost({ ...OPTIONS, years: 'all' }, io);
    expect(results.map(({ tileset }) => tileset)).toStrictEqual(['lcsh_sltb_2023', 'lcsh_sltb_2024']);
    expect(requests.some(path => path.startsWith('lcsh_sltb_2023/'))).toBe(true);
  });

  it('token 失效时整个实测停下来', async () => {
    const { io } = fakeBackend(() => ({ response: new Response('', { status: 401 }) }));
    await expect(runTileCost(OPTIONS, io)).rejects.toBeInstanceOf(ProbeAuthError);
  });

  it('资源树里没有这个资源时报错，不发瓦片请求', async () => {
    const { io, requests } = fakeBackend(() => ({}));
    await expect(runTileCost({ ...OPTIONS, codes: new Set(['nope']) }, io)).rejects.toThrow('资源树里没有 nope');
    expect(requests).toStrictEqual([]);
  });
});

const zoomCost = (zoom: number, verdict: ZoomCost['verdict'], features = 1): ZoomCost => ({
  zoom,
  requested: 1,
  tiles: [{ x: 1, y: 2, bytes: 10, transferBytes: 10, firstByteMs: 1, totalMs: 1, features }],
  errors: [],
  verdict,
  reason: verdict === 'heavy' ? '1/2 有 3.0 MB' : null
});

describe('建议的级别', () => {
  it('取最高的一个超标级别的上一级：中间夹着不超标的级别也一样', () => {
    expect(suggestMinZoom([zoomCost(10, 'ok'), zoomCost(9, 'heavy'), zoomCost(8, 'ok'), zoomCost(7, 'heavy')])).toBe(10);
  });

  it('失败比超标的级别高时按失败', () => {
    expect(suggestMinZoom([zoomCost(10, 'ok'), zoomCost(9, 'failed'), zoomCost(8, 'heavy')])).toBe(10);
  });

  it('最高的级别就超标时，建议比查过的都高', () => {
    expect(suggestMinZoom([zoomCost(12, 'heavy')])).toBe(13);
  });
});

function resultOf(partial: Partial<TileCostResult> & Pick<TileCostResult, 'code' | 'suggested'>): TileCostResult {
  return {
    year: 2025,
    tileset: `${partial.code}_2025`,
    name: partial.code,
    current: null,
    exempt: false,
    headers: {},
    zooms: [zoomCost(12, 'ok'), zoomCost(11, 'heavy')],
    ...partial
  };
}

describe('配置和报告', () => {
  it('配置只写要限制的资源：多个年份取最严的，判断不了的保留现在的值，按 code 排序', () => {
    const config = minZoomConfig([
      resultOf({ code: 'z_two_years', suggested: 10, year: 2024 }),
      resultOf({ code: 'z_two_years', suggested: 8 }),
      resultOf({ code: 'a_unknown', suggested: 'unknown', current: 9 }),
      resultOf({ code: 'b_unknown_free', suggested: 'unknown' }),
      resultOf({ code: 'c_none', suggested: 'none', current: 9 })
    ]);
    expect(config).toStrictEqual({ a_unknown: 9, z_two_years: 10 });
    expect(Object.keys(config)).toStrictEqual(['a_unknown', 'z_two_years']);
  });

  it('第一次请求很慢的资源，实测建议放开也保留现在的级别；建议更严时用更严的（ADR 0136）', () => {
    expect(minZoomConfig([resultOf({ code: 'bgdc_lmfw', suggested: 'none', current: 8 })])).toStrictEqual({ bgdc_lmfw: 8 });
    expect(minZoomConfig([resultOf({ code: 'bgdc_cjdcq', suggested: 6, current: 8 })])).toStrictEqual({ bgdc_cjdcq: 8 });
    expect(minZoomConfig([resultOf({ code: 'bgdc_cjdcqjx', suggested: 10, current: 8 })])).toStrictEqual({ bgdc_cjdcqjx: 10 });
    const report = formatTileCost([resultOf({ code: 'bgdc_lmfw', suggested: 'none', current: 8 })], LIMITS);
    expect(report).toContain('| bgdc_lmfw | bgdc_lmfw_2025 | 8 级 | 不限制 | 例外，第一次请求很慢，保留（ADR 0136） |');
  });

  it('判断不了的年份：别的年份测到了就以测到的为准，不保留现在的值；顺序不影响结果', () => {
    const emptyLatest = resultOf({ code: 'empty_latest', suggested: 'unknown', current: 10, year: 2026 });
    const measured = resultOf({ code: 'empty_latest', suggested: 'none', current: 10, year: 2025 });
    expect(minZoomConfig([emptyLatest, measured])).toStrictEqual({});
    expect(minZoomConfig([measured, emptyLatest])).toStrictEqual({});
    const limited = resultOf({ code: 'empty_latest', suggested: 8, current: 10, year: 2025 });
    expect(minZoomConfig([emptyLatest, limited])).toStrictEqual({ empty_latest: 8 });
  });

  it('列出复测后才通过的瓦片；没有时写明', () => {
    const retried: ZoomCost = {
      ...zoomCost(7, 'ok'),
      tiles: [{ x: 106, y: 51, bytes: 2 * 1024 * 1024, transferBytes: 10, firstByteMs: 1, totalMs: 110, features: 1, firstTryMs: 2050 }]
    };
    const report = formatTileCost([resultOf({ code: 'a', suggested: 'none', zooms: [retried] })], LIMITS);
    expect(report).toContain('## 复测后没有超标的瓦片（1 张）');
    expect(report).toContain('| a_2025 | 7 | 106/51 | 2.0 MB | 2.0 s | 110 ms |');
    expect(formatTileCost([resultOf({ code: 'a', suggested: 'none' })], LIMITS)).toContain('## 复测后没有超标的瓦片（0 张）');
  });

  it('要确认的排在最前，写明变化和依据', () => {
    const report = formatTileCost(
      [
        resultOf({ code: 'same', suggested: 9, current: 9 }),
        resultOf({ code: 'tighter', suggested: 10, current: 9 }),
        resultOf({ code: 'looser', suggested: 8, current: 9 }),
        resultOf({ code: 'added', suggested: 9 }),
        resultOf({ code: 'removed', suggested: 'none', current: 9, zooms: [zoomCost(6, 'ok')] }),
        resultOf({ code: 'unknown', suggested: 'unknown', current: 9, zooms: [zoomCost(6, 'empty', 0)] }),
        resultOf({ code: 'exempted', suggested: 9, exempt: true })
      ],
      { maxBytes: 2 * 1024 * 1024, maxMs: 2000 }
    );
    expect(report).toContain('单张解压后不超过 2.0 MB，整张收完不超过 2.0 s');
    expect(report).toContain('## 要确认的（6 个）');
    expect(report).toContain('## 不变（1 个）');
    expect(report.indexOf('| tighter |')).toBeLessThan(report.indexOf('## 不变'));
    expect(report.indexOf('| same |')).toBeGreaterThan(report.indexOf('## 不变'));
    expect(report).toContain('| tighter | tighter_2025 | 9 级 | 10 级 | 收紧 | 11 级：1/2 有 3.0 MB |');
    expect(report).toContain('| looser | looser_2025 | 9 级 | 8 级 | 放宽 |');
    expect(report).toContain('| added | added_2025 | 不限制 | 9 级 | 新增限制 |');
    expect(report).toContain('| removed | removed_2025 | 9 级 | 不限制 | 去掉限制 | 查到 6 级都没有超标 |');
    expect(report).toContain('| unknown | unknown_2025 | 9 级 | 判断不了 | 保留现在的值 | 查过的瓦片都没有要素 |');
    expect(report).toContain('| exempted | exempted_2025 | 不限制 | 9 级 | 例外，按 ADR 0041 不限制 |');
  });

  it('按瓦片集列出逐级别的数字和响应头的取值', () => {
    const report = formatTileCost(
      [resultOf({ code: 'a', suggested: 'none', headers: { 'content-encoding': 'gzip' } }), resultOf({ code: 'b', suggested: 'none' })],
      LIMITS
    );
    expect(report).toContain('### a_2025（a）');
    expect(report).toContain('| 11 | 1/1 | 1 | 0 KB | 0 KB | 0 KB | 1 ms | 1 ms | 1 | 超标：1/2 有 3.0 MB | 0 |');
    expect(report).toContain('| content-encoding | gzip | 1 |');
    expect(report).toContain('| content-encoding | （没有） | 1 |');
  });
});
