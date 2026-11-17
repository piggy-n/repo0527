// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ResolvedConfig } from 'vite';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { buildOutputPlugin } from './vite-plugin.ts';

// 钩子可能写成 { handler }，测试只关心处理函数
function handlerOf<T>(hook: T | { handler: T } | undefined): T {
  if (hook === undefined) {
    throw new Error('插件没有这个钩子');
  }
  return typeof hook === 'object' && hook !== null && 'handler' in hook ? hook.handler : hook;
}

describe('buildOutputPlugin 检查磁盘上的产物', () => {
  let root: string;
  let info: Mock<(message: string) => void>;

  const write = (path: string) => {
    const file = join(root, 'dist', path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, '');
  };

  // 照 Vite 的顺序调钩子：configResolved，写完产物后 writeBundle；分块清单是空的，只看磁盘上的文件
  const check = async () => {
    const plugin = buildOutputPlugin();
    const config = { root, env: {}, envDir: root, build: { outDir: 'dist' }, logger: { info } };
    await handlerOf(plugin.configResolved).call(undefined as never, config as unknown as ResolvedConfig);
    await handlerOf(plugin.writeBundle).call(undefined as never, {} as never, {} as never);
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'build-output-'));
    info = vi.fn<(message: string) => void>();
    write('index.html');
    write('assets/index-abc.js');
    write('3dt/manifest.json');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('名字里带 basemap 的文件、不在顶层的 basemap 目录都可以有', async () => {
    write('assets/basemap-standard-abc.png');
    write('images/basemap/standard.png');
    await check();
    expect(info).toHaveBeenCalledWith('[build-output] 产物检查通过');
  });

  it.each(['basemap/imagery/_alllayers/L10/R0180C0300.bundlx', 'basemap/standard/conf.xml'])(
    '顶层有 basemap 目录时构建失败：%s',
    async path => {
      write(path);
      await expect(check()).rejects.toThrow('[build-output] 产物包含服务器底图：basemap/（底图放在 local/basemap');
    }
  );

  it.each(['R0180C0300.bundle', 'assets/R0180C0300.bundlx', 'tiles/L10/R0180C0300.BUNDLE'])(
    '任何位置有紧凑缓存的瓦片文件时构建失败：%s',
    async path => {
      write(path);
      await expect(check()).rejects.toThrow(`[build-output] 产物包含紧凑缓存的瓦片：${path}（底图放在 local/basemap`);
    }
  );
});
