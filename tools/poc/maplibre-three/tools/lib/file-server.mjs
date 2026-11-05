// 只读地提供本地文件：开发服务、测量用的静态服务共用。不写文件，不复制，地址和磁盘路径一一对应
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { listLccFiles } from './paths.mjs';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.geojson': 'application/json',
  '.lcc2': 'application/json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.pbf': 'application/x-protobuf',
  '.glb': 'model/gltf-binary',
  '.sog': 'application/zip'
};

function respond(res, status, text) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(text);
}

/** mounts 按写的顺序匹配前缀；noStore 为 true 时禁止浏览器缓存，换出的瓦片每次都重新请求 */
export function createFileHandler(mounts, { noStore = false } = {}) {
  const entries = Object.entries(mounts).map(([prefix, dir]) => [prefix, resolve(dir)]);
  return (req, res, next) => {
    let path;
    try {
      path = decodeURIComponent((req.url ?? '').split('?')[0]);
    } catch {
      respond(res, 400, 'bad url');
      return;
    }
    if (path === '/lcc2/__index.json') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(listLccFiles()));
      return;
    }
    const entry = entries.find(([prefix]) => path.startsWith(prefix));
    if (!entry) {
      next();
      return;
    }
    const [prefix, base] = entry;
    const relative = path.slice(prefix.length) || 'index.html';
    const file = resolve(join(base, relative.endsWith('/') ? `${relative}index.html` : relative));
    if (!file.startsWith(base + sep) || !existsSync(file) || !statSync(file).isFile()) {
      respond(res, 404, 'not found');
      return;
    }
    res.setHeader('Content-Type', TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream');
    res.setHeader('Content-Length', statSync(file).size);
    if (noStore) {
      res.setHeader('Cache-Control', 'no-store');
    }
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const stream = createReadStream(file);
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  };
}

/** 只绑定本机回环地址 */
export function startStaticServer(port, mounts) {
  const handle = createFileHandler(mounts, { noStore: true });
  const server = createServer((req, res) => handle(req, res, () => respond(res, 404, 'not found')));
  return new Promise((resolvePromise, reject) => {
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
