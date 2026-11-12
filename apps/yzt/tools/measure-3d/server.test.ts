// @vitest-environment node
import { EventEmitter, once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, get, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { byteRange, startServer, type StaticServer } from './server.ts';

// 上游没有反应时最多等这么久：要等的事正常都在几毫秒内发生，等不到是断言失败，不是用例超时
const WAIT_MS = 1500;

function race<T>(promise: Promise<T>, fallback: T): Promise<T> {
  return Promise.race([promise, new Promise<T>(resolve => setTimeout(() => resolve(fallback), WAIT_MS))]);
}

const servers: Server[] = [];
const proxies: StaticServer[] = [];

afterEach(async () => {
  await Promise.all(proxies.splice(0).map(proxy => proxy.close()));
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    server.close();
  }
});

function upstream(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<string> {
  return new Promise(resolve => {
    const server = createServer(handler);
    servers.push(server);
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`));
  });
}

async function freePort(): Promise<number> {
  // 端口 0：系统给一个空闲端口。url 里的端口是 0 时连不上，要读实际的
  const probe = createServer();
  await new Promise<void>(resolve => {
    probe.listen(0, '127.0.0.1', () => resolve());
  });
  const { port } = probe.address() as AddressInfo;
  await new Promise(resolve => {
    probe.close(resolve);
  });
  return port;
}

async function proxyTo(target: string): Promise<string> {
  const proxy = await startServer(await freePort(), { files: {}, modelsProxy: target });
  proxies.push(proxy);
  return proxy.url;
}

describe('模型代理', () => {
  it('转发状态和类型，不让浏览器缓存；中文的目录按编码后的地址转给上游', async () => {
    const target = await upstream((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'max-age=3600');
      res.end(JSON.stringify({ url: req.url }));
    });
    const path = `/3dt/wuxi/3dtiles/${encodeURIComponent('经开区')}/tileset.json`;
    const response = await fetch(`${await proxyTo(target)}${path}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ url: path });
  });

  it('上游的 404 原样转发', async () => {
    const target = await upstream((_req, res) => {
      res.statusCode = 404;
      res.end('no');
    });
    const response = await fetch(`${await proxyTo(target)}/3dt/none.json`);
    expect(response.status).toBe(404);
  });

  it('上游连不上：返回 502', async () => {
    const proxy = await proxyTo('http://127.0.0.1:9');
    const status = await fetch(`${proxy}/3dt/a.json`).then(
      response => response.status,
      () => null
    );
    expect(status).toBe(502);
  });

  it('浏览器取消请求（瓦片不要了）：上游也不再下载', async () => {
    const events = new EventEmitter();
    const closed = once(events, 'closed').then(() => true);
    const target = await upstream((_req, res) => {
      res.on('close', () => events.emit('closed'));
      // 一直发，不结束：只有下游取消才会断开
      res.write(Buffer.alloc(1024));
    });
    const proxy = await proxyTo(target);
    await new Promise<void>(resolve => {
      const request = get(`${proxy}/3dt/big.glb`, response => {
        response.once('data', () => {
          request.destroy();
          resolve();
        });
      });
      request.on('error', () => undefined);
    });
    expect(await race(closed, false)).toBe(true);
  });

  it('上游还没响应时浏览器取消：也不再等上游', async () => {
    const events = new EventEmitter();
    const closed = once(events, 'closed').then(() => true);
    const arrived = once(events, 'arrived');
    const target = await upstream((_req, res) => {
      // 不发响应头：代理还停在等上游这一步
      res.on('close', () => events.emit('closed'));
      events.emit('arrived');
    });
    const proxy = await proxyTo(target);
    const request = get(`${proxy}/3dt/slow.glb`);
    request.on('error', () => undefined);
    await arrived;
    request.destroy();
    expect(await race(closed, false)).toBe(true);
  });

  it('上游中途断开：这个请求断开，工具不崩，后面的请求照常', async () => {
    let count = 0;
    const target = await upstream((_req, res) => {
      count++;
      if (count === 1) {
        res.write(Buffer.alloc(1024), () => {
          res.destroy();
        });
      } else {
        res.end('ok');
      }
    });
    const proxy = await proxyTo(target);
    const ended = await race(
      new Promise<boolean>(resolve => {
        const request = get(`${proxy}/3dt/broken.glb`, response => {
          response.on('data', () => undefined);
          response.on('error', () => resolve(true));
          response.on('close', () => resolve(true));
        });
        request.on('error', () => resolve(true));
      }),
      false
    );
    expect(ended).toBe(true);
    const next = await fetch(`${proxy}/3dt/next.json`);
    expect(await next.text()).toBe('ok');
  });
});

describe('byteRange', () => {
  it.each([
    ['bytes=0-4095', 10000, { start: 0, end: 4095 }],
    ['bytes=9000-', 10000, { start: 9000, end: 9999 }],
    ['bytes=9000-20000', 10000, { start: 9000, end: 9999 }],
    ['bytes=-100', 10000, { start: 9900, end: 9999 }],
    ['bytes=10000-', 10000, 'unsatisfiable'],
    ['bytes=5-3', 10000, 'unsatisfiable'],
    ['bytes=0-1,5-9', 10000, null],
    ['items=0-1', 10000, null],
    ['bytes=-', 10000, null],
    [undefined, 10000, null]
  ] as const)('%s（%i 字节）', (header, size, expected) => {
    expect(byteRange(header, size)).toEqual(expected);
  });
});

describe('Range（泼溅库按段读 .sog，ADR 0149 第 3 节）', () => {
  const content = Buffer.from(Array.from({ length: 10000 }, (_, index) => index % 251));
  let directory = '';

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  async function serve(): Promise<string> {
    directory = mkdtempSync(join(tmpdir(), 'measure-3d-range-'));
    writeFileSync(join(directory, 'chunk.sog'), content);
    const server = await startServer(await freePort(), { files: { '/3dt/': directory }, modelsProxy: null });
    proxies.push(server);
    return server.url;
  }

  it('给了 Range 回 206 和这一段，和 curl -r 0-4095 一样', async () => {
    const response = await fetch(`${await serve()}/3dt/chunk.sog`, { headers: { range: 'bytes=0-4095' } });
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 0-4095/10000');
    expect(response.headers.get('content-length')).toBe('4096');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(content.subarray(0, 4096));
  });

  it('没给 Range 回整个文件，并说明支持 Range', async () => {
    const response = await fetch(`${await serve()}/3dt/chunk.sog`);
    expect(response.status).toBe(200);
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(content);
  });

  it('超出文件的 Range 回 416', async () => {
    const response = await fetch(`${await serve()}/3dt/chunk.sog`, { headers: { range: 'bytes=20000-' } });
    expect(response.status).toBe(416);
    expect(response.headers.get('content-range')).toBe('bytes */10000');
  });

  it('经代理时 Range 转给上游，206 和 Content-Range 原样转回', async () => {
    const target = await upstream((req, res) => {
      res.statusCode = 206;
      res.setHeader('Content-Range', `bytes 0-3/10 (${req.headers.range})`);
      res.end('abcd');
    });
    const response = await fetch(`${await proxyTo(target)}/3dt/chunk.sog`, { headers: { range: 'bytes=0-3' } });
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 0-3/10 (bytes=0-3)');
    expect(await response.text()).toBe('abcd');
  });
});
