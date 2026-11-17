// @vitest-environment node
import { afterEach, describe, expect, it, type Mock, vi } from 'vitest';
import {
  COMPACT_INDEX_BYTES,
  type CompactFetch,
  type CompactTileReaderOptions,
  compactTileLocation,
  createCompactTileReader,
  parseCompactIndex,
  tileImageType
} from './arcgis-compact';
import {
  compactBundle,
  compactFetch,
  compactFiles,
  compactResponse,
  type FixtureBundle,
  jpegTile,
  PNG_BYTES
} from '../testing/compact-fixture';

const ROOT = 'http://cache.test/imagery/';
// 缩略图那块（ADR 0165 第 4 节）：z10 的 849/415 在 L10/R0180C0300 里，是第 81 列、第 31 行
const L10 = '_alllayers/L10/R0180C0300';
const RANGE_LIMIT = 256 * 1024;

afterEach(() => {
  vi.useRealTimers();
});

function serve(bundles: Readonly<Record<string, FixtureBundle>>, options: CompactTileReaderOptions = {}) {
  const fetch = vi.fn<CompactFetch>(compactFetch(compactFiles(ROOT, bundles)));
  return { fetch, reader: createCompactTileReader({ ...options, fetch }) };
}

// 发出的请求：相对缓存根目录的路径，带 Range 的加上范围
function requests(fetch: Mock<CompactFetch>): string[] {
  return fetch.mock.calls.map(([url, init]) => {
    const range = new Headers(init.headers).get('Range');
    const path = url.slice(ROOT.length);
    return range === null ? path : `${path} ${range}`;
  });
}

function bytesOf(data: ArrayBuffer): number[] {
  return [...new Uint8Array(data)];
}

describe('compactTileLocation', () => {
  it('级别写两位，行列取 128 的倍数写成至少 4 位的小写十六进制，槽按列存', () => {
    expect(compactTileLocation(10, 849, 415)).toEqual({ bundle: '_alllayers/L10/R0180C0300', slot: 10399 });
    expect(compactTileLocation(7, 105, 51)).toEqual({ bundle: '_alllayers/L07/R0000C0000', slot: 13491 });
    expect(compactTileLocation(12, 3399, 1662)).toEqual({ bundle: '_alllayers/L12/R0600C0d00', slot: 9214 });
  });

  it('行列超过 4 位十六进制时写 5 位', () => {
    expect(compactTileLocation(18, 0x1a5a3, 0x19512)).toEqual({ bundle: '_alllayers/L18/R19500C1a580', slot: 4498 });
  });

  it('瓦片号不合法时抛错', () => {
    expect(() => compactTileLocation(10, 1024, 0)).toThrow(RangeError);
    expect(() => compactTileLocation(10, -1, 0)).toThrow(RangeError);
    expect(() => compactTileLocation(10, 1.5, 0)).toThrow(RangeError);
    expect(() => compactTileLocation(-1, 0, 0)).toThrow(RangeError);
  });
});

describe('parseCompactIndex', () => {
  it('每条是 5 字节小端偏移，超过 32 位也读对', () => {
    const { index } = compactBundle([]);
    expect(index.length).toBe(COMPACT_INDEX_BYTES);
    index.set([0x9a, 0x78, 0x56, 0x34, 0x12], 16 + 5 * 5);
    const parsed = parseCompactIndex(index);
    expect(parsed.offsets[5]).toBe(0x123456789a);
    expect(parsed.offsets[6]).toBe(60 + 4 * 6);
    expect([...parsed.live]).toEqual([0x123456789a]);
  });

  it('有效偏移去重、升序', () => {
    const bundle = compactBundle([
      { column: 3, row: 0, data: jpegTile(1) },
      { column: 0, row: 1, data: jpegTile(2) }
    ]);
    // 两个槽指向同一条记录
    bundle.index.set(bundle.index.subarray(16 + 5 * 3 * 128, 16 + 5 * 3 * 128 + 5), 16 + 5 * 7);
    const { live } = parseCompactIndex(bundle.index);
    expect([...live]).toEqual([bundle.offsetOf(3, 0), bundle.offsetOf(0, 1)]);
  });

  it('长度或文件头不对时抛错', () => {
    const { index } = compactBundle([]);
    expect(() => parseCompactIndex(index.subarray(1))).toThrow(/81952/);
    expect(() => parseCompactIndex(new TextEncoder().encode('<!doctype html><html></html>'))).toThrow(/81952/);
    const wrongMagic = index.slice();
    wrongMagic[0] = 0x04;
    expect(() => parseCompactIndex(wrongMagic)).toThrow(/文件头/);
  });
});

describe('tileImageType', () => {
  it('按开头的字节认 JPEG 和 PNG', () => {
    expect(tileImageType(jpegTile(1))).toBe('image/jpeg');
    expect(tileImageType(PNG_BYTES)).toBe('image/png');
    expect(tileImageType(new TextEncoder().encode('GIF89a'))).toBeNull();
    expect(tileImageType(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });
});

describe('createCompactTileReader', () => {
  it('按列存的槽读出瓦片和它的格式', async () => {
    const { reader } = serve({
      [L10]: compactBundle([
        { column: 81, row: 31, data: jpegTile(1) },
        // 行列对调的位置：按行存读错槽时会读到它
        { column: 31, row: 81, data: jpegTile(2) },
        { column: 82, row: 31, data: PNG_BYTES }
      ])
    });
    const tile = await reader.read(ROOT, 10, 849, 415);
    expect(tile?.type).toBe('image/jpeg');
    expect(bytesOf(tile?.data ?? new ArrayBuffer(0))).toEqual([...jpegTile(1)]);
    const png = await reader.read(ROOT, 10, 850, 415);
    expect(png?.type).toBe('image/png');
    expect(bytesOf(png?.data ?? new ArrayBuffer(0))).toEqual([...PNG_BYTES]);
  });

  it('一块瓦片一个 Range：读到下一条有效记录之前，最后一条最多读 256 KiB；.bundle 不用浏览器缓存', async () => {
    const bundle = compactBundle([
      { column: 81, row: 31, data: jpegTile(1) },
      { column: 82, row: 31, data: jpegTile(2) }
    ]);
    const { fetch, reader } = serve({ [L10]: bundle });
    await reader.read(ROOT, 10, 849, 415);
    await reader.read(ROOT, 10, 850, 415);
    const first = bundle.offsetOf(81, 31);
    const second = bundle.offsetOf(82, 31);
    expect(requests(fetch)).toEqual([
      `${L10}.bundlx`,
      `${L10}.bundle bytes=${first}-${second - 1}`,
      `${L10}.bundle bytes=${second}-${second + RANGE_LIMIT - 1}`
    ]);
    expect(fetch.mock.calls.map(([, init]) => init.cache)).toEqual(['default', 'no-store', 'no-store']);
  });

  it('空槽返回 null，不请求 .bundle', async () => {
    const { fetch, reader } = serve({ [L10]: compactBundle([{ column: 81, row: 31, data: jpegTile(1) }]) });
    expect(await reader.read(ROOT, 10, 849, 416)).toBeNull();
    expect(await reader.read(ROOT, 10, 880, 400)).toBeNull();
    expect(requests(fetch)).toEqual([`${L10}.bundlx`]);
  });

  it('偏移写成 0 的空槽同样返回 null', async () => {
    const { fetch, reader } = serve({ [L10]: compactBundle([{ column: 81, row: 31, data: jpegTile(1) }], 'zero') });
    expect(await reader.read(ROOT, 10, 849, 416)).toBeNull();
    expect(requests(fetch)).toEqual([`${L10}.bundlx`]);
  });

  it('.bundlx 是 404 时整块没有，返回 null，之后不再请求', async () => {
    const { fetch, reader } = serve({});
    expect(await reader.read(ROOT, 10, 849, 415)).toBeNull();
    expect(await reader.read(ROOT, 10, 850, 416)).toBeNull();
    expect(requests(fetch)).toEqual([`${L10}.bundlx`]);
  });

  it('.bundlx 返回网页时报读取失败，不记下，下一块重新请求', async () => {
    const page = '<!doctype html><html></html>';
    const fetch = vi.fn<CompactFetch>(() =>
      Promise.resolve(new Response(page, { status: 200, headers: { 'Content-Type': 'text/html' } }))
    );
    const reader = createCompactTileReader({ fetch });
    await expect(reader.read(ROOT, 10, 849, 415)).rejects.toThrow(/R0180C0300\.bundlx/);
    await expect(reader.read(ROOT, 10, 849, 415)).rejects.toThrow(Error);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('.bundlx 是 500 时报读取失败', async () => {
    const fetch = vi.fn<CompactFetch>(() => Promise.resolve(new Response('', { status: 500 })));
    await expect(createCompactTileReader({ fetch }).read(ROOT, 10, 849, 415)).rejects.toThrow(/HTTP 500/);
  });

  it('Range 被忽略、返回 200 时报错，并立刻取消响应体，不重试', async () => {
    const files = compactFiles(ROOT, { [L10]: compactBundle([{ column: 81, row: 31, data: jpegTile(1) }]) });
    let cancelled = false;
    const fetch = vi.fn<CompactFetch>((url, init) => {
      if (url.endsWith('.bundle')) {
        const body = new ReadableStream<Uint8Array>({
          pull: controller => controller.enqueue(new Uint8Array(1024)),
          cancel: () => {
            cancelled = true;
          }
        });
        return Promise.resolve(new Response(body, { status: 200 }));
      }
      return Promise.resolve(compactResponse(files, url, init));
    });
    await expect(createCompactTileReader({ fetch }).read(ROOT, 10, 849, 415)).rejects.toThrow(/没有按 Range 返回/);
    expect(cancelled).toBe(true);
    expect(requests(fetch)).toEqual([`${L10}.bundlx`, expect.stringMatching(/\.bundle bytes=/)]);
  });

  it('Content-Range 的起点不对时报错', async () => {
    const files = compactFiles(ROOT, { [L10]: compactBundle([{ column: 81, row: 31, data: jpegTile(1) }]) });
    const fetch = vi.fn<CompactFetch>((url, init) =>
      Promise.resolve(
        url.endsWith('.bundle')
          ? new Response(new Uint8Array(100), { status: 206, headers: { 'Content-Range': 'bytes 0-99/200000' } })
          : compactResponse(files, url, init)
      )
    );
    await expect(createCompactTileReader({ fetch }).read(ROOT, 10, 849, 415)).rejects.toThrow(/Content-Range/);
  });

  it('记录比读到的长时补读缺的部分，补读同样不用浏览器缓存', async () => {
    const big = jpegTile(7, RANGE_LIMIT + 5000);
    const bundle = compactBundle([{ column: 81, row: 31, data: big }]);
    const { fetch, reader } = serve({ [L10]: bundle });
    const tile = await reader.read(ROOT, 10, 849, 415);
    expect(bytesOf(tile?.data ?? new ArrayBuffer(0))).toEqual([...big]);
    const offset = bundle.offsetOf(81, 31);
    expect(requests(fetch)).toEqual([
      `${L10}.bundlx`,
      `${L10}.bundle bytes=${offset}-${offset + RANGE_LIMIT - 1}`,
      `${L10}.bundle bytes=${offset + RANGE_LIMIT}-${offset + 4 + big.length - 1}`
    ]);
    expect(fetch.mock.calls.map(([, init]) => init.cache)).toEqual(['default', 'no-store', 'no-store']);
  });

  it('有效偏移处长度是 0：丢掉索引向服务器确认后重读一次，还是 0 就报错', async () => {
    const { fetch, reader } = serve({ [L10]: compactBundle([{ column: 81, row: 31, data: jpegTile(1), length: 0 }]) });
    await expect(reader.read(ROOT, 10, 849, 415)).rejects.toThrow(/长度是 0/);
    expect(requests(fetch).map(request => request.split(' ')[0])).toEqual([
      `${L10}.bundlx`,
      `${L10}.bundle`,
      `${L10}.bundlx`,
      `${L10}.bundle`
    ]);
    expect(fetch.mock.calls[2]?.[1].cache).toBe('no-cache');
  });

  it('文件被替换以后，重读索引读到新的', async () => {
    const old = compactFiles(ROOT, {
      [L10]: compactBundle([
        { column: 0, row: 0, data: jpegTile(3, 100) },
        { column: 81, row: 31, data: jpegTile(1) }
      ])
    });
    const replaced = compactFiles(ROOT, {
      [L10]: compactBundle([
        { column: 0, row: 0, data: jpegTile(9, 500) },
        { column: 81, row: 31, data: jpegTile(2) }
      ])
    });
    let files = old;
    const fetch = vi.fn<CompactFetch>((url, init) => {
      // 读完旧索引，服务器上的文件就换了：旧偏移落在新文件另一条记录的中间
      const response = compactResponse(files, url, init);
      files = replaced;
      return Promise.resolve(response);
    });
    const tile = await createCompactTileReader({ fetch }).read(ROOT, 10, 849, 415);
    expect(bytesOf(tile?.data ?? new ArrayBuffer(0))).toEqual([...jpegTile(2)]);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('文件被替换时同一块的几块瓦片共用一次重读，不丢掉别的瓦片刚换上的索引', async () => {
    const old = compactFiles(ROOT, {
      [L10]: compactBundle([
        { column: 0, row: 0, data: jpegTile(3, 100) },
        { column: 81, row: 31, data: jpegTile(1) },
        { column: 82, row: 31, data: jpegTile(2) }
      ])
    });
    const replaced = compactFiles(ROOT, {
      [L10]: compactBundle([
        { column: 0, row: 0, data: jpegTile(9, 500) },
        { column: 81, row: 31, data: jpegTile(5) },
        { column: 82, row: 31, data: jpegTile(6) }
      ])
    });
    let files = old;
    const fetch = vi.fn<CompactFetch>((url, init) => {
      // 两块共用的旧索引读完，文件就换了：两块的旧偏移都落在新文件第一条记录的中间
      const response = compactResponse(files, url, init);
      files = replaced;
      return Promise.resolve(response);
    });
    const reader = createCompactTileReader({ fetch });
    const tiles = await Promise.all([reader.read(ROOT, 10, 849, 415), reader.read(ROOT, 10, 850, 415)]);
    expect(tiles.map(tile => bytesOf(tile?.data ?? new ArrayBuffer(0)))).toEqual([[...jpegTile(5)], [...jpegTile(6)]]);
    const indexRequests = fetch.mock.calls.filter(([url]) => url.endsWith('.bundlx'));
    expect(indexRequests.map(([, init]) => init.cache)).toEqual(['default', 'no-cache']);
  });

  it('数据不是 JPEG 或 PNG 时重读一次后报错', async () => {
    const gif = new TextEncoder().encode('GIF89a-not-a-tile');
    const { fetch, reader } = serve({ [L10]: compactBundle([{ column: 81, row: 31, data: gif }]) });
    await expect(reader.read(ROOT, 10, 849, 415)).rejects.toThrow(/JPEG 或 PNG/);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('长度超出文件时报错', async () => {
    const { reader } = serve({ [L10]: compactBundle([{ column: 81, row: 31, data: jpegTile(1), length: 100_000 }]) });
    await expect(reader.read(ROOT, 10, 849, 415)).rejects.toThrow(/超出文件/);
  });

  it('索引在而 .bundle 是 404 时重读一次后报错', async () => {
    const files = compactFiles(ROOT, { [L10]: compactBundle([{ column: 81, row: 31, data: jpegTile(1) }]) });
    files.delete(`${ROOT}${L10}.bundle`);
    const fetch = vi.fn<CompactFetch>(compactFetch(files));
    await expect(createCompactTileReader({ fetch }).read(ROOT, 10, 849, 415)).rejects.toThrow(/HTTP 404/);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('几块瓦片共用一次索引请求，取消其中一块不影响共用的请求和别的瓦片', async () => {
    const files = compactFiles(ROOT, {
      [L10]: compactBundle([
        { column: 81, row: 31, data: jpegTile(1) },
        { column: 82, row: 31, data: jpegTile(2) }
      ])
    });
    let release: (() => void) | undefined;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const fetch = vi.fn<CompactFetch>(async (url, init) => {
      if (url.endsWith('.bundlx')) {
        await gate;
      }
      return compactResponse(files, url, init);
    });
    const reader = createCompactTileReader({ fetch });
    const first = new AbortController();
    const second = new AbortController();
    const reading = reader.read(ROOT, 10, 849, 415, first.signal);
    const other = reader.read(ROOT, 10, 850, 415, second.signal);
    first.abort();
    await expect(reading).rejects.toMatchObject({ name: 'AbortError' });
    release?.();
    const tile = await other;
    expect(bytesOf(tile?.data ?? new ArrayBuffer(0))).toEqual([...jpegTile(2)]);
    const indexRequests = fetch.mock.calls.filter(([url]) => url.endsWith('.bundlx'));
    expect(indexRequests).toHaveLength(1);
    expect(indexRequests[0]?.[1].signal?.aborted).toBe(false);
  });

  it('读索引超时时报错，失败的不记下，下一块重新请求', async () => {
    vi.useFakeTimers();
    const files = compactFiles(ROOT, { [L10]: compactBundle([{ column: 81, row: 31, data: jpegTile(1) }]) });
    let hang = true;
    const fetch = vi.fn<CompactFetch>((url, init) => {
      const { signal } = init;
      if (hang && signal) {
        // 服务器挂住：只有中止才结束，和 fetch 一样以中止的原因结束
        return new Promise<Response>((_, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason instanceof Error ? signal.reason : new Error()));
        });
      }
      return Promise.resolve(compactResponse(files, url, init));
    });
    const reader = createCompactTileReader({ fetch, indexTimeout: 1000 });
    const reading = reader.read(ROOT, 10, 849, 415);
    let settled = false;
    const outcome = reading
      .then(
        () => null,
        (error: unknown) => error
      )
      .finally(() => {
        settled = true;
      });
    await vi.advanceTimersByTimeAsync(999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toMatchObject({ name: 'TimeoutError' });
    hang = false;
    expect(await reader.read(ROOT, 10, 849, 415)).not.toBeNull();
    expect(fetch.mock.calls.filter(([url]) => url.endsWith('.bundlx'))).toHaveLength(2);
  });

  it('读索引时响应头到了、响应体挂住，同样按超时结束', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<CompactFetch>((_, init) => {
      const { signal } = init;
      // 和 fetch 的响应体一样：只有请求中止时才以中止的原因出错
      const body = new ReadableStream<Uint8Array>({
        start: controller => {
          signal?.addEventListener('abort', () => controller.error(signal.reason));
        }
      });
      return Promise.resolve(new Response(body, { status: 200 }));
    });
    const reading = createCompactTileReader({ fetch, indexTimeout: 1000 }).read(ROOT, 10, 849, 415);
    let settled = false;
    const outcome = reading
      .then(
        () => null,
        (error: unknown) => error
      )
      .finally(() => {
        settled = true;
      });
    await vi.advanceTimersByTimeAsync(999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    // 先看结束了没有：计时器在读响应体之前清掉时在这里失败，不等到用例超时
    expect(settled).toBe(true);
    expect(await outcome).toMatchObject({ name: 'TimeoutError' });
  });

  it('索引缓存有上限，按最近用过的保留', async () => {
    const { fetch, reader } = serve({}, { maxIndexes: 2 });
    const a = [10, 849, 415] as const;
    const b = [11, 1698, 830] as const;
    const c = [12, 3399, 1662] as const;
    for (const [z, x, y] of [a, b, a, c, a, b]) {
      // oxlint-disable-next-line no-await-in-loop -- 按顺序读：先后决定淘汰哪一个
      await reader.read(ROOT, z, x, y);
    }
    expect(requests(fetch)).toEqual([
      '_alllayers/L10/R0180C0300.bundlx',
      '_alllayers/L11/R0300C0680.bundlx',
      '_alllayers/L12/R0600C0d00.bundlx',
      '_alllayers/L11/R0300C0680.bundlx'
    ]);
  });

  it('signal 已经中止时不发请求，以它的原因结束', async () => {
    const { fetch, reader } = serve({ [L10]: compactBundle([{ column: 81, row: 31, data: jpegTile(1) }]) });
    const controller = new AbortController();
    const reason = new DOMException('换了视野', 'AbortError');
    controller.abort(reason);
    await expect(reader.read(ROOT, 10, 849, 415, controller.signal)).rejects.toBe(reason);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('读 .bundle 时中止，以 AbortError 结束', async () => {
    const files = compactFiles(ROOT, { [L10]: compactBundle([{ column: 81, row: 31, data: jpegTile(1) }]) });
    const fetch = vi.fn<CompactFetch>((url, init) => {
      const { signal } = init;
      if (url.endsWith('.bundle') && signal) {
        return new Promise<Response>((_, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason instanceof Error ? signal.reason : new Error()));
        });
      }
      return Promise.resolve(compactResponse(files, url, init));
    });
    const controller = new AbortController();
    const reading = createCompactTileReader({ fetch }).read(ROOT, 10, 849, 415, controller.signal);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    controller.abort();
    await expect(reading).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('缓存的地址不以 / 结尾时报错', async () => {
    const { reader } = serve({});
    await expect(reader.read('http://cache.test/imagery', 10, 849, 415)).rejects.toThrow(/以 \/ 结尾/);
  });
});
