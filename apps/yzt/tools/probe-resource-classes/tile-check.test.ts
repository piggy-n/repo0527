// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { decodeTile, partsOf, type TileFeature } from './mvt.ts';
import { ProbeAuthError, tileAt } from './probe.ts';
import { encodeTile } from './test-tile.ts';
import {
  formatTileCheck,
  measureFeature,
  parseTileCheckTargets,
  runTileCheck,
  summarizeTile,
  type TileCheckIO,
  type TileCheckOptions,
  type TileCheckResult,
  type TileSummary,
  tilesToCheck,
  verdictOf,
  zoomRanges
} from './tile-check.ts';

// 外环的坐标按瓦片坐标顺时针，面积为正；洞反过来
const square = (x: number, y: number, size: number) => [x, y, x + size, y, x + size, y + size, x, y + size];
const hole = (x: number, y: number, size: number) => [x, y, x, y + size, x + size, y + size, x + size, y];

function firstFeature(tile: Uint8Array): TileFeature {
  const feature = decodeTile(tile)[0]?.features[0];
  if (!feature) {
    throw new Error('瓦片里没有要素');
  }
  return feature;
}

// 把全部要素合并成一个多面：每张瓦片一面一线一点，属性只有一份
function mergedTile(value: string, rings = 12): Uint8Array {
  return encodeTile('lcsh_sltb_2024', [
    {
      geometry: 3,
      properties: { lin_zhong: value },
      parts: Array.from({ length: rings }, (_, index) => square(index * 100, 0, 50))
    },
    { geometry: 2, properties: { lin_zhong: '999' }, parts: [[0, 0, 10, 0]] },
    { geometry: 1, properties: { lin_zhong: '999' }, parts: [[5, 5]] }
  ]);
}

function summaryOf(tile: Uint8Array): TileSummary {
  return summarizeTile(decodeTile(tile), 'polygon', 'lin_zhong', { x: 1, y: 2 });
}

describe('解码几何', () => {
  it('面的每个环是一个部件；坐标差累加，负数也对', () => {
    const feature = firstFeature(encodeTile('a', [{ properties: {}, parts: [square(10, 20, 5), square(3, 4, 2)] }]));
    expect(partsOf(feature.commands)).toStrictEqual([square(10, 20, 5), square(3, 4, 2)]);
  });

  it('多点的每个点、多线的每条线都是一个部件', () => {
    const points = firstFeature(encodeTile('a', [{ geometry: 1, properties: {}, parts: [[1, 2], [3, 4]] }]));
    expect(partsOf(points.commands)).toStrictEqual([[1, 2], [3, 4]]);
    const lines = firstFeature(encodeTile('a', [{ geometry: 2, properties: {}, parts: [[0, 0, 3, 4], [9, 9, 9, 19]] }]));
    expect(partsOf(lines.commands)).toStrictEqual([[0, 0, 3, 4], [9, 9, 9, 19]]);
  });

  it('命令序列在中途结束时报错', () => {
    expect(() => partsOf(new Uint8Array([9, 2]))).toThrow('几何在命令中途结束');
  });

  it('面按面积扣掉洞，线按长度，点按个数', () => {
    const polygon = firstFeature(encodeTile('a', [{ properties: {}, parts: [square(0, 0, 10), hole(2, 2, 4)] }]));
    expect(measureFeature(polygon)).toStrictEqual({ weight: 84, parts: 2 });
    const line = firstFeature(encodeTile('a', [{ geometry: 2, properties: {}, parts: [[0, 0, 3, 4]] }]));
    expect(measureFeature(line)).toStrictEqual({ weight: 5, parts: 1 });
    const points = firstFeature(encodeTile('a', [{ geometry: 1, properties: {}, parts: [[1, 2], [3, 4], [5, 6]] }]));
    expect(measureFeature(points)).toStrictEqual({ weight: 3, parts: 3 });
  });
});

describe('一张瓦片的概况', () => {
  it('合并的瓦片：一个面占全部，部件很多；同一张瓦片的线和点不算', () => {
    expect(summaryOf(mergedTile('233'))).toMatchObject({
      x: 1,
      y: 2,
      features: 1,
      largestShare: 1,
      largestParts: 12,
      values: [{ value: '233', share: 1 }]
    });
  });

  it('取值按面积算比例，从大到小', () => {
    const tile = encodeTile('a', [
      { properties: { lin_zhong: '114' }, parts: [square(0, 0, 10)] },
      { properties: { lin_zhong: '233' }, parts: [square(20, 0, 30)] }
    ]);
    const summary = summaryOf(tile);
    expect(summary.values).toStrictEqual([
      { value: '233', share: 0.9 },
      { value: '114', share: 0.1 }
    ]);
    expect(summary.largestShare).toBe(0.9);
    expect(summary.largestParts).toBe(1);
  });

  it('和前端一样按原样的字段名取值：没有字段、空字符串分开显示，大写的字段名算没有', () => {
    const tile = encodeTile('a', [
      { properties: { LIN_ZHONG: '233' }, parts: [square(0, 0, 10)] },
      { properties: { lin_zhong: '' }, parts: [square(0, 0, 10)] }
    ]);
    expect(summaryOf(tile).values.map(({ value }) => value).toSorted()).toStrictEqual(['(无字段)', '(空)']);
  });

  it('聚合要素单独计数', () => {
    const tile = encodeTile('a', [
      { properties: { lin_zhong: '1', clustered: true }, parts: [square(0, 0, 10)] },
      { properties: { lin_zhong: '1' }, parts: [square(20, 0, 10)] }
    ]);
    expect(summaryOf(tile).clustered).toBe(1);
  });

  it('没有几何的面积时比例是 0，不是 NaN', () => {
    const tile = encodeTile('a', [{ properties: { lin_zhong: '1' }, parts: [[0, 0, 0, 0, 0, 0]] }]);
    expect(summaryOf(tile)).toMatchObject({ largestShare: 0, values: [{ value: '1', share: 0 }] });
  });
});

describe('一个级别的判断', () => {
  const merged = summaryOf(mergedTile('233'));
  // 太湖这样真实的大面：比例高，部件少
  const bigLake = summaryOf(encodeTile('a', [{ properties: { lin_zhong: '1' }, parts: [square(0, 0, 4000)] }]));
  const absent = summaryOf(encodeTile('a', []));

  it('大部分瓦片合并时算合并；没有要素的瓦片不算', () => {
    expect(verdictOf([merged, merged, merged, merged, bigLake])).toBe('merged');
    expect(verdictOf([merged, absent, absent])).toBe('merged');
  });

  it('只有一部分合并时算部分合并', () => {
    expect(verdictOf([merged, bigLake, bigLake, bigLake])).toBe('partial');
  });

  it('真实的大面不算合并', () => {
    expect(verdictOf([bigLake, bigLake])).toBe('normal');
  });

  it('全是空瓦片时是没有要素', () => {
    expect(verdictOf([absent])).toBe('empty');
    expect(verdictOf([])).toBe('empty');
  });
});

describe('要查的瓦片', () => {
  it('低级别是覆盖全省的整个网格', () => {
    const tiles = tilesToCheck(7, 25);
    expect(tiles).toHaveLength(9);
    expect(tiles[0]).toStrictEqual({ x: 105, y: 50 });
    expect(tiles.at(-1)).toStrictEqual({ x: 107, y: 52 });
  });

  it('放不下时不超过上限，不重复，包括抽样城市所在的瓦片', () => {
    const tiles = tilesToCheck(10, 12);
    const keys = tiles.map(({ x, y }) => `${x}/${y}`);
    expect(tiles.length).toBeLessThanOrEqual(12);
    expect(new Set(keys).size).toBe(keys.length);
    const { x, y } = tileAt(118.8, 32.05, 10);
    expect(keys).toContain(`${x}/${y}`);
    // 除了城市，还在网格里均匀取了别的瓦片
    expect(tiles.length).toBeGreaterThan(4);
  });
});

describe('要查的瓦片的上限', () => {
  it('上限比抽样的城市少时也不超过上限', () => {
    expect(tilesToCheck(10, 2)).toHaveLength(2);
  });
});

describe('--tile-check 的写法', () => {
  it('不写字段时按分类规则的字段', () => {
    expect(parseTileCheckTargets('lcsh_sltb, bgdc_dltb')).toStrictEqual([
      { code: 'lcsh_sltb', field: 'lin_zhong' },
      { code: 'bgdc_dltb', field: 'dlbm' }
    ]);
  });

  it('可以指定字段；瓦片里没有 dlmc 的地类图斑（城镇村）按 dlbm', () => {
    expect(parseTileCheckTargets('szy_kt:name,bgdc_dltb_czc')).toStrictEqual([
      { code: 'szy_kt', field: 'name' },
      { code: 'bgdc_dltb_czc', field: 'dlbm' }
    ]);
  });

  it('rules 是全部有分类规则的资源', () => {
    const targets = parseTileCheckTargets('rules');
    expect(targets).toHaveLength(51);
    expect(targets).toContainEqual({ code: 'bgdc_dltb_czc', field: 'dlbm' });
  });

  it('没有规则又没写字段时报错', () => {
    expect(() => parseTileCheckTargets('bgdc_xzq')).toThrow('bgdc_xzq 没有分类规则');
  });
});

const TREE = {
  code: 200,
  data: [
    {
      code: null,
      name: '林草湿荒',
      children: [
        { code: 'lcsh_sltb', name: '森林分布图斑', geoType: 'Polygon', yearList: [2023, 2024] },
        { code: 'csxhjctb_lrdl', name: '公路线层', geoType: 'Line', yearList: [2025] },
        { code: 'csxhjctb_hydl', name: '水域线层', geoType: 'LineString', yearList: [2025] }
      ]
    }
  ]
};

const OPTIONS: TileCheckOptions = {
  baseUrl: 'http://backend.test',
  token: 'secret-token',
  codes: null,
  years: 'latest',
  zooms: [7, 11],
  concurrency: 2,
  exact: false,
  exactLimit: 500000,
  refresh: false,
  timeoutSeconds: 120,
  tilesPerZoom: 4
};

interface FakeBackend {
  readonly io: TileCheckIO;
  readonly requests: string[];
  readonly tokens: (string | null)[];
  readonly saved: (readonly TileCheckResult[])[];
}

function fakeBackend(handleTile: (zoom: number, x: number, y: number) => Response): FakeBackend {
  const requests: string[] = [];
  const tokens: (string | null)[] = [];
  const saved: (readonly TileCheckResult[])[] = [];
  return {
    requests,
    tokens,
    saved,
    io: {
      fetch: (input, init) => {
        const url = new URL(input instanceof Request ? input.url : input);
        requests.push(url.pathname);
        tokens.push(new Headers(init?.headers).get('token'));
        if (url.pathname === '/resource-map/base/tree') {
          return Promise.resolve(Response.json(TREE));
        }
        const match = /\/(\d+)\/(\d+)\/(\d+)\.pbf$/.exec(url.pathname);
        return Promise.resolve(handleTile(Number(match?.[1]), Number(match?.[2]), Number(match?.[3])));
      },
      sleep: () => Promise.resolve(),
      log: () => undefined,
      save: results => saved.push([...results])
    }
  };
}

const tileResponse = (tile: Uint8Array) => new Response(tile.slice());

// 低级别合并、高级别是真实的要素：森林的情况
function forestBackend() {
  return fakeBackend((zoom, x) => {
    if (zoom < 11) {
      return tileResponse(mergedTile(x % 2 === 0 ? '233' : '114'));
    }
    return tileResponse(
      encodeTile('lcsh_sltb_2024', [
        { properties: { lin_zhong: '233' }, parts: [square(0, 0, 30)] },
        { properties: { lin_zhong: '114' }, parts: [square(40, 0, 10)] }
      ])
    );
  });
}

describe('探查瓦片', () => {
  it('低级别判断为合并，高级别没有合并；取最新一年，带 token，每查完一个瓦片集存一次', async () => {
    const { io, requests, tokens, saved } = forestBackend();
    const [result] = await runTileCheck([{ code: 'lcsh_sltb', field: 'lin_zhong' }], OPTIONS, io);
    expect(result).toMatchObject({ tileset: 'lcsh_sltb_2024', name: '森林分布图斑', geometry: 'polygon' });
    expect(result?.sourceLayers).toStrictEqual(['lcsh_sltb_2024']);
    expect(result?.zooms.map(({ zoom, verdict }) => [zoom, verdict])).toStrictEqual([
      [7, 'merged'],
      [11, 'normal']
    ]);
    expect(requests.filter(path => path.includes('/api/tiles/lcsh_sltb_2024/7/'))).toHaveLength(4);
    expect(requests.some(path => path.includes('lcsh_sltb_2023'))).toBe(false);
    expect(new Set(tokens)).toStrictEqual(new Set(['secret-token']));
    expect(saved).toHaveLength(1);
  });

  it('线层按线算，同一张瓦片里的面不算', async () => {
    const { io } = fakeBackend(() =>
      tileResponse(
        encodeTile('a', [
          { geometry: 2, properties: { ccn: '河流' }, parts: [[0, 0, 30, 0]] },
          { geometry: 2, properties: { ccn: '水渠' }, parts: [[0, 0, 10, 0]] },
          { geometry: 3, properties: { ccn: '坑塘' }, parts: [square(0, 0, 100)] }
        ])
      )
    );
    const [result] = await runTileCheck([{ code: 'csxhjctb_hydl', field: 'ccn' }], OPTIONS, io);
    expect(result?.geometry).toBe('line');
    expect(result?.zooms[0]?.values).toStrictEqual([
      { value: '河流', share: 0.75 },
      { value: '水渠', share: 0.25 }
    ]);
  });

  it('跳过重资源的最小显示级别以下', async () => {
    const { io, requests } = forestBackend();
    await runTileCheck([{ code: 'csxhjctb_lrdl', field: 'type' }], OPTIONS, io);
    expect(requests.some(path => path.includes('/csxhjctb_lrdl_2025/7/'))).toBe(false);
    expect(requests.some(path => path.includes('/csxhjctb_lrdl_2025/11/'))).toBe(true);
  });

  it('空瓦片、后端报错和网络失败都不中断；报错记下来，有要素的瓦片照常判断', async () => {
    let count = 0;
    const { io } = fakeBackend(() => {
      count += 1;
      if (count === 1) {
        return new Response(new Uint8Array());
      }
      if (count === 2) {
        return Response.json({ success: false, code: 500, msg: '系统异常' });
      }
      return tileResponse(mergedTile('233'));
    });
    const [result] = await runTileCheck(
      [{ code: 'lcsh_sltb', field: 'lin_zhong' }],
      { ...OPTIONS, zooms: [7] },
      io
    );
    const check = result?.zooms[0];
    expect(check?.requested).toBe(4);
    expect(check?.tiles).toHaveLength(2);
    expect(check?.verdict).toBe('merged');
    expect(check?.errors).toHaveLength(1);
    expect(check?.errors[0]).toContain('系统异常');
  });

  it('token 失效时整个探查停下来', async () => {
    const { io } = fakeBackend(() => new Response('', { status: 401 }));
    await expect(runTileCheck([{ code: 'lcsh_sltb', field: 'lin_zhong' }], OPTIONS, io)).rejects.toBeInstanceOf(ProbeAuthError);
  });

  it('资源树里没有这个资源时报错，不发瓦片请求', async () => {
    const { io, requests } = forestBackend();
    await expect(runTileCheck([{ code: 'nope', field: 'x' }], OPTIONS, io)).rejects.toThrow('资源树里没有 nope');
    expect(requests).toStrictEqual(['/resource-map/base/tree']);
  });
});

describe('报告', () => {
  it('连续的级别写成范围', () => {
    expect(zoomRanges([6, 7, 8, 10])).toBe('6～8、10');
    expect(zoomRanges([11])).toBe('11');
    expect(zoomRanges([])).toBe('-');
  });

  it('结论表列出合并的级别；低级别能和页面对照每张瓦片的取值，也能看出同一地点跨级别的跳变', async () => {
    const { io } = forestBackend();
    const results = await runTileCheck(
      [{ code: 'lcsh_sltb', field: 'lin_zhong' }],
      { ...OPTIONS, zooms: [7, 8, 11], tilesPerZoom: 9 },
      io
    );
    const report = formatTileCheck(results, 9);
    expect(report).toContain('| lcsh_sltb_2024 | 森林分布图斑 | lin_zhong | 7～8 | - | 11 |');
    expect(report).toContain('瓦片里的图层名：lcsh_sltb_2024');
    // 7 级查了整个网格：x 是偶数的瓦片是 233，奇数的是 114
    expect(report).toContain('| y \\ x | 105 | 106 | 107 |');
    expect(report).toContain('| 50 | 114 100% | 233 100% | 114 100% |');
    // 8 级的网格放不下，不画
    expect(report).not.toContain('8 级每张瓦片的主要取值');
    const nanjing = tileAt(118.8, 32.05, 7).x % 2 === 0 ? '233 100%' : '114 100%';
    expect(report).toContain(`| 南京 | ${nanjing} |`);
    // 高级别是真实的比例：边长 30 和 10 的两个面
    expect(report).toContain('233 90%');
  });

  it('有请求失败时列出来', () => {
    const report = formatTileCheck(
      [
        {
          tileset: 'a_2024',
          name: 'A',
          field: 'f',
          geometry: 'polygon',
          sourceLayers: [],
          zooms: [{ zoom: 7, requested: 1, tiles: [], mergedTiles: 0, verdict: 'empty', values: [], errors: ['105/50：系统异常'] }]
        }
      ],
      25
    );
    expect(report).toContain('- z7 105/50：系统异常');
    expect(report).toContain('瓦片里的图层名：-');
  });
});
