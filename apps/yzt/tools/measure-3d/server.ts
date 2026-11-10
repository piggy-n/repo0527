import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// 测量用的静态服务：只读，地址和磁盘路径一一对应。禁止浏览器缓存：每遍都是冷启动，换出的瓦片也要重新请求

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.glb': 'model/gltf-binary'
};

export interface Mounts {
  /** 地址前缀 → 目录，按写的顺序匹配 */
  readonly files: Readonly<Record<string, string>>;
  /** 给了时 /3dt/ 转到这个地址（模型只在服务器上时，同应用的 YZT_3DT_PROXY） */
  readonly modelsProxy: string | null;
}

function respond(res: ServerResponse, status: number, text: string): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(text);
}

async function proxy(target: string, path: string, res: ServerResponse): Promise<void> {
  // 浏览器取消了请求（瓦片不要了）上游也不再下载：两种引擎都经常取消，不然连接一直占着，等上游超时断开时没人接这个错，工具就崩了
  const abort = new AbortController();
  res.once('close', () => abort.abort());
  const upstream = await fetch(new URL(path, target), { signal: abort.signal });
  res.statusCode = upstream.status;
  res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  if (upstream.body) {
    await pipeline(Readable.fromWeb(upstream.body), res);
  } else {
    res.end();
  }
}

function serveFile(path: string, res: ServerResponse): void {
  res.setHeader('Content-Type', TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream');
  res.setHeader('Content-Length', statSync(path).size);
  res.setHeader('Cache-Control', 'no-store');
  createReadStream(path)
    .on('error', () => res.destroy())
    .pipe(res);
}

function handle({ files, modelsProxy }: Mounts, req: IncomingMessage, res: ServerResponse): void {
  let path: string;
  try {
    path = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
  } catch {
    respond(res, 400, 'bad url');
    return;
  }
  if (modelsProxy && path.startsWith('/3dt/')) {
    proxy(modelsProxy, path, res).catch((error: unknown) => {
      // 已经开始发了就只能断开，断开也是告诉浏览器这个瓦片失败了
      if (res.headersSent) {
        res.destroy();
      } else {
        respond(res, 502, String(error));
      }
    });
    return;
  }
  const mount = Object.entries(files).find(([prefix]) => path.startsWith(prefix));
  if (!mount) {
    respond(res, 404, 'not found');
    return;
  }
  const [prefix, directory] = mount;
  const root = resolve(directory);
  const relative = path.slice(prefix.length) || 'index.html';
  const file = resolve(join(root, relative));
  // 不能走出映射的目录
  if (file !== root && !file.startsWith(root + sep)) {
    respond(res, 403, 'forbidden');
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) {
    respond(res, 404, 'not found');
    return;
  }
  serveFile(file, res);
}

export interface StaticServer {
  readonly url: string;
  close(): Promise<void>;
}

export function startServer(port: number, mounts: Mounts): Promise<StaticServer> {
  return new Promise((resolvePromise, reject) => {
    const server = createServer((req, res) => handle(mounts, req, res));
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolvePromise({
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise(done => {
            server.closeAllConnections();
            server.close(() => done());
          })
      });
    });
  });
}
