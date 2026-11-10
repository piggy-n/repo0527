// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { decodedPath, manifestSource, resolveSplats } from './splat-models.ts';

const PLACEMENT = { lng: 117.18, lat: 34.27, height: 59.45, heading: -0.1 };

const manifest = {
  models: [
    { id: 'xz-gc', name: '彭城广场', kind: 'oblique', tileset: 'XZ_GC_3DT/tileset.json' },
    { id: 'sample', name: '样例', kind: 'splat', lcc2: 'LCC2/render2/%E5%9C%B0%E4%B8%8B.lcc2', placement: PLACEMENT },
    { id: 'outside', name: '外面', kind: 'splat', lcc2: '../other/a.lcc2', placement: PLACEMENT },
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
    [['outside'], '不在 /3dt/ 下']
  ])('说清楚哪里不对：%j', (ids, message) => {
    expect(() => resolveSplats(manifest, ids)).toThrow(message);
  });

  it('清单本身不对时也说清楚', () => {
    expect(() => resolveSplats({ items: [] }, ['sample'])).toThrow('清单的格式不对');
  });
});
