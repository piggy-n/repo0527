// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { localPath } from './paths.ts';
import { localFilesPlugin } from './vite-plugin.ts';

describe('localPath', () => {
  const repoRoot = resolve(import.meta.dirname, '../../../..');

  it('默认在仓库根目录的 local/ 下', () => {
    vi.stubEnv('YZT_LOCAL_DIR', '');
    expect(localPath('probe', 'x')).toBe(join(repoRoot, 'local', 'probe', 'x'));
  });

  it('YZT_LOCAL_DIR 可以指到别处，相对路径从仓库根目录算', () => {
    const elsewhere = resolve(tmpdir(), 'yzt-local');
    vi.stubEnv('YZT_LOCAL_DIR', elsewhere);
    expect(localPath('3dt')).toBe(join(elsewhere, '3dt'));
    vi.stubEnv('YZT_LOCAL_DIR', '../shared');
    expect(localPath('3dt')).toBe(resolve(repoRoot, '../shared/3dt'));
  });
});

describe('localFilesPlugin', () => {
  const plugin = localFilesPlugin({});

  it('只在开发服务器上生效，构建和测试都不生效', () => {
    const { apply } = plugin;
    if (typeof apply !== 'function') {
      throw new TypeError('apply 应该是函数');
    }
    expect(apply({}, { command: 'serve', mode: 'development' })).toBe(true);
    expect(apply({}, { command: 'serve', mode: 'intranet' })).toBe(true);
    expect(apply({}, { command: 'build', mode: 'production' })).toBe(false);
    expect(apply({}, { command: 'serve', mode: 'test' })).toBe(false);
  });

  describe('开发服务器', () => {
    let root: string;
    let server: ViteDevServer;
    let port: number;

    const write = (path: string, content: string) => {
      const file = join(root, path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content);
    };

    // fetch 会把路径里的 .. 规范化，穿越的用例要原样发出去，所以都用 http.request
    const get = (path: string) =>
      new Promise<{ status: number | undefined; type: string | undefined; body: string }>((done, fail) => {
        const req = request({ port, path, headers: { accept: 'text/html,*/*' } }, res => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () =>
            done({
              status: res.statusCode,
              type: res.headers['content-type'],
              body: Buffer.concat(chunks).toString('utf8')
            })
          );
        });
        req.on('error', fail);
        req.end();
      });

    beforeAll(async () => {
      root = mkdtempSync(join(tmpdir(), 'yzt-local-files-'));
      write('app/index.html', '<!doctype html><title>单页应用</title>');
      write('app/public/3dt/manifest.json', '{"from":"public"}');
      write('secret.txt', '不应该被读到');
      write('local/3dt/SZ_3DT/tileset.json', '{"from":"local"}');
      write('local/design/主题 一/index.html', '<!doctype html><title>原型</title><script src="./app.js"></script>');
      write('local/design/主题 一/app.js', 'import "/不存在的模块"; console.log("原样");');

      server = await createServer({
        configFile: false,
        root: join(root, 'app'),
        mode: 'development',
        logLevel: 'silent',
        server: { port: 0, host: '127.0.0.1' },
        optimizeDeps: { noDiscovery: true },
        plugins: [
          localFilesPlugin({ '/3dt': join(root, 'local/3dt'), '/design.local': join(root, 'local/design') })
        ]
      });
      await server.listen();
      const address = server.httpServer?.address() as AddressInfo | null | undefined;
      if (!address) {
        throw new Error('开发服务器没有监听端口');
      }
      port = address.port;
    });

    afterAll(async () => {
      await server.close();
      rmSync(root, { recursive: true, force: true });
    });

    it('模型文件从本地目录提供', async () => {
      const res = await get('/3dt/SZ_3DT/tileset.json');
      expect(res.status).toBe(200);
      expect(res.type).toContain('application/json');
      expect(res.body).toBe('{"from":"local"}');
    });

    it('清单继续从 public 提供', async () => {
      const res = await get('/3dt/manifest.json');
      expect(res.status).toBe(200);
      expect(res.body).toBe('{"from":"public"}');
    });

    it('原型的中文路径能打开，页面和脚本都不经过转换', async () => {
      const path = `/design.local/${encodeURIComponent('主题 一')}`;
      const page = await get(`${path}/index.html`);
      expect(page.type).toContain('text/html');
      expect(page.body).toBe('<!doctype html><title>原型</title><script src="./app.js"></script>');
      const script = await get(`${path}/app.js`);
      expect(script.body).toBe('import "/不存在的模块"; console.log("原样");');
    });

    it('目录地址打开目录里的 index.html，不回退到单页应用', async () => {
      const res = await get(`/design.local/${encodeURIComponent('主题 一')}/`);
      expect(res.body).toContain('<title>原型</title>');
    });

    it('放进新文件不用重启', async () => {
      write('local/3dt/新模型/tileset.json', '{"from":"new"}');
      const res = await get(`/3dt/${encodeURIComponent('新模型')}/tileset.json`);
      expect(res.body).toBe('{"from":"new"}');
    });

    it('本地目录里没有的页面地址交给单页应用', async () => {
      const res = await get('/design.local/not-found/index.html');
      expect(res.body).toContain('<title>单页应用</title>');
    });

    it.each(['/3dt/../../secret.txt', '/3dt/..%2f..%2fsecret.txt', '/design.local/%2e%2e/%2e%2e/secret.txt'])(
      '不能穿越到映射目录之外：%s',
      async path => {
        const res = await get(path);
        expect(res.body).not.toContain('不应该被读到');
      }
    );
  });
});
