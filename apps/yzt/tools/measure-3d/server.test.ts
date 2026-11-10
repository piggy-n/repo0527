// @vitest-environment node
import { EventEmitter, once } from 'node:events';
import { createServer, get, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { startServer, type StaticServer } from './server.ts';

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

async function proxyTo(target: string): Promise<string> {
  // 端口 0：系统给一个空闲端口。url 里的端口是 0 时连不上，要读实际的
  const probe = createServer();
  await new Promise<void>(resolve => {
    probe.listen(0, '127.0.0.1', () => resolve());
  });
  const { port } = probe.address() as AddressInfo;
  await new Promise(resolve => {
    probe.close(resolve);
  });
  const proxy = await startServer(port, { files: {}, modelsProxy: target });
  proxies.push(proxy);
  return proxy.url;
}

describe('模型代理', () => {
  it('转发状态和类型，不让浏览器缓存', async () => {
    const target = await upstream((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'max-age=3600');
      res.end(JSON.stringify({ url: req.url }));
    });
    const response = await fetch(`${await proxyTo(target)}/3dt/JKQ2/tileset.json`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ url: '/3dt/JKQ2/tileset.json' });
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
