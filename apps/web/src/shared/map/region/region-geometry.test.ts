// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import cityFile from '../boundary/data/jiangsu-city.json?raw';
import cityUrl from '../boundary/data/jiangsu-city.json?url';
import countyFile from '../boundary/data/jiangsu-county.json?raw';
import countyUrl from '../boundary/data/jiangsu-county.json?url';
import { findRegion, type Region } from './region-catalog';
import { boundaryCode, createRegionBoundaryLoader, type LoadJson, polygonBounds } from './region-geometry';

const FILES = new Map([
  [cityUrl, cityFile],
  [countyUrl, countyFile]
]);

// 按地址给出仓库里的边界文件
const readBoundaryFile: LoadJson = url => {
  const file = FILES.get(url);
  if (file === undefined) {
    return Promise.reject(new Error(`没有这个文件：${url}`));
  }
  return Promise.resolve(JSON.parse(file));
};

function region(code: string): Region {
  const found = findRegion(code);
  if (!found) {
    throw new Error(`目录里没有 ${code}`);
  }
  return found;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('区划的边界', () => {
  it('边界数据里的代码换成 6 位：市界取前 6 位，县界去掉 156', () => {
    expect(boundaryCode('320100000000')).toBe('320100');
    expect(boundaryCode('156320382')).toBe('320382');
    expect(boundaryCode('320382')).toBe('320382');
  });

  it('外包范围取所有多边形的外环', () => {
    const first = [
      [
        [0, 0],
        [2, 0],
        [2, 1],
        [0, 0]
      ]
    ];
    const second = [
      [
        [5, -1],
        [6, 3],
        [5, 3],
        [5, -1]
      ]
    ];

    expect(polygonBounds([first, second])).toStrictEqual([0, -1, 6, 3]);
  });

  it('市从市界取，区县从县界取；一个多边形是 Polygon，多个合成 MultiPolygon', async () => {
    const loadJson = vi.fn<LoadJson>(readBoundaryFile);
    const loader = createRegionBoundaryLoader(loadJson);

    const nanjing = await loader.load(region('320100'));
    const liangxi = loader.load(region('320213'));

    expect(nanjing.code).toBe('320100');
    expect(nanjing.geometry.type).toBe('MultiPolygon');
    expect(nanjing.geometry.coordinates).toHaveLength(2);
    expect(nanjing.bounds).toStrictEqual([118.357927, 31.230207, 119.236382, 32.616407]);
    await expect(liangxi).resolves.toMatchObject({
      geometry: { type: 'Polygon' },
      bounds: [120.237887, 31.515102, 120.346889, 31.633352]
    });
    expect(loadJson.mock.calls).toStrictEqual([[cityUrl], [countyUrl]]);
  });

  it('连云港的市界是两个要素，合成一个 MultiPolygon，范围包含两块', async () => {
    const loader = createRegionBoundaryLoader(readBoundaryFile);

    const { geometry, bounds } = await loader.load(region('320700'));

    expect(geometry.type).toBe('MultiPolygon');
    expect(geometry.coordinates).toHaveLength(2);
    expect(bounds).toStrictEqual([118.399654, 33.980783, 119.806439, 35.125012]);
  });

  it('每个文件只读一次，同时发起的加载共用一次', async () => {
    const loadJson = vi.fn<LoadJson>(readBoundaryFile);
    const loader = createRegionBoundaryLoader(loadJson);

    const loads = [loader.load(region('320100')), loader.load(region('320200'))];
    await Promise.allSettled(loads);
    loads.push(loader.load(region('320300')), loader.load(region('320102')), loader.load(region('320213')));

    await expect(Promise.all(loads)).resolves.toHaveLength(5);

    expect(loadJson.mock.calls).toStrictEqual([[cityUrl], [countyUrl]]);
  });

  it('读取失败不缓存，下次重新读取', async () => {
    const loadJson = vi.fn<LoadJson>().mockRejectedValueOnce(new Error('断网')).mockImplementation(readBoundaryFile);
    const loader = createRegionBoundaryLoader(loadJson);

    await expect(loader.load(region('320100'))).rejects.toThrow('断网');
    await expect(loader.load(region('320100'))).resolves.toMatchObject({ code: '320100' });
    expect(loadJson).toHaveBeenCalledTimes(2);
  });

  it('数据里没有这个区划时报错；文件结构不对时报 ZodError', async () => {
    const missing: Region = { code: '320199', name: '测试区', level: 'district', cityCode: '320100' };
    const point = { properties: { code: '156320102' }, geometry: { type: 'Point', coordinates: [0, 0] } };
    const broken = createRegionBoundaryLoader(() => Promise.resolve({ features: [point] }));

    await expect(createRegionBoundaryLoader(readBoundaryFile).load(missing)).rejects.toThrow(
      '边界数据里没有测试区（320199）'
    );
    await expect(broken.load(region('320102'))).rejects.toBeInstanceOf(ZodError);
  });

  it('默认用 fetch 下载；下载失败时报出状态码', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(Response.json(await readBoundaryFile(countyUrl)));
    vi.stubGlobal('fetch', fetch);
    const loader = createRegionBoundaryLoader();

    await expect(loader.load(region('320102'))).rejects.toThrow(`边界数据下载失败：404 ${countyUrl}`);
    await expect(loader.load(region('320102'))).resolves.toMatchObject({ code: '320102' });
    expect(fetch.mock.calls.map(([url]) => url)).toStrictEqual([countyUrl, countyUrl]);
  });
});
