// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { tileUrlTemplate } from './url-template';

const tianditu = (subdomain: string) =>
  `https://t${subdomain}.tianditu.gov.cn/img_w/wmts?TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=key`;

describe('tileUrlTemplate', () => {
  it('天地图 t0～t7 合成一个带 {s} 的模板，子域名按原来的顺序', () => {
    const tiles = ['0', '1', '2', '3', '4', '5', '6', '7'].map(tianditu);

    expect(tileUrlTemplate(tiles)).toStrictEqual({
      url: 'https://t{s}.tianditu.gov.cn/img_w/wmts?TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=key',
      subdomains: ['0', '1', '2', '3', '4', '5', '6', '7']
    });
  });

  it('子域名长短不一时也只换不同的那一段', () => {
    const template = tileUrlTemplate(['https://a.tiles.cn/{z}/{x}/{y}.png', 'https://bb.tiles.cn/{z}/{x}/{y}.png']);

    expect(template).toStrictEqual({ url: 'https://{s}.tiles.cn/{z}/{x}/{y}.png', subdomains: ['a', 'bb'] });
  });

  it('一个地址或几个相同的地址原样使用', () => {
    const url = 'https://tiles.cn/{z}/{x}/{y}.png';

    expect(tileUrlTemplate([url])).toStrictEqual({ url, subdomains: [] });
    expect(tileUrlTemplate([url, url])).toStrictEqual({ url, subdomains: [] });
  });

  it('差在路径或不止一处时只用第一个地址', () => {
    const first = 'https://a.tiles.cn/v1/{z}/{x}/{y}.png';

    expect(tileUrlTemplate([first, 'https://b.tiles.cn/v2/{z}/{x}/{y}.png'])).toStrictEqual({
      url: first,
      subdomains: []
    });
    expect(tileUrlTemplate(['https://t.cn/a/{z}/{x}/{y}', 'https://t.cn/b/c/{z}/{x}/{y}'])).toStrictEqual({
      url: 'https://t.cn/a/{z}/{x}/{y}',
      subdomains: []
    });
  });

  it('有三维不支持的占位符或没有地址时返回 null', () => {
    expect(tileUrlTemplate(['https://tiles.cn/{quadkey}.png'])).toBeNull();
    expect(tileUrlTemplate(['https://tiles.cn/wms?BBOX={bbox-epsg-3857}'])).toBeNull();
    expect(tileUrlTemplate([])).toBeNull();
  });
});
