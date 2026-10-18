// @vitest-environment node
import type { RasterSourceSpecification } from '@maplibre/maplibre-gl-style-spec';
import { ImageryProvider, Rectangle, Request, Resource, UrlTemplateImageryProvider, WebMercatorTilingScheme } from 'cesium';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { createRasterProvider } from './raster-provider';

const SOURCE: RasterSourceSpecification = { type: 'raster', tiles: ['https://tiles.test/{z}/{x}/{y}.png'] };

// 替代 SDK 的公开图片加载边界，模板展开仍运行真实 UrlTemplateImageryProvider
function captureRequests() {
  const resources: Resource[] = [];
  const load = vi.spyOn(ImageryProvider, 'loadImage').mockImplementation((_provider, resource) => {
    expect(resource).toBeInstanceOf(Resource);
    resources.push(resource as Resource);
    return undefined;
  });
  return { resources, load };
}

afterEach(() => vi.restoreAllMocks());

describe('三维栅格提供者', () => {
  it('构造不请求网络，默认尺寸和级别遵守 style-spec，关闭 SDK 要素查询', () => {
    const { load } = captureRequests();
    const provider = createRasterProvider(SOURCE);
    expectTypeOf<UrlTemplateImageryProvider>().toExtend<ImageryProvider>();
    expectTypeOf(provider).toExtend<ImageryProvider>();
    expect(provider.tileWidth).toBe(512);
    expect(provider.tileHeight).toBe(512);
    expect(provider.minimumLevel).toBe(0);
    expect(provider.maximumLevel).toBe(22);
    expect(provider.tilingScheme).toBeInstanceOf(WebMercatorTilingScheme);
    expect(provider.hasAlphaChannel).toBe(true);
    expect(provider.pickFeatures(0, 0, 0, 0, 0)).toBeUndefined();
    expect(load).not.toHaveBeenCalled();
  });

  it('按原始 x+y 分片，XYZ 地址保留行号，并将取消与节流请求交给 SDK', () => {
    const { resources } = captureRequests();
    const provider = createRasterProvider({
      ...SOURCE,
      tiles: ['https://a.test/{z}/{x}/{y}.png', 'https://b.test/{z}/{x}/{y}.png']
    });
    const request = new Request({ throttle: true, throttleByServer: true });
    expect(provider.requestImage(3, 4, 5, request)).toBeUndefined();
    expect(provider.requestImage(3, 5, 5)).toBeUndefined();
    expect(resources.map(resource => resource.url)).toEqual([
      'https://b.test/5/3/4.png', 'https://a.test/5/3/5.png'
    ]);
    expect(resources[0].request).toBe(request);
  });

  it('TMS 仅翻转 URL 行号，不改变分片或 Cesium 瓦片坐标', () => {
    const { resources } = captureRequests();
    const provider = createRasterProvider({
      ...SOURCE, scheme: 'tms',
      tiles: ['https://a.test/{z}/{x}/{y}.png', 'https://b.test/{z}/{x}/{y}.png']
    });
    expect(provider.requestImage(3, 4, 5)).toBeUndefined();
    expect(provider.requestImage(0, 0, 0)).toBeUndefined();
    expect(resources.map(resource => resource.url)).toEqual([
      'https://b.test/5/3/27.png', 'https://a.test/0/0/0.png'
    ]);
  });

  it('保留覆盖范围、尺寸、最大数据级别与署名，不偷偷修改源的级别', () => {
    const source: RasterSourceSpecification = {
      ...SOURCE, bounds: [118, 30, 120, 32], minzoom: 5, maxzoom: 18, tileSize: 256, attribution: '本地影像'
    };
    const provider = createRasterProvider(source);
    expect(provider.rectangle).toEqual(Rectangle.fromDegrees(118, 30, 120, 32));
    expect(provider.minimumLevel).toBe(5);
    expect(provider.maximumLevel).toBe(18);
    expect(provider.tileWidth).toBe(256);
    expect(provider.tileHeight).toBe(256);
    expect(provider.credit.html).toBe('本地影像');
    expect(source.minzoom).toBe(5);
  });

  it('全球 minzoom=1 可用，跨经线范围正确计数，极区裁到投影边界', () => {
    expect(createRasterProvider({ ...SOURCE, minzoom: 1 }).minimumLevel).toBe(1);
    const crossing = createRasterProvider({ ...SOURCE, bounds: [179, -1, -179, 1], minzoom: 5 });
    expect(crossing.minimumLevel).toBe(5);
    expect(crossing.rectangle).toEqual(Rectangle.fromDegrees(179, -1, -179, 1));
    const provider = createRasterProvider({ ...SOURCE, bounds: [-180, -90, 180, 90] });
    expect(provider.rectangle).toEqual(provider.tilingScheme.rectangle);
  });

  it('不吞掉 SDK 的失败，也不把节流的 undefined 包成 Promise', async () => {
    const { load } = captureRequests();
    const provider = createRasterProvider(SOURCE);
    expect(provider.requestImage(0, 0, 0)).toBeUndefined();
    const error = new Error('图片下载失败');
    const failure = Promise.reject(error);
    load.mockReturnValue(failure);
    const waiting = provider.requestImage(0, 0, 0);
    expect(waiting).toBe(failure);
    await expect(waiting).rejects.toBe(error);
  });

  it.each([
    { url: '/tiles.json' }, { tiles: [] }, { tiles: [' '] },
    { tiles: ['/tiles/{quadkey}.png'] }, { tiles: ['/tiles/{bbox-epsg-3857}.png'] },
    { tiles: ['/tiles/{s}/{z}/{x}/{y}.png'] }, { tiles: ['/tiles/{x.png'] },
    { tiles: ['/tiles/%7Bx%7D.png'] },
    { minzoom: 2 }, { minzoom: 1.5 }, { minzoom: -1 }, { maxzoom: 31 }, { maxzoom: NaN },
    { minzoom: 1, maxzoom: 0 }, { tileSize: 0 }, { tileSize: 1.5 },
    { bounds: [120, 30, 118, 32], minzoom: 3 },
    { bounds: [118, 30, 118, 32] }, { bounds: [118, 32, 120, 30] },
    { bounds: [-181, 30, 120, 32] }, { bounds: [118, 30, 181, 32] },
    { bounds: [118, 30, 120, NaN] }, { bounds: [118, 86, 120, 89] }
  ] satisfies Partial<RasterSourceSpecification>[])('非法或尚不支持的源明确失败：%j', patch => {
    const { load } = captureRequests();
    expect(() => createRasterProvider({ ...SOURCE, ...patch })).toThrow('三维栅格');
    expect(load).not.toHaveBeenCalled();
  });
});
