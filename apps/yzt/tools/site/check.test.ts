// @vitest-environment node
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type CheckOptions,
  diffModels,
  entriesOf,
  identify,
  manifestUrl,
  rangeProblems,
  reason,
  runCheck,
  secondRange,
  totalBytes
} from './check.ts';
import { parseCatalog } from './compose.ts';
import { SiteError } from './errors.ts';
import type { Site } from './sites.ts';

const SPLAT = (id: string) => ({
  id,
  kind: 'splat',
  lcc2: `xuzhou/lcc2/${id}/lcc2-sog-result/${id}.lcc2`,
  placement: { lng: 117, lat: 34, height: 50, heading: 0 }
});
const CATALOG = {
  models: [
    { id: 'a', kind: 'oblique', tileset: 'suzhou/3dtiles/%E7%94%B2/tileset.json' },
    {
      id: 'w',
      kind: 'white',
      effects: [
        { id: 'plain', label: '无纹理', tileset: 'suzhou/3dtiles/w/plain/tileset.json' },
        { id: 'tech', label: '效果1', tileset: 'suzhou/3dtiles/w/tech/tileset.json' }
      ]
    },
    SPLAT('s'),
    SPLAT('t')
  ]
};
const CATALOG_TEXT = JSON.stringify(CATALOG);
const FULL: Site = { label: '齐全', missing: [] };
const NO_SPLAT: Site = { label: '没有泼溅', missing: [{ id: 's', reason: '没拷' }, { id: 't', reason: '没拷' }] };
const SITES = { full: FULL, 'no-splat': NO_SPLAT };

// 5 MB 的数据块：第二段 Range 从 2 MB 开始
const BLOCK_SIZE = 5 * 1024 * 1024;

interface FileReply {
  readonly status?: number;
  readonly type?: string;
  readonly body?: string;
}

interface Fake {
  readonly files: Map<string, FileReply>;
  /** 数据块的响应：默认 nginx 的样子（206、ETag 固定） */
  block: { status?: number; range: boolean; etag: () => string; encoding?: string };
}

let server: Server | undefined;

async function serve(fake: Fake): Promise<string> {
  const created = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname);
    if (path.endsWith('/data/3dgs/0_0.sog')) {
      const { status, range, etag, encoding } = fake.block;
      const match = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range ?? '');
      const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream', ETag: etag() };
      if (encoding) {
        headers['Content-Encoding'] = encoding;
      }
      if (status !== undefined) {
        response.writeHead(status, headers);
        response.end();
      } else if (range && match) {
        const [start, end] = [Number(match[1]), Number(match[2])];
        response.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${BLOCK_SIZE}` });
        response.end(Buffer.alloc(end - start + 1));
      } else {
        response.writeHead(200, { ...headers, 'Content-Length': String(BLOCK_SIZE) });
        response.end(Buffer.alloc(BLOCK_SIZE));
      }
      return;
    }
    const file = fake.files.get(path);
    if (file === undefined) {
      response.writeHead(404, { 'Content-Type': 'text/html' });
      response.end('<html>404</html>');
      return;
    }
    response.writeHead(file.status ?? 200, { 'Content-Type': file.type ?? 'application/json' });
    response.end(file.body ?? '{}');
  });
  server = created;
  await new Promise<void>(resolve => {
    created.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${(created.address() as AddressInfo).port}`;
}

// 服务器上部署了 manifest，每个入口都在
function fakeServer(manifest: unknown): Fake {
  const index = JSON.stringify({ root: { splatFiles: ['data/3dgs/0_0.sog'] } });
  const files = new Map<string, FileReply>([
    ['/3dt/manifest.json', { body: JSON.stringify(manifest) }],
    ['/3dt/suzhou/3dtiles/甲/tileset.json', {}],
    ['/3dt/suzhou/3dtiles/w/plain/tileset.json', {}],
    ['/3dt/suzhou/3dtiles/w/tech/tileset.json', {}],
    ['/3dt/xuzhou/lcc2/s/lcc2-sog-result/s.lcc2', { body: index }],
    ['/3dt/xuzhou/lcc2/t/lcc2-sog-result/t.lcc2', { body: index }]
  ]);
  return { files, block: { range: true, etag: () => '"6afbaf27-500000"' } };
}

async function check(origin: string, overrides: Partial<CheckOptions> = {}) {
  const lines: string[] = [];
  const passed = await runCheck({
    siteName: 'full',
    site: FULL,
    sites: SITES,
    catalogText: CATALOG_TEXT,
    origin,
    suggest: false,
    timeout: 5000,
    log: line => lines.push(line),
    ...overrides
  });
  return { passed, text: lines.join('\n') };
}

afterEach(() => {
  server?.closeAllConnections();
  server?.close();
  server = undefined;
});

describe('entriesOf', () => {
  it('瓦片集一个入口，白膜每种效果一个，泼溅是 .lcc2 索引', () => {
    const [a, w, s] = parseCatalog(CATALOG_TEXT);
    expect(entriesOf(a)).toEqual([{ label: 'a', path: 'suzhou/3dtiles/%E7%94%B2/tileset.json', lcc2: false }]);
    expect(entriesOf(w).map(entry => entry.label)).toEqual(['w/plain', 'w/tech']);
    expect(entriesOf(s)).toEqual([{ label: 's', path: 'xuzhou/lcc2/s/lcc2-sog-result/s.lcc2', lcc2: true }]);
  });
});

describe('manifestUrl', () => {
  it('清单在前端地址下的 3dt/manifest.json，前端可以部署在子路径下', () => {
    expect(manifestUrl('http://192.168.15.111:5173').href).toBe('http://192.168.15.111:5173/3dt/manifest.json');
    expect(manifestUrl('http://host/yzt/').href).toBe('http://host/yzt/3dt/manifest.json');
    expect(manifestUrl('http://host/yzt').href).toBe('http://host/yzt/3dt/manifest.json');
  });
});

describe('diffModels、identify', () => {
  const catalog = parseCatalog(CATALOG_TEXT);

  it('说出多了、少了的模型和不同的字段', () => {
    const deployed = parseCatalog(JSON.stringify({ models: [{ ...CATALOG.models[0], tileset: 'old/tileset.json' }, { id: 'z' }] }));
    expect(diffModels(deployed, catalog)).toEqual({
      onlyOnServer: ['z'],
      onlyExpected: ['w', 's', 't'],
      changed: [{ id: 'a', keys: ['tileset'] }]
    });
  });

  it('认出服务器上的清单是哪一份，字段的先后不算', () => {
    const reordered = parseCatalog(JSON.stringify({ models: CATALOG.models.map(model => Object.fromEntries(Object.entries(model).toReversed())) }));
    const candidates = [
      { name: '全集', models: catalog },
      { name: '站点 no-splat', models: catalog.slice(0, 2) }
    ];
    expect(identify(reordered, candidates)).toEqual(['全集']);
    expect(identify(catalog.slice(0, 2), candidates)).toEqual(['站点 no-splat']);
    expect(identify(catalog.slice(0, 1), candidates)).toEqual([]);
  });
});

describe('Range 的核对', () => {
  const reply = { status: 206, contentRange: 'bytes 0-4095/4297496', contentEncoding: null, etag: '"a"' };

  it('总字节数取自 Content-Range；第二段落在另一个 1 MB 分片里，文件小时取中间，太小不取', () => {
    expect(totalBytes('bytes 0-4095/4297496')).toBe(4297496);
    expect(totalBytes(null)).toBeNull();
    expect(secondRange(4297496)).toBe('bytes=2097152-2101247');
    expect(secondRange(1572864)).toBe('bytes=1048576-1052671');
    expect(secondRange(100000)).toBe('bytes=50000-54095');
    expect(secondRange(8000)).toBeNull();
  });

  it('206、有 Content-Range、不压缩、ETag 相同才算通过', () => {
    expect(rangeProblems(reply, { ...reply, contentRange: 'bytes 2097152-2101247/4297496' })).toEqual([]);
    expect(rangeProblems({ ...reply, status: 200, contentRange: null }, null)).toEqual(['第一段返回 200，不是 206：库会把整个文件下载下来']);
    expect(rangeProblems({ ...reply, status: 404, contentRange: null }, null)).toEqual(['第一段返回 404：取不到数据块，这个模型加载失败']);
    expect(rangeProblems({ ...reply, contentRange: null }, null)).toEqual(['第一段没有 Content-Range']);
    expect(rangeProblems({ ...reply, contentEncoding: 'gzip' }, null)).toEqual(['第一段压缩了（Content-Encoding: gzip）：库不用 Range']);
    expect(rangeProblems(reply, { ...reply, etag: '"b"' })).toEqual(['两段的 ETag 不同（"a"、"b"）：数据块会加载失败']);
    expect(rangeProblems({ ...reply, contentEncoding: 'identity' }, null)).toEqual([]);
  });
});

describe('reason', () => {
  it('取 fetch 放在 cause 里的原因；几个地址都连不上时逐个列出；没有说明时用错误码', () => {
    expect(reason(new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED 127.0.0.1:1') }))).toBe(
      'connect ECONNREFUSED 127.0.0.1:1'
    );
    const aggregate = new AggregateError([new Error('connect ETIMEDOUT ::1:80'), new Error('connect ETIMEDOUT 10.0.0.1:80')], '');
    expect(reason(new TypeError('fetch failed', { cause: aggregate }))).toBe('connect ETIMEDOUT ::1:80；connect ETIMEDOUT 10.0.0.1:80');
    const coded = Object.assign(new Error(''), { code: 'ECONNRESET' });
    expect(reason(new TypeError('fetch failed', { cause: coded }))).toBe('ECONNRESET');
    expect(reason('字符串')).toBe('字符串');
  });
});

describe('runCheck', () => {
  it('清单就是站点的组合、入口都在、每个 LCC2 的 Range 都合格时通过', async () => {
    const origin = await serve(fakeServer(CATALOG));
    const { passed, text } = await check(origin);
    expect(text).toContain('✓ 就是站点 full 的组合（4 个模型）');
    expect(text).toContain('✓ w/tech  suzhou/3dtiles/w/tech/tileset.json');
    expect(text).toContain('✓ s 的 data/3dgs/0_0.sog：206，bytes 0-4095/5242880、bytes 2097152-2101247/5242880，不压缩，两段的 ETag 相同');
    expect(text).toContain('✓ t 的 data/3dgs/0_0.sog：206');
    expect(text).toContain('检查通过');
    expect(passed).toBe(true);
  });

  it('部署的是全集而站点缺模型时不通过，说出它等于全集和多出的模型，写明缺的原因', async () => {
    const origin = await serve(fakeServer(CATALOG));
    const { passed, text } = await check(origin, { siteName: 'no-splat', site: NO_SPLAT });
    expect(text).toContain('应当发布全集 4 个中的 2 个，缺 s（没拷）、t（没拷）');
    expect(text).toContain('✗ 不是站点 no-splat 的组合：它等于全集');
    expect(text).toContain('服务器上多出：s、t');
    expect(passed).toBe(false);
  });

  it('旧版本的清单：不等于全集也不等于任何站点，列出不同的字段', async () => {
    const old = { models: [{ ...CATALOG.models[0], tileset: 'SZ_3DT/tileset.json' }, ...CATALOG.models.slice(1)] };
    const origin = await serve(fakeServer(old));
    const { passed, text } = await check(origin);
    expect(text).toContain('不等于全集，也不等于任何站点');
    expect(text).toContain('a 的 tileset 不同');
    expect(passed).toBe(false);
  });

  it('模型一样、只是先后不同时说明', async () => {
    const origin = await serve(fakeServer({ models: CATALOG.models.toReversed() }));
    const { passed, text } = await check(origin);
    expect(text).toContain('模型一样，先后不同');
    expect(passed).toBe(false);
  });

  it.each([
    ['404', { status: 404 }, '✗ HTTP 404'],
    ['回退成网页', { type: 'text/html', body: '<html></html>' }, '✗ 读不了']
  ])('部署的清单%s时不通过', async (_name, reply, expected) => {
    const fake = fakeServer(CATALOG);
    fake.files.set('/3dt/manifest.json', reply);
    const origin = await serve(fake);
    const { passed, text } = await check(origin);
    expect(text).toContain(expected);
    expect(passed).toBe(false);
  });

  it('入口 404、回退成网页时说服务器上没有，别的状态码说没法判断，都不通过', async () => {
    const fake = fakeServer(CATALOG);
    fake.files.delete('/3dt/suzhou/3dtiles/w/tech/tileset.json');
    fake.files.set('/3dt/suzhou/3dtiles/甲/tileset.json', { type: 'text/html', body: '<html></html>' });
    fake.files.set('/3dt/suzhou/3dtiles/w/plain/tileset.json', { status: 500 });
    const origin = await serve(fake);
    const { passed, text } = await check(origin);
    expect(text).toContain('✗ w/tech：HTTP 404  suzhou/3dtiles/w/tech/tileset.json');
    expect(text).toContain('✗ a：返回的是网页（nginx 回退成了 index.html）  suzhou/3dtiles/甲/tileset.json');
    expect(text).toContain('✗ w/plain：没法判断，HTTP 500');
    expect(passed).toBe(false);
  });

  it('数据块不支持 Range、返回 404、两次的 ETag 不同时不通过', async () => {
    const fake = fakeServer(CATALOG);
    fake.block = { range: false, etag: () => '"x"' };
    const origin = await serve(fake);
    expect((await check(origin)).text).toContain('第一段返回 200，不是 206');

    fake.block = { status: 404, range: true, etag: () => '"x"' };
    expect((await check(origin)).text).toContain('第一段返回 404：取不到数据块');

    let count = 0;
    fake.block = { range: true, etag: () => `"v${++count}"` };
    const { passed, text } = await check(origin);
    expect(text).toContain('两段的 ETag 不同');
    expect(passed).toBe(false);
  });

  it('--suggest：探测全集，打印缺的模型；站点已经写了缺的用"－"标出，不算没通过', async () => {
    const fake = fakeServer({ models: CATALOG.models.slice(0, 2) });
    fake.files.delete('/3dt/xuzhou/lcc2/s/lcc2-sog-result/s.lcc2');
    fake.files.delete('/3dt/xuzhou/lcc2/t/lcc2-sog-result/t.lcc2');
    const origin = await serve(fake);
    const { passed, text } = await check(origin, { siteName: 'no-splat', site: NO_SPLAT, suggest: true });
    expect(text).toContain('== 全集里每个模型的入口');
    expect(text).toContain('－ s：站点写了缺（HTTP 404）');
    expect(text).toContain('可以写进 tools/site/sites.json 的 missing，原因要改成真实的：[{"id":"s","reason":"没拷"},{"id":"t","reason":"没拷"}]');
    expect(text).not.toContain('站点写了缺、服务器上却都能取到');
    expect(passed).toBe(true);
  });

  it('--suggest：站点说有、服务器上却取不到的模型不通过，建议里原因要填', async () => {
    const fake = fakeServer(CATALOG);
    fake.files.delete('/3dt/xuzhou/lcc2/s/lcc2-sog-result/s.lcc2');
    const origin = await serve(fake);
    const { passed, text } = await check(origin, { suggest: true });
    expect(text).toContain('✗ s：HTTP 404');
    expect(text).toContain('missing，原因要改成真实的：[{"id":"s","reason":"原因"}]');
    expect(passed).toBe(false);
  });

  it('--suggest：站点写了缺、服务器上却能取到时提示从 missing 删掉', async () => {
    const origin = await serve(fakeServer({ models: CATALOG.models.slice(0, 2) }));
    const { text } = await check(origin, { siteName: 'no-splat', site: NO_SPLAT, suggest: true });
    expect(text).toContain('missing，原因要改成真实的：[]');
    expect(text).toContain('站点写了缺、服务器上却都能取到：s、t（数据补齐了的话从 missing 删掉）');
  });

  it('--suggest：全集都取不到时不给建议，提示先查 nginx', async () => {
    const fake = fakeServer(CATALOG);
    for (const path of [...fake.files.keys()].filter(key => key !== '/3dt/manifest.json')) {
      fake.files.delete(path);
    }
    const origin = await serve(fake);
    const { passed, text } = await check(origin, { suggest: true });
    expect(text).toContain('全集里的模型在这台服务器上都取不到：先检查 nginx 的 /3dt/ alias 和模型目录');
    expect(text).not.toContain('可以写进');
    expect(passed).toBe(false);
  });

  it('连不上服务器时抛出一行原因', async () => {
    const origin = await serve(fakeServer(CATALOG));
    server?.close();
    server = undefined;
    await expect(check(origin)).rejects.toThrow(SiteError);
    await expect(check(origin)).rejects.toThrow(`连不上 ${origin}`);
  });
});
