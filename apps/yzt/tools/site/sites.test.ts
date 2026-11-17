// @vitest-environment node
import { describe, expect, it } from 'vitest';
// 用 import 读入库的清单和站点：改了哪一个，test:changed 都能选中这个文件
import catalog from '../../public/3dt/manifest.json' with { type: 'json' };
import { composeSiteManifest, missingIds, siteProblems } from './compose.ts';
import { SiteError } from './errors.ts';
import sitesJson from './sites.json' with { type: 'json' };
import { parseSites } from './sites.ts';

describe('parseSites', () => {
  it('去掉开头的 BOM，读出站点', () => {
    const sites = parseSites(`\uFEFF{ "1-2": { "label": "甲", "missing": [{ "id": "a", "reason": "没拷" }] } }`);
    expect(sites).toEqual({ '1-2': { label: '甲', missing: [{ id: 'a', reason: '没拷' }] } });
  });

  it('不是合法的 JSON 时报 SiteError', () => {
    expect(() => parseSites('{ "1-2": { } ,}')).toThrow(SiteError);
    expect(() => parseSites('{ "1-2": { } ,}')).toThrow('部署站点的文件不是合法的 JSON');
  });

  it('缺的模型要写原因，origin 要是 http 地址，不能多写字段', () => {
    expect(() => parseSites('{ "1-2": { "label": "甲", "missing": ["a"] } }')).toThrow('部署站点的文件格式不对');
    expect(() => parseSites('{ "1-2": { "label": "甲", "missing": [{ "id": "a", "reason": "" }] } }')).toThrow(SiteError);
    expect(() => parseSites('{ "1-2": { "label": "甲", "origin": "ftp://h", "missing": [] } }')).toThrow(SiteError);
    expect(() => parseSites('{ "1-2": { "label": "甲", "missing": [], "path": "x" } }')).toThrow(SiteError);
  });
});

describe('部署站点（tools/site/sites.json）', () => {
  const sites = parseSites(JSON.stringify(sitesJson));
  const catalogText = JSON.stringify(catalog);

  it.each(Object.entries(sites))('%s：站点名和缺的模型都写对了', (name, site) => {
    expect(siteProblems(name, site, catalog.models)).toEqual([]);
  });

  it.each(Object.entries(sites))('%s：留下的模型和全集里的一模一样', (name, site) => {
    const { models } = composeSiteManifest(catalogText, name, site);
    const missing = new Set(missingIds(site));
    expect(models).toStrictEqual(catalog.models.filter(model => !missing.has(model.id)));
  });
});
