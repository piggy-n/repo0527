// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SERVER_BASEMAP_PROBE_TIMEOUT, type ServerBasemapId } from '../../config/server-basemap-options';
import {
  probeServerBasemaps,
  type ServerBasemapFailure,
  type ServerBasemapProbeOptions,
  serverBasemapRoot,
  tileDataUrl
} from './server-basemap-probe';

// 第一代紧凑缓存里南京那块 10 级瓦片（849, 415）：L10/R0180C0300，按列存的槽号 128 × 81 + 31。
// 文件格式在这里按 ADR 0165 第 3 节另写一遍，不用读取器的代码
const BUNDLE = '_alllayers/L10/R0180C0300';
const SLOT = 128 * 81 + 31;
const DATA_START = 60 + 128 * 128 * 4;
const INDEX_BYTES = 16 + 128 * 128 * 5 + 16;

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 5, 6, 7, 8]);
const HTML = new TextEncoder().encode('<!doctype html><html><body>index</body></html>');

const root = (prefix: string) => `http://intranet.test/basemap/${prefix}/`;

// 只有这一块瓦片的 .bundlx 和 .bundle；没有瓦片时槽是占位的偏移
function cache(tile: Uint8Array | null) {
  const index = new Uint8Array(INDEX_BYTES);
  index.set([0x03, 0, 0, 0, 0x10, 0, 0, 0, 0, 0x40, 0, 0, 0x05, 0, 0, 0]);
  let offset = tile ? DATA_START : 60 + 4 * SLOT;
  for (let byte = 0; byte < 5; byte++) {
    index[16 + SLOT * 5 + byte] = offset % 256;
    offset = Math.floor(offset / 256);
  }
  const data = new Uint8Array(DATA_START + 4 + (tile?.length ?? 0));
  if (tile) {
    new DataView(data.buffer).setUint32(DATA_START, tile.length, true);
    data.set(tile, DATA_START + 4);
  }
  return { index, data };
}

type Answer = (init: RequestInit) => Promise<Response> | Response;

// 一直不回答，直到请求被中止
const hanging: Answer = init =>
  new Promise((_, reject) => {
    init.signal?.addEventListener('abort', () => reject(new DOMException('请求中止', 'AbortError')));
  });

// 一个静态文件服务器：整份 GET 回 200，Range 回 206，没有的文件 404；函数是自定义的回答
function staticServer(files: Readonly<Record<string, Uint8Array | Answer>>) {
  const requests: string[] = [];
  const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>((url, init) => {
    requests.push(url);
    const file = files[url];
    if (typeof file === 'function') {
      return Promise.resolve(file(init));
    }
    if (!file) {
      return Promise.resolve(new Response('not found', { status: 404 }));
    }
    const range = new Headers(init.headers).get('Range');
    const match = range ? /^bytes=(\d+)-(\d+)$/.exec(range) : null;
    if (!match) {
      return Promise.resolve(new Response(file.slice(), { status: 200 }));
    }
    const start = Number(match[1]);
    const end = Math.min(Number(match[2]), file.length - 1);
    return Promise.resolve(
      new Response(file.slice(start, end + 1), {
        status: 206,
        headers: { 'Content-Range': `bytes ${start}-${end}/${file.length}` }
      })
    );
  });
  return { fetch, requests };
}

// 一套底图在服务器上的两个文件
function served(id: ServerBasemapId, tile: Uint8Array | null) {
  const { index, data } = cache(tile);
  return { [`${root(id)}${BUNDLE}.bundlx`]: index, [`${root(id)}${BUNDLE}.bundle`]: data };
}

function probe(files: Readonly<Record<string, Uint8Array | Answer>>, options: ServerBasemapProbeOptions = {}) {
  const server = staticServer(files);
  const warn = vi.fn<(failures: readonly ServerBasemapFailure[]) => void>();
  const result = probeServerBasemaps({ fetch: server.fetch, root, warn, ...options });
  return { result, warn, ...server };
}

const ids = (basemaps: readonly { id: ServerBasemapId }[]) => basemaps.map(basemap => basemap.id);
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const decode = (text: string) => Uint8Array.from(atob(text), char => char.charCodeAt(0));

afterEach(() => {
  vi.useRealTimers();
});

describe('probeServerBasemaps', () => {
  it('读到图片的才算有，按标准、影像、黑色、极夜蓝的顺序；缩略图是读到的那块瓦片，类型按格式', async () => {
    const { result, warn, requests } = probe({
      ...served('night-blue', PNG),
      ...served('imagery', JPEG),
      ...served('standard', PNG),
      ...served('black', PNG)
    });

    const basemaps = await result;

    expect(ids(basemaps)).toStrictEqual(['standard', 'imagery', 'black', 'night-blue']);
    expect(basemaps[1]).toStrictEqual({
      id: 'imagery',
      root: root('imagery'),
      thumbnail: `data:image/jpeg;base64,${base64(JPEG)}`
    });
    expect(basemaps[0].thumbnail).toBe(`data:image/png;base64,${base64(PNG)}`);
    expect(warn).not.toHaveBeenCalled();
    // 读的是南京那块：先整份读索引，再按 Range 读这一块
    expect(requests.filter(url => url.startsWith(root('imagery')))).toStrictEqual([
      `${root('imagery')}${BUNDLE}.bundlx`,
      `${root('imagery')}${BUNDLE}.bundle`
    ]);
  });

  it('没配的前缀（404）、这块没有瓦片、回落成网页都算没有，不记警告', async () => {
    const { result, warn } = probe({
      ...served('imagery', PNG),
      ...served('standard', null),
      [`${root('black')}${BUNDLE}.bundlx`]: HTML,
      // 索引在，.bundle 却回落成网页（Range 被忽略）
      [`${root('night-blue')}${BUNDLE}.bundlx`]: cache(PNG).index,
      [`${root('night-blue')}${BUNDLE}.bundle`]: () => new Response(HTML, { status: 200 })
    });

    expect(ids(await result)).toStrictEqual(['imagery']);
    expect(warn).not.toHaveBeenCalled();
  });

  it('5xx 和网络错误算没有，合起来只记一条警告', async () => {
    const { result, warn } = probe({
      ...served('standard', PNG),
      [`${root('imagery')}${BUNDLE}.bundlx`]: () => new Response('bad gateway', { status: 502 }),
      [`${root('black')}${BUNDLE}.bundlx`]: () => Promise.reject(new TypeError('Failed to fetch'))
    });

    expect(ids(await result)).toStrictEqual(['standard']);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toMatchObject([
      { id: 'imagery', reason: 'HTTP 502' },
      { id: 'black', reason: '网络错误' }
    ]);
  });

  it('总共最多等 3 秒：挂住的那套算没有、记警告，别的照常', async () => {
    vi.useFakeTimers();
    const { result, warn } = probe({
      ...served('imagery', PNG),
      [`${root('standard')}${BUNDLE}.bundlx`]: hanging
    });
    let settled = false;
    void result.finally(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(SERVER_BASEMAP_PROBE_TIMEOUT - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);

    expect(ids(await result)).toStrictEqual(['imagery']);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toMatchObject([{ id: 'standard', reason: '超时' }]);
  });

  it('索引读到了、.bundle 的 Range 挂住时，同样在 3 秒时结束，记超时', async () => {
    vi.useFakeTimers();
    const { result, warn } = probe({
      ...served('imagery', PNG),
      // 读取器的索引超时这时已经清掉，只有探测自己的总计时能结束它
      [`${root('standard')}${BUNDLE}.bundlx`]: cache(PNG).index,
      [`${root('standard')}${BUNDLE}.bundle`]: hanging
    });
    let settled = false;
    void result.finally(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(SERVER_BASEMAP_PROBE_TIMEOUT - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    // 先看结束了没有：探测不结束时在这里失败，不等到用例超时
    expect(settled).toBe(true);

    expect(ids(await result)).toStrictEqual(['imagery']);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toMatchObject([{ id: 'standard', reason: '超时' }]);
  });

  it('不拒绝：fetch 同步抛错、警告的回调自己抛错，都只是没有', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = probeServerBasemaps({
      root,
      fetch: () => {
        throw new TypeError('坏掉的 fetch');
      },
      warn: () => {
        throw new Error('坏掉的警告');
      }
    });

    await expect(result).resolves.toStrictEqual([]);
    expect(consoleError).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });

  it('默认的警告写到控制台，一条', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const server = staticServer({
      [`${root('imagery')}${BUNDLE}.bundlx`]: () => new Response('error', { status: 500 })
    });

    await probeServerBasemaps({ fetch: server.fetch, root });

    expect(consoleWarn).toHaveBeenCalledOnce();
    expect(consoleWarn.mock.calls[0][0]).toContain('[basemap]');
    consoleWarn.mockRestore();
  });
});

describe('serverBasemapRoot', () => {
  it('按部署的 BASE_URL 得出 basemap/<前缀>/ 的绝对地址', () => {
    expect(serverBasemapRoot('imagery', '/', 'http://192.168.15.111:5173')).toBe(
      'http://192.168.15.111:5173/basemap/imagery/'
    );
    expect(serverBasemapRoot('night-blue', '/yzt/', 'https://example.test')).toBe(
      'https://example.test/yzt/basemap/night-blue/'
    );
  });
});

describe('tileDataUrl', () => {
  it('字节原样编码成 base64，长的瓦片分段也不出错', () => {
    const bytes = new Uint8Array(200_000).map((_, index) => (index * 7) % 256);
    bytes.set(PNG);

    const url = tileDataUrl({ data: bytes.buffer, type: 'image/png' });

    expect(url.startsWith('data:image/png;base64,')).toBe(true);
    expect(decode(url.slice('data:image/png;base64,'.length))).toStrictEqual(bytes);
  });
});
