// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Plugin, ResolvedConfig, ViteDevServer } from 'vite';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { required } from '../../src/shared/testing/required.ts';
import { SiteError } from './errors.ts';
import type { Sites } from './sites.ts';
import { sitePlugin } from './vite-plugin.ts';

const CATALOG_TEXT = '{ "models": [{ "id": "a" }, { "id": "b", "name": "乙" }, { "id": "c" }] }\n';
const SITES: Sites = {
  full: { label: '齐全的站点', missing: [] },
  partial: { label: '缺一个的站点', missing: [{ id: 'b', reason: '没拷' }] },
  wrong: { label: '写错的站点', missing: [{ id: 'x', reason: '写错了' }] }
};

// 钩子可能写成 { handler }，测试只关心处理函数
function handlerOf<T>(hook: T | { handler: T } | undefined): T {
  if (hook === undefined) {
    throw new Error('插件没有这个钩子');
  }
  return typeof hook === 'object' && hook !== null && 'handler' in hook ? hook.handler : hook;
}

async function close(plugin: Plugin): Promise<void> {
  await handlerOf(plugin.closeBundle).call(undefined as never);
}

type Middleware = (request: { url?: string }, response: unknown, next: (error?: unknown) => void) => void;

function request(middleware: Middleware, url: string) {
  const headers: Record<string, string> = {};
  let body: string | undefined;
  const next = vi.fn<(error?: unknown) => void>();
  const response = {
    setHeader: (key: string, value: string) => {
      headers[key] = value;
    },
    end: (text: string) => {
      body = text;
    }
  };
  middleware({ url }, response, next);
  return { headers, body, next };
}

describe('sitePlugin', () => {
  let root: string;
  let sitesFile: string;
  let info: Mock<(message: string) => void>;

  const write = (path: string, content: string) => {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  };
  const plugin = (name: string | undefined) => sitePlugin(name, sitesFile);
  const config = (command: 'build' | 'serve') =>
    ({ command, root, publicDir: join(root, 'public'), base: '/', build: { outDir: 'dist' }, logger: { info } }) as unknown as ResolvedConfig;
  const resolveConfig = async (site: Plugin, command: 'build' | 'serve' = 'build') => {
    await handlerOf(site.configResolved).call(undefined as never, config(command));
  };

  // 照 Vite 的顺序调钩子：configResolved，复制 public（Vite 在 renderStart 做），writeBundle
  const build = async (site: Plugin, copied = CATALOG_TEXT) => {
    await resolveConfig(site);
    write('dist/3dt/manifest.json', copied);
    await handlerOf(site.writeBundle).call(undefined as never, {} as never, {} as never);
  };
  const output = () => readFileSync(join(root, 'dist/3dt/manifest.json'), 'utf8');
  // 开发服务器：返回插件注册的中间件
  const serve = async (name: string | undefined) => {
    const middlewares: Middleware[] = [];
    const site = plugin(name);
    await resolveConfig(site, 'serve');
    const server = { middlewares: { use: (middleware: Middleware) => middlewares.push(middleware) } };
    await handlerOf(site.configureServer).call(undefined as never, server as unknown as ViteDevServer);
    return middlewares;
  };
  const manifestMiddleware = async (name: string) => required((await serve(name))[0], '插件注册的清单中间件');

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'site-plugin-'));
    write('public/3dt/manifest.json', CATALOG_TEXT);
    write('sites.json', JSON.stringify(SITES));
    sitesFile = join(root, 'sites.json');
    info = vi.fn<(message: string) => void>();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('测试和 vite preview 里不启用，开发和构建都启用', () => {
    const apply = plugin('partial').apply;
    if (typeof apply !== 'function') {
      throw new TypeError('apply 应该是函数');
    }
    expect(apply({}, { command: 'serve', mode: 'test' })).toBe(false);
    expect(apply({}, { command: 'serve', mode: 'production', isPreview: true })).toBe(false);
    expect(apply({}, { command: 'serve', mode: 'development' })).toBe(true);
    expect(apply({}, { command: 'build', mode: 'intranet' })).toBe(true);
  });

  it('设了站点：产物里的清单换成去掉缺的模型的结果，日志写明站点、模型数和缺的原因', async () => {
    const site = plugin('partial');
    await build(site);
    expect(output()).not.toBe(CATALOG_TEXT);
    expect(JSON.parse(output())).toStrictEqual({ models: [{ id: 'a' }, { id: 'c' }] });
    expect(info).toHaveBeenCalledWith('[site] 站点 partial（缺一个的站点）：三维模型清单发布全集 3 个中的 2 个，缺 b（没拷）');
    await close(site);
  });

  it('站点不缺模型时产物里的清单和全集逐字相同', async () => {
    const site = plugin('full');
    await build(site, '复制过来的');
    expect(output()).toBe(CATALOG_TEXT);
    await close(site);
  });

  it.each([undefined, ''])('没设站点（YZT_SITE 是 %j）：不动产物里的清单，日志写明发布全集', async name => {
    const site = plugin(name);
    await build(site, 'public 复制过来的');
    await close(site);
    expect(output()).toBe('public 复制过来的');
    expect(info).toHaveBeenCalledWith('[site] 没有设 YZT_SITE：三维模型清单发布全集 3 个模型');
  });

  it('站点名、缺的模型写错时在 configResolved 就失败', async () => {
    await expect(resolveConfig(plugin('nope'))).rejects.toThrow('没有站点 nope：现有 full、partial、wrong');
    await expect(resolveConfig(plugin('wrong'))).rejects.toThrow('缺的模型 x 不在全集清单里');
  });

  it.each([undefined, 'full'])('全集不是合法的 JSON 时构建失败，写明是哪个文件（站点 %j）', async name => {
    write('public/3dt/manifest.json', '{ "models": [{ "id": "a" },] }');
    await expect(resolveConfig(plugin(name))).rejects.toThrow(/三维模型清单不是合法的 JSON.*（public\/3dt\/manifest\.json）/);
  });

  it('写完以后清单又被覆盖时，closeBundle 报错', async () => {
    const site = plugin('partial');
    await build(site);
    write('dist/3dt/manifest.json', CATALOG_TEXT);
    await expect(close(site)).rejects.toThrow('不是站点 partial 组合的结果');
  });

  describe('开发服务器', () => {
    it('设了站点时用组合的结果回答清单，带查询参数也算，每次都重新读全集和站点', async () => {
      const middleware = await manifestMiddleware('partial');
      const first = request(middleware, '/3dt/manifest.json');
      expect(first.next).not.toHaveBeenCalled();
      expect(JSON.parse(first.body ?? '')).toStrictEqual({ models: [{ id: 'a' }, { id: 'c' }] });
      write('public/3dt/manifest.json', '{ "models": [{ "id": "a" }, { "id": "b" }, { "id": "d" }] }');
      write('sites.json', JSON.stringify({ ...SITES, partial: { label: '改过', missing: [{ id: 'd', reason: '改过' }] } }));
      const { headers, body, next } = request(middleware, '/3dt/manifest.json?t=1');
      expect(next).not.toHaveBeenCalled();
      expect(JSON.parse(body ?? '')).toStrictEqual({ models: [{ id: 'a' }, { id: 'b' }] });
      expect(headers['Cache-Control']).toBe('no-store');
    });

    it('别的地址交给后面的中间件（模型照旧从本地或服务器取）', async () => {
      const middleware = await manifestMiddleware('partial');
      for (const url of ['/3dt/wuxi/3dtiles/a/tileset.json', '/3dt/manifest.json.bak', '/']) {
        const { body, next } = request(middleware, url);
        expect(body).toBeUndefined();
        expect(next).toHaveBeenCalledWith();
      }
    });

    it('全集改坏时把错误交给 Vite，不回答清单', async () => {
      const middleware = await manifestMiddleware('partial');
      write('public/3dt/manifest.json', '{ "items": [] }');
      const { body, next } = request(middleware, '/3dt/manifest.json');
      expect(body).toBeUndefined();
      const error = next.mock.calls[0]?.[0];
      expect(error).toBeInstanceOf(SiteError);
      expect(String(error)).toContain('三维模型清单的格式不对');
    });

    it('没设站点时不注册中间件', async () => {
      expect(await serve(undefined)).toEqual([]);
    });
  });
});
