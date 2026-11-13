import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// 测量用的静态服务：只读，地址和磁盘路径一一对应。禁止浏览器缓存：每遍都是冷启动，换出的瓦片也要重新请求。
// 支持 Range：泼溅库读 .sog 时先要 bytes=0-4095 再按段读，收到 200 会整个下载，更慢也更占内存（ADR 0149 第 3 节，同 nginx 的要求）

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
  /** 上游这么久没有动静就放弃（毫秒），默认 UPSTREAM_IDLE_MS */
  readonly upstreamIdleMs?: number;
}

// 上游这么久没有动静（没回响应头、或者正文停住）就放弃：整理瓦片集时要先下载所有外部索引，
// 一个卡住的请求会让整个模型永远加不进来（2026-11-12 z16 俯视 6 GB 那一遍）
export const UPSTREAM_IDLE_MS = 30000;

/** 上游没有动静：代理回 504，响应已经开始发了就断开 */
export class UpstreamTimeout extends Error {
  constructor(idleMs: number) {
    super(`上游 ${idleMs / 1000} 秒没有动静`);
    this.name = 'UpstreamTimeout';
  }
}

/** 经代理的请求里超时、失败（连不上、中途断开）的次数，累计 */
export interface ProxyStats {
  readonly timeouts: number;
  readonly failures: number;
}

function respond(res: ServerResponse, status: number, text: string): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(text);
}

export type ByteRange = { readonly start: number; readonly end: number } | 'unsatisfiable' | null;

/** 请求头 Range 的单段写法（a-b、a-、-n）；多段、写法不对时为 null，按整个文件回复 */
export function byteRange(header: string | undefined, size: number): ByteRange {
  const match = header === undefined ? null : /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === '' && match[2] === '')) {
    return null;
  }
  const [, first = '', last = ''] = match;
  // -n 是最后 n 个字节
  const start = first === '' ? Math.max(0, size - Number(last)) : Number(first);
  const end = first === '' || last === '' ? size - 1 : Math.min(Number(last), size - 1);
  return start >= size || start > end ? 'unsatisfiable' : { start, end };
}

// 浏览器取消了请求（瓦片不要了）：不算失败，正常结束
async function proxy(target: string, path: string, req: IncomingMessage, res: ServerResponse, idleMs: number): Promise<void> {
  // 浏览器取消了请求（瓦片不要了）上游也不再下载：引擎经常取消，不然连接一直占着，等上游超时断开时没人接这个错，工具就崩了
  const abort = new AbortController();
  res.once('close', () => abort.abort());
  // 上游先出的错：正文出错时这边还没中止。浏览器取消时这边先中止，正文才出错；上游中途断开时 pipeline 也会关掉浏览器那边，
  // 也会走到上面的中止，只看中止了没有就分不开这两种
  let upstreamFailed = false;
  // 每收到一点东西（响应头、正文的一块）就重新计时
  let timer: ReturnType<typeof setTimeout> | undefined;
  const touch = () => {
    clearTimeout(timer);
    timer = setTimeout(() => abort.abort(new UpstreamTimeout(idleMs)), idleMs);
  };
  touch();
  try {
    const { range } = req.headers;
    const upstream = await fetch(new URL(path, target), { signal: abort.signal, headers: range ? { range } : {} });
    touch();
    res.statusCode = upstream.status;
    res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    for (const name of ['content-range', 'accept-ranges']) {
      const value = upstream.headers.get(name);
      if (value) {
        res.setHeader(name, value);
      }
    }
    if (upstream.body) {
      const body = Readable.fromWeb(upstream.body);
      body.on('data', touch);
      // 在 pipeline 之前登记，先于它关掉浏览器那边
      body.once('error', () => {
        upstreamFailed ||= !abort.signal.aborted;
      });
      await pipeline(body, res);
    } else {
      res.end();
    }
  } catch (error) {
    // 超时时 fetch、正文抛的是中止的原因；抛出去让调用方按超时回复
    if (abort.signal.reason instanceof UpstreamTimeout) {
      throw abort.signal.reason;
    }
    if (abort.signal.aborted && !upstreamFailed) {
      return;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function serveFile(path: string, req: IncomingMessage, res: ServerResponse): void {
  const { size } = statSync(path);
  res.setHeader('Content-Type', TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Accept-Ranges', 'bytes');
  const range = byteRange(req.headers.range, size);
  if (range === 'unsatisfiable') {
    res.statusCode = 416;
    res.setHeader('Content-Range', `bytes */${size}`);
    res.end();
    return;
  }
  if (range) {
    res.statusCode = 206;
    res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
  }
  res.setHeader('Content-Length', range ? range.end - range.start + 1 : size);
  createReadStream(path, range ?? {})
    .on('error', () => res.destroy())
    .pipe(res);
}

function handle({ files, modelsProxy, upstreamIdleMs = UPSTREAM_IDLE_MS }: Mounts, stats: { timeouts: number; failures: number }, req: IncomingMessage, res: ServerResponse): void {
  let path: string;
  try {
    path = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
  } catch {
    respond(res, 400, 'bad url');
    return;
  }
  if (modelsProxy && path.startsWith('/3dt/')) {
    // 浏览器自己取消的 proxy 正常结束，不算失败；上游中途断开的算
    proxy(modelsProxy, path, req, res, upstreamIdleMs).catch((error: unknown) => {
      const timeout = error instanceof UpstreamTimeout;
      if (timeout) {
        stats.timeouts++;
      } else {
        stats.failures++;
      }
      // 已经开始发了就只能断开，断开也是告诉浏览器这个瓦片失败了
      if (res.headersSent || res.destroyed) {
        res.destroy();
      } else {
        respond(res, timeout ? 504 : 502, String(error));
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
  serveFile(file, req, res);
}

export interface StaticServer {
  readonly url: string;
  /** 经代理的请求累计超时、失败了几次：每一遍前后各读一次，差就是这一遍的 */
  proxyStats(): ProxyStats;
  close(): Promise<void>;
}

export function startServer(port: number, mounts: Mounts): Promise<StaticServer> {
  const stats = { timeouts: 0, failures: 0 };
  return new Promise((resolvePromise, reject) => {
    const server = createServer((req, res) => handle(mounts, stats, req, res));
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolvePromise({
        url: `http://127.0.0.1:${port}`,
        proxyStats: () => ({ ...stats }),
        close: () =>
          new Promise(done => {
            server.closeAllConnections();
            server.close(() => done());
          })
      });
    });
  });
}
