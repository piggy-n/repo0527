// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodedPath, manifestLabel, manifestSource, readManifest, resolveSplats } from './splat-models.ts';

const PLACEMENT = { lng: 117.18, lat: 34.27, height: 59.45, heading: -0.1 };

const manifest = {
  models: [
    { id: 'xz-gc', name: '彭城广场', kind: 'oblique', tileset: 'XZ_GC_3DT/tileset.json' },
    { id: 'sample', name: '样例', kind: 'splat', lcc2: 'LCC2/render2/%E5%9C%B0%E4%B8%8B.lcc2', placement: PLACEMENT },
    { id: 'outside', name: '外面', kind: 'splat', lcc2: '../other/a.lcc2', placement: PLACEMENT },
    { id: 'other-host', name: '别的服务器', kind: 'splat', lcc2: 'http://other.example/3dt/a.lcc2', placement: PLACEMENT },
    { id: 'broken', name: '坏的', kind: 'splat', lcc2: 'a.lcc2' }
  ]
};

describe('manifestSource', () => {
  it('和开发服务器一样：本地清单在时用它，否则用入库的', () => {
    expect(manifestSource('local.json', 'public.json', null, () => true)).toEqual({ kind: 'local', file: 'local.json' });
    expect(manifestSource('local.json', 'public.json', null, () => false)).toEqual({ kind: 'public', file: 'public.json' });
  });

  it('设了代理时从服务器取，本地的不看', () => {
    expect(manifestSource('local.json', 'public.json', 'http://server:8080', () => true)).toEqual({
      kind: 'proxy',
      url: 'http://server:8080/3dt/manifest.json'
    });
  });
});

describe('manifestLabel', () => {
  it('写进结果的说明不带服务器地址', () => {
    expect(manifestLabel({ kind: 'proxy', url: 'http://server:8080/3dt/manifest.json' })).toBe('服务器上的清单（YZT_3DT_PROXY）');
    expect(manifestLabel({ kind: 'local', file: 'C:/secret/manifest.json' })).toBe('本地清单 local/3dt/manifest.json');
  });
});

describe('readManifest', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('本地文件开头的 BOM 去掉：PowerShell 写的 UTF-8 带 BOM', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'splat-models-'));
    try {
      const file = join(dir, 'manifest.json');
      writeFileSync(file, '\uFEFF{"models":[]}');
      await expect(readManifest({ kind: 'local', file })).resolves.toEqual({ models: [] });
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('服务器上取不到时说清楚', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('', { status: 404 })));
    await expect(readManifest({ kind: 'proxy', url: 'http://server/3dt/manifest.json' })).rejects.toThrow('HTTP 404');
  });
});

describe('resolveSplats', () => {
  it('按 ID 取出地址和摆放：地址相对 /3dt/，保留 URL 编码；磁盘路径要解码', () => {
    const [model] = resolveSplats(manifest, ['sample']);
    expect(model).toEqual({ id: 'sample', path: 'LCC2/render2/%E5%9C%B0%E4%B8%8B.lcc2', placement: PLACEMENT });
    expect(decodedPath(model?.path ?? '')).toBe('LCC2/render2/地下.lcc2');
  });

  it.each([
    [['missing'], '清单里没有 missing'],
    [['xz-gc'], '不是高斯泼溅'],
    [['broken'], '缺 lcc2、placement'],
    [['outside'], '不在 /3dt/ 下'],
    [['other-host'], '不在 /3dt/ 下']
  ])('说清楚哪里不对：%j', (ids, message) => {
    expect(() => resolveSplats(manifest, ids)).toThrow(message);
  });

  it('清单本身不对时也说清楚', () => {
    expect(() => resolveSplats({ items: [] }, ['sample'])).toThrow('清单的格式不对');
  });
});
