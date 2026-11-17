// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { composeSiteManifest, findSite, missingIds, parseCatalog, siteProblems } from './compose.ts';
import { SiteError } from './errors.ts';
import type { Site } from './sites.ts';

const CATALOG = {
  models: [
    { id: 'a', name: '甲', kind: 'oblique', tileset: 'suzhou/3dtiles/%E7%94%B2/tileset.json' },
    { id: 'b', name: '乙', kind: 'splat', lcc2: 'xuzhou/lcc2/b/b.lcc2', placement: { lng: 117, lat: 34, height: 50, heading: -1 } },
    { id: 'c', name: '丙', kind: 'white', effects: [{ id: 'plain', label: '无纹理', tileset: 'wuxi/3dtiles/c/plain/tileset.json' }] }
  ]
};
// 入库的清单是手工排版的，组合不能改它的文本
const CATALOG_TEXT = `{ "models": [\n${CATALOG.models.map(model => `  ${JSON.stringify(model)}`).join(',\n')}\n] }\n`;

const site = (...ids: string[]): Site => ({ label: '测试站点', missing: ids.map(id => ({ id, reason: '测试' })) });

describe('parseCatalog', () => {
  it('去掉开头的 BOM（PowerShell 写的 UTF-8 带 BOM）', () => {
    expect(parseCatalog(`\uFEFF${CATALOG_TEXT}`).map(model => model.id)).toEqual(['a', 'b', 'c']);
  });

  it('没有 models 数组、模型没有 id 时报错', () => {
    expect(() => parseCatalog('{"items":[]}')).toThrow('三维模型清单的格式不对');
    expect(() => parseCatalog('{"models":[{"name":"甲"}]}')).toThrow('三维模型清单的格式不对');
  });

  it('不是合法的 JSON 时报 SiteError，带上解析的原因', () => {
    expect(() => parseCatalog('{ "models": [{ "id": "a" },] }')).toThrow(SiteError);
    expect(() => parseCatalog('{ "models": [{ "id": "a" },] }')).toThrow('三维模型清单不是合法的 JSON');
  });
});

describe('findSite', () => {
  it('按名字取站点；没有时报错并列出现有的站点', () => {
    const sites = { '1-2': site(), '3-4': site('a') };
    expect(findSite('3-4', sites)).toBe(sites['3-4']);
    expect(() => findSite('5-6', sites)).toThrow('没有站点 5-6：现有 1-2、3-4');
  });

  it('不从原型链上取（toString 不是站点）', () => {
    expect(() => findSite('toString', { '1-2': site() })).toThrow('没有站点 toString');
  });
});

describe('siteProblems', () => {
  const catalog = parseCatalog(CATALOG_TEXT);

  it('写对的站点没有问题', () => {
    expect(siteProblems('15-111', site('b'), catalog)).toEqual([]);
  });

  it('站点名只能用小写字母、数字和连字符', () => {
    expect(siteProblems('15_111', site(), catalog)).toEqual(['站点名 15_111 只能用小写字母、数字和连字符']);
    expect(siteProblems('Win', site(), catalog)).toHaveLength(1);
    expect(siteProblems('-1', site(), catalog)).toHaveLength(1);
  });

  it('缺的 ID 重复、不在全集里时逐个说明', () => {
    expect(siteProblems('1-2', site('b', 'x', 'b'), catalog)).toEqual(['缺的模型 x 不在全集清单里', '缺的模型 b 写了两次']);
  });
});

describe('composeSiteManifest', () => {
  it('不缺模型时原样返回全集的文本', () => {
    const composed = composeSiteManifest(CATALOG_TEXT, '1-2', site());
    expect(composed.text).toBe(CATALOG_TEXT);
    expect(composed.total).toBe(3);
    expect(composed.models.map(model => model.id)).toEqual(['a', 'b', 'c']);
  });

  it('去掉缺的模型，先后不变，留下的模型和全集里的一模一样', () => {
    const composed = composeSiteManifest(CATALOG_TEXT, '1-2', site('b'));
    expect(JSON.parse(composed.text)).toStrictEqual({ models: [CATALOG.models[0], CATALOG.models[2]] });
    expect(composed.models.map(model => model.id)).toEqual(['a', 'c']);
    expect(composed.total).toBe(3);
  });

  it('缺的先后和全集不同时仍按全集的先后', () => {
    expect(missingIds(site('c', 'a'))).toEqual(['c', 'a']);
    const composed = composeSiteManifest(CATALOG_TEXT, '1-2', site('c', 'a'));
    expect(JSON.parse(composed.text)).toStrictEqual({ models: [CATALOG.models[1]] });
  });

  it('站点写错时报错，写明站点和每个问题', () => {
    expect(() => composeSiteManifest(CATALOG_TEXT, '1-2', site('x'))).toThrow('站点 1-2 写错了：缺的模型 x 不在全集清单里');
  });
});
