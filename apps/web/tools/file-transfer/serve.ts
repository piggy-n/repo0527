import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'vite';

/** 固定接口只用于真实浏览器传输验证，不代理到后端 */
async function fixture(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.url === '/backend/transfer-test/upload') {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
    const contentType = request.headers['content-type'] ?? '';
    const incoming = new Request('http://localhost/upload', {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body: Buffer.concat(chunks)
    });
    // oxlint-disable-next-line typescript/no-deprecated -- 只解析本地测试的极小固定数据，不为测试服务引入生产级 multipart 服务端库
    const form = await incoming.formData();
    const fields = await Promise.all(Array.from(form, async ([key, value]) => ({
      key,
      name: typeof value === 'string' ? null : value.name,
      content: typeof value === 'string' ? value : await value.text()
    })));
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ code: 200, data: { fields, token: request.headers.token, contentType } }));
    return;
  }
  if (request.url === '/backend/transfer-test/binary') {
    const bytes = Buffer.from([0, 255, 128, 3, 9]);
    response.setHeader('Content-Type', 'application/octet-stream');
    response.setHeader('Content-Length', bytes.length);
    response.setHeader('Content-Disposition', "attachment; filename*=UTF-8''%E6%8A%A5%E5%91%8A.pdf");
    response.end(bytes);
    return;
  }
  if (request.url === '/backend/transfer-test/chunks') {
    response.setHeader('Content-Type', 'text/plain');
    response.flushHeaders();
    let count = 0;
    // 分块响应故意不声明总长度，用于检查未知总量和接收期间取消
    const timer = setInterval(() => {
      response.write('固定测试内容\n');
      count += 1;
      if (count === 20) {
        clearInterval(timer);
        response.end();
      }
    }, 25);
    response.on('close', () => clearInterval(timer));
    return;
  }
  response.statusCode = 404;
  response.end('没有注册的测试接口');
}

// test 模式关闭源码生成器；中间件先于代理安装，所有 /backend 请求只走固定接口
const server = await createServer({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  mode: 'test',
  server: { host: '127.0.0.1', port: 4186, strictPort: true, open: false },
  plugins: [{
    name: 'file-transfer-fixtures',
    configureServer(vite) {
      vite.middlewares.use((request, response, next) => {
        if (request.url === '/transfer-test') {
          response.setHeader('Content-Type', 'text/html;charset=utf-8');
          response.end('<!doctype html><html lang="zh"><title>文件传输测试</title><body>固定接口测试</body></html>');
        } else if (request.url?.startsWith('/backend/')) {
          void fixture(request, response).catch(() => {
            response.statusCode = 500;
            response.end('测试接口处理失败');
          });
        } else {
          next();
        }
      });
    }
  }]
});
await server.listen();

/** 仅关闭本脚本创建的服务，并清理兜底超时 */
async function close() {
  clearTimeout(timeout);
  await server.close();
}

const timeout = setTimeout(() => {
  void close();
}, 180_000);
process.once('SIGTERM', () => {
  void close();
});
process.once('SIGINT', () => {
  void close();
});
