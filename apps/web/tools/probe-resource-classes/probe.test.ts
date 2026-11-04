// @vitest-environment node
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  addRecord,
  assessField,
  assessFields,
  emptySample,
  type FieldAssessment,
  findLabelFields,
  isPlaceholder,
  missingZooms,
  type SampleStats
} from './analyze.ts';
import { decodeTile, readTileBody } from './mvt.ts';
import {
  equalsCondition,
  flattenTree,
  notInCondition,
  ProbeAuthError,
  type ProbeIO,
  type ProbeOptions,
  runEnumerate,
  runProbe,
  samplePages,
  tileAt,
  type TilesetProbe,
  ZOOM_FLOORS
} from './probe.ts';
import {
  candidateRows,
  CURRENT_RULE_FIELDS,
  exactFieldsOf,
  formatSummary,
  slicingRows,
  summarizeResource,
  toCsv
} from './report.ts';
import { encodeTile } from './test-tile.ts';

function sampleOf(records: readonly Record<string, unknown>[]): SampleStats {
  const sample = emptySample();
  for (const record of records) {
    addRecord(sample, record);
  }
  return sample;
}

function assess(field: string, values: readonly unknown[]): FieldAssessment {
  const sample = sampleOf(values.map(value => ({ [field]: value })));
  const stats = sample.fields[field];
  if (!stats) {
    throw new Error(`样本里没有字段 ${field}`);
  }
  return assessField(field, stats, undefined);
}

const repeat = <T>(value: T, times: number): T[] => Array.from({ length: times }, () => value);

describe('瓦片解码', () => {
  it('读出图层名、几何类型和各种类型的属性，负的 int64 不丢符号', () => {
    const tile = encodeTile('csxhjctb_tyhda_2022', [
      { geometry: 3, properties: { cc: '08H213', quota: -9999, ratio: 0.5, flag: true } },
      { geometry: 1, properties: { cc: '08H211' } }
    ]);
    const [layer] = decodeTile(tile);
    expect(layer?.name).toBe('csxhjctb_tyhda_2022');
    expect(layer?.features[0]).toMatchObject({
      geometry: 'polygon',
      properties: { cc: '08H213', quota: -9999, ratio: 0.5, flag: true }
    });
    expect(layer?.features[1]?.geometry).toBe('point');
  });

  it('区分空内容、后端报错的 JSON 和 gzip 压缩的瓦片', () => {
    expect(readTileBody(new Uint8Array())).toEqual({ kind: 'empty' });
    const error = new TextEncoder().encode('{"success":false,"code":500,"data":null,"msg":"系统异常"}');
    expect(readTileBody(error)).toEqual({ kind: 'error', message: '系统异常' });
    const compressed = new Uint8Array(gzipSync(encodeTile('a', [{ properties: { x: 'y' } }])));
    const body = readTileBody(compressed);
    expect(body.kind === 'tile' && body.layers[0]?.features[0]?.properties).toEqual({ x: 'y' });
  });

  it('内容不是瓦片时报告解码失败，不抛错', () => {
    expect(readTileBody(new Uint8Array([0x1a, 0xff])).kind).toBe('error');
  });
});

describe('分类字段的识别', () => {
  it('-9999、-999、空值和文字的 null 算没有值', () => {
    for (const value of [null, undefined, '', ' ', -9999, '-9999', -999, '-999', 'null']) {
      expect(isPlaceholder(value)).toBe(true);
    }
    for (const value of [0, '0', '-', '河流']) {
      expect(isPlaceholder(value)).toBe(false);
    }
  });

  it('按名称排除标识、区划、时间、度量和聚合字段', () => {
    const values = [...repeat('a', 30), ...repeat('b', 30)];
    for (const [field, reason] of [
      ['guid', '标识'],
      ['xzqdm', '区划或权属单位'],
      ['intersect_region_code', '区划或权属单位'],
      ['gxsj', '时间'],
      ['tbmj', '度量'],
      ['clustered', '瓦片的聚合字段'],
      ['bz', '说明']
    ] as const) {
      expect(assess(field, values)).toMatchObject({ verdict: 'rejected', reasons: [reason] });
    }
  });

  it('否决只有一个取值、全是占位值、接近唯一值和连续数值的字段', () => {
    expect(assess('type', repeat('小学', 50)).reasons).toEqual(['只有一个取值']);
    expect(assess('type', repeat('-9999', 50)).reasons).toEqual(['全部没有值']);
    const unique = Array.from({ length: 40 }, (_, index) => `名称${index}`);
    expect(assess('foo', unique).reasons).toEqual(['接近唯一值']);
    const numbers = Array.from({ length: 100 }, (_, index) => index % 30);
    expect(assess('score', numbers).reasons).toEqual(['连续数值，适合分级，不适合分类']);
  });

  it('取值过多的字段被否决，标准字段放宽到能放下表 A.2', () => {
    const many = Array.from({ length: 300 }, (_, index) => `v${index % 69}`);
    expect(assess('foo', many).reasons[0]).toContain('取值过多');
    expect(assess('dlbm', many).verdict).toBe('recommended');
  });

  it('常见分类字段取值均衡时建议采用，占位值不算取值、写进说明', () => {
    const result = assess('type', [...repeat('小学', 30), ...repeat('初级中学', 20), ...repeat('-9999', 10)]);
    expect(result).toMatchObject({ verdict: 'recommended', distinct: 2 });
    expect(result.fillRate).toBeCloseTo(50 / 60);
    expect(result.reasons.join()).toContain('占位值');
  });

  it('字段名没有特征、取值也少的字段不直接建议，只作备选', () => {
    expect(assess('foo', [...repeat('a', 30), ...repeat('b', 30)]).verdict).toBe('possible');
  });

  it('一个取值占绝大多数时不直接建议，写明原因', () => {
    const result = assess('cc', [...repeat('a', 97), ...repeat('b', 3)]);
    expect(result.verdict).toBe('possible');
    expect(result.reasons.join()).toContain('一个取值占 97%');
  });

  it('只有少数要素有值的字段不直接建议', () => {
    const result = assess('type', [...repeat('河流', 15), ...repeat('运河', 15), ...repeat('-9999', 70)]);
    expect(result.verdict).toBe('possible');
    expect(result.reasons.join()).toContain('只有 30% 的要素有值');
  });

  it('提示字符串和数字混用：match 的标签是字符串时数字匹配不上', () => {
    const result = assess('czclx', [...repeat('201', 30), ...repeat(202, 30)]);
    expect(result.mixedTypes).toBe(true);
    expect(result.reasons.join()).toContain('混用');
  });

  it('找出一一对应的编码和名称字段，编码作候选、名称作它的显示名称', () => {
    const records = [
      ...repeat({ cc: '08H211', ccn: '高等院校', name: 'A' }, 20),
      ...repeat({ cc: '08H213', ccn: '中小学', name: 'B' }, 30)
    ];
    const sample = sampleOf(records);
    const labels = findLabelFields(records, sample);
    expect(labels.cc).toEqual({ field: 'ccn', labels: { '08H211': '高等院校', '08H213': '中小学' } });
    const [best, second] = assessFields(sample, labels);
    expect(best).toMatchObject({ field: 'cc', labelField: 'ccn', verdict: 'recommended' });
    expect(second).toMatchObject({ field: 'ccn', verdict: 'possible' });
  });

  it('编码和名称不是一一对应时不配对', () => {
    const records = [
      ...repeat({ cc: 'a', ccn: '甲' }, 10),
      ...repeat({ cc: 'a', ccn: '乙' }, 10),
      ...repeat({ cc: 'b', ccn: '丙' }, 10)
    ];
    expect(findLabelFields(records, sampleOf(records))).toEqual({});
  });

  it('多个编码对应同一个名称时不配对：名称区分不了这些编码', () => {
    const records = [...repeat({ cc: 'a', ccn: '甲' }, 10), ...repeat({ cc: 'b', ccn: '甲' }, 10)];
    expect(findLabelFields(records, sampleOf(records))).toEqual({});
  });

  it('名称字段要覆盖编码的全部记录：只在部分记录上有值的字段不算（医疗机构的 ifidh 曾被当成 cc 的名称）', () => {
    const records = [
      ...repeat({ cc: '08H222', ifidh: '-9999', ccn: '社区卫生服务设施' }, 60),
      ...repeat({ cc: '08H221', ifidh: '否', ccn: '医院' }, 14),
      { cc: '08H221A', ifidh: '-9999', ccn: '方舱医院' }
    ];
    expect(findLabelFields(records, sampleOf(records)).cc).toEqual({
      field: 'ccn',
      labels: { '08H222': '社区卫生服务设施', '08H221': '医院', '08H221A': '方舱医院' }
    });
  });

  it('只有部分编码有值的字段不算名称，哪怕它和这部分编码一一对应', () => {
    const records = [
      ...repeat({ cc: 'a', note: '甲', ccn: '一' }, 10),
      ...repeat({ cc: 'b', note: '乙', ccn: '二' }, 10),
      ...repeat({ cc: 'c', note: '-9999', ccn: '三' }, 60)
    ];
    expect(findLabelFields(records, sampleOf(records)).cc?.field).toBe('ccn');
  });

  it('只有一个取值的字段不是编码（实测 sjnf 配上了 ifcon）', () => {
    const records = [...repeat({ sjnf: 2025, ifcon: '是' }, 40), { sjnf: 2025, ifcon: '否' }];
    expect(findLabelFields(records, sampleOf(records))).toEqual({});
  });

  it('名称字段的值大多和编码无关时不配对（实测 ecrm 配上了 type）', () => {
    const records = [
      ...repeat({ ecrm: 1, type: '常年河' }, 40),
      { ecrm: 4, type: '常年河' },
      ...repeat({ ecrm: -9999, type: '常年河' }, 45)
    ];
    expect(findLabelFields(records, sampleOf(records))).toEqual({});
  });

  it('低级别的瓦片没有编码字段时，这些记录不影响配对', () => {
    const records = [
      ...repeat({ cc: 'a', ccn: '甲' }, 10),
      ...repeat({ cc: 'b', ccn: '乙' }, 10),
      ...repeat({ ccn: '甲' }, 500)
    ];
    expect(findLabelFields(records, sampleOf(records)).cc?.field).toBe('ccn');
  });

  it('变化标记和是否标记不算分类（实测 changetype 因为名字以 type 结尾被当成分类字段）', () => {
    const values = [...repeat('是', 30), ...repeat('否', 30)];
    for (const [field, reason] of [
      ['changetype', '变化标记'],
      ['ifcon', '是否标记'],
      ['ifidh', '是否标记'],
      ['isar', '是否标记']
    ] as const) {
      expect(assess(field, values)).toMatchObject({ verdict: 'rejected', reasons: [reason] });
    }
  });

  it('只有少数要素有值、但几乎每个都不同的字段也算接近唯一值（实测 lrcode）', () => {
    const codes = Array.from({ length: 8 }, (_, index) => `ECA${index}`);
    expect(assess('lrcode', [...codes, ...repeat('-9999', 755)]).reasons).toEqual(['接近唯一值']);
  });

  it('监测图层的地类字段是变化前的地类，不直接建议；地类图层照常', () => {
    const records = [
      ...repeat({ dlbm: '08H2', dlmc: '科教文卫用地' }, 30),
      ...repeat({ dlbm: '0701', dlmc: '城镇住宅用地' }, 20)
    ];
    const sample = sampleOf(records);
    const labels = findLabelFields(records, sample);
    const dlbmOf = (code: string) => assessFields(sample, labels, code).find(item => item.field === 'dlbm');
    expect(dlbmOf('csxhjctb_tyhda')?.verdict).toBe('possible');
    expect(dlbmOf('csxhjctb_tyhda')?.reasons.join()).toContain('变化（或细化）前');
    expect(dlbmOf('bgdc_dltb')?.verdict).toBe('recommended');
  });

  it('有用 / 拼接的复合取值时不直接建议，写明要先归并（实测学校的 type）', () => {
    const result = assess('type', [...repeat('小学', 30), ...repeat('初级中学', 28), ...repeat('初级中学/小学', 2)]);
    expect(result.verdict).toBe('possible');
    expect(result.reasons.join()).toContain('初级中学/小学');
  });

  it('报告字段在哪些瓦片级别上缺失；没有要素的级别不算缺失', () => {
    const tiles = [
      { zoom: 7, stats: sampleOf(repeat({ bsm: '1' }, 10)) },
      { zoom: 9, stats: emptySample() },
      { zoom: 14, stats: sampleOf(repeat({ bsm: '1', cc: 'a' }, 10)) }
    ];
    expect(missingZooms(tiles, 'cc')).toEqual([7]);
  });
});

// 脚本不导入登记表（要能单独运行），测试核对两边一致。tools 的类型检查不认 src 的路径别名，所以用变量路径动态导入
interface RegistryModule {
  readonly resourceStyle: (code: string) => {
    readonly minzoom?: number;
    readonly color?:
      | { readonly kind: 'values' | 'ordered'; readonly property: string }
      | { readonly kind: 'landuse-code' | 'landuse-name' };
  };
}

async function loadRegistry(): Promise<RegistryModule> {
  const path = '../../src/features/resource-map/style-registry';
  return (await import(/* @vite-ignore */ path)) as RegistryModule;
}

describe('和样式登记表一致', () => {
  it('跳过的低级别等于资源的最小显示级别', async () => {
    const { resourceStyle } = await loadRegistry();
    const floors = Object.keys(ZOOM_FLOORS).map(code => [code, resourceStyle(code).minzoom]);
    expect(Object.fromEntries(floors)).toEqual(ZOOM_FLOORS);
  });

  it('现有规则的字段和登记表一致', async () => {
    const { resourceStyle } = await loadRegistry();
    const fieldOf = (code: string) => {
      const rule = resourceStyle(code).color;
      if (rule?.kind === 'values' || rule?.kind === 'ordered') {
        return rule.property;
      }
      return rule?.kind === 'landuse-code' ? 'dlbm' : rule?.kind === 'landuse-name' ? 'dlmc' : undefined;
    };
    const fields = Object.keys(CURRENT_RULE_FIELDS).map(code => [code, fieldOf(code)]);
    expect(Object.fromEntries(fields)).toEqual(CURRENT_RULE_FIELDS);
  });
});

describe('请求的小工具', () => {
  it('资源树按 code 合并年份，分类路径取第一次出现的', () => {
    const tree = [
      {
        code: null,
        name: '基础库',
        children: [
          {
            code: 'land',
            name: '土地资源',
            children: [
              { code: 'a', name: '甲', geoType: 'Polygon', yearList: [2023] },
              { code: 'a', name: '甲', geoType: 'Polygon', yearList: [2022] }
            ]
          }
        ]
      }
    ];
    expect(flattenTree(tree)).toEqual([
      { code: 'a', name: '甲', geoType: 'Polygon', years: [2022, 2023], category: '基础库 / 土地资源' }
    ]);
  });

  it('瓦片坐标：南京 z7、z14', () => {
    // 反算：z14 的 y = 6650 对应纬度 atan(sinh(π(1 − 2 × 6650 / 16384))) ≈ 32.05°
    expect(tileAt(118.8, 32.05, 7)).toEqual({ x: 106, y: 51 });
    expect(tileAt(118.8, 32.05, 14)).toEqual({ x: 13598, y: 6650 });
  });

  it('抽样的页码：小表读完，大表首尾和中间均匀取', () => {
    expect(samplePages(0, 200, 4)).toEqual([1]);
    expect(samplePages(500, 200, 4)).toEqual([1, 2, 3]);
    expect(samplePages(20000, 200, 4)).toEqual([1, 34, 67, 100]);
  });

  it('条件里的单引号要双写，不能拼坏 SQL', () => {
    expect(equalsCondition('type', "a'b")).toBe(`"type" = 'a''b'`);
  });
});

const TREE = {
  code: 200,
  data: [
    {
      code: null,
      name: '主题库',
      children: [
        { code: 'csxhjctb_tyhda', name: '学校面层', geoType: 'Polygon', yearList: [2022, 2023] },
        { code: 'szy_kt', name: '坑塘', geoType: 'Polygon', yearList: [2024] }
      ]
    }
  ]
};

function schoolRecords(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    guid: `g${index}`,
    CC: index % 3 === 0 ? '08H211' : '08H213',
    CCN: index % 3 === 0 ? '高等院校' : '中小学',
    TYPE: index % 2 === 0 ? '小学' : '初级中学',
    NAME: `学校${index}`
  }));
}

function urlOf(input: string | URL | Request): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

interface FakeBackend {
  readonly io: ProbeIO;
  readonly requests: string[];
  readonly headers: (string | null)[];
  readonly saved: Map<string, TilesetProbe>;
}

function fakeBackend(handle?: (url: URL) => Response | undefined, cached?: Map<string, TilesetProbe>): FakeBackend {
  const requests: string[] = [];
  const headers: (string | null)[] = [];
  const saved = cached ?? new Map<string, TilesetProbe>();
  const fetch: typeof globalThis.fetch = (input, init) => {
    const url = new URL(urlOf(input));
    requests.push(url.pathname + url.search);
    headers.push(new Headers(init?.headers).get('token'));
    const custom = handle?.(url);
    if (custom) {
      return Promise.resolve(custom);
    }
    if (url.pathname === '/resource-map/base/tree') {
      return Promise.resolve(Response.json(TREE));
    }
    if (url.pathname === '/api/query/attr/page') {
      const layerCode = url.searchParams.get('layerCode');
      if (layerCode?.startsWith('szy_')) {
        return Promise.resolve(Response.json({ success: false, code: 500, msg: '系统异常' }));
      }
      const conditions = url.searchParams.get('conditions');
      if (conditions) {
        return Promise.resolve(Response.json({ total: conditions.includes('08H211') ? 100 : 180, list: [] }));
      }
      return Promise.resolve(Response.json({ total: 300, list: schoolRecords(150) }));
    }
    const tile = /^\/api\/tiles\/([^/]+)\/(\d+)\//.exec(url.pathname);
    if (tile?.[1]?.startsWith('szy_')) {
      return Promise.resolve(Response.json({ success: false, code: 500, msg: '系统异常' }));
    }
    // 低级别的瓦片只带 ccn，14 级才带 cc
    const zoom = Number(tile?.[2]);
    const properties: Record<string, string | boolean> =
      zoom >= 14 ? { cc: '08H211', ccn: '高等院校' } : { ccn: '高等院校', clustered: zoom < 9 };
    const features = Array.from({ length: 800 }, () => ({ properties }));
    return Promise.resolve(new Response(encodeTile(tile?.[1] ?? 'x', features).slice()));
  };
  return {
    requests,
    headers,
    saved,
    io: {
      fetch,
      sleep: () => Promise.resolve(),
      log: () => undefined,
      load: tileset => saved.get(tileset) ?? null,
      save: probe => saved.set(probe.tileset, probe)
    }
  };
}

const OPTIONS: ProbeOptions = {
  baseUrl: 'http://backend.test',
  token: 'secret-token',
  codes: null,
  years: 'latest',
  zooms: [7, 14],
  concurrency: 2,
  exact: false,
  exactLimit: 500000,
  refresh: false,
  timeoutSeconds: 120
};

describe('探查', () => {
  it('每个请求都带 token；有瓦片和没有瓦片的资源分别得出结论', async () => {
    const backend = fakeBackend();
    const result = await runProbe(OPTIONS, backend.io, exactFieldsOf);
    expect(backend.headers.every(token => token === 'secret-token')).toBe(true);
    expect(result.probes.map(probe => probe.tileset).toSorted()).toEqual(['csxhjctb_tyhda_2023', 'szy_kt_2024']);
    const [school, water] = result.resources.map(resource => summarizeResource(resource, result.probes));
    expect(school).toMatchObject({ status: 'candidate' });
    expect(water).toMatchObject({ status: 'no-tiles', primary: null });
  });

  it('瓦片报错时不再请求别的城市', async () => {
    const backend = fakeBackend();
    await runProbe({ ...OPTIONS, codes: new Set(['szy_kt']), zooms: [14] }, backend.io, exactFieldsOf);
    expect(backend.requests.filter(request => request.startsWith('/api/tiles/'))).toHaveLength(1);
  });

  it('取够要素就不再请求别的城市', async () => {
    const backend = fakeBackend();
    await runProbe({ ...OPTIONS, codes: new Set(['csxhjctb_tyhda']), zooms: [14] }, backend.io, exactFieldsOf);
    // 每张 800 个要素，取够 1500 要两张
    expect(backend.requests.filter(request => request.startsWith('/api/tiles/'))).toHaveLength(2);
  });

  it('重的资源不请求低于最小显示级别的瓦片', async () => {
    const tree = { code: 200, data: [{ code: 'csxhjctb_lrdl', name: '公路线层', geoType: 'Line', yearList: [2025] }] };
    const backend = fakeBackend(url => (url.pathname === '/resource-map/base/tree' ? Response.json(tree) : undefined));
    await runProbe({ ...OPTIONS, zooms: [7, 8, 9, 11] }, backend.io, exactFieldsOf);
    const zooms = backend.requests.flatMap(request => /^\/api\/tiles\/[^/]+\/(\d+)\//.exec(request)?.[1] ?? []);
    expect(new Set(zooms)).toEqual(new Set(['9', '11']));
  });

  it('所有年份都探查；有缓存的瓦片集不再请求', async () => {
    const backend = fakeBackend();
    const options = { ...OPTIONS, codes: new Set(['csxhjctb_tyhda']), years: 'all' } as const;
    await runProbe(options, backend.io, exactFieldsOf);
    expect([...backend.saved.keys()].toSorted()).toEqual(['csxhjctb_tyhda_2022', 'csxhjctb_tyhda_2023']);
    const again = fakeBackend(undefined, backend.saved);
    await runProbe(options, again.io, exactFieldsOf);
    expect(again.requests).toEqual(['/resource-map/base/tree']);
  });

  it('旧版本脚本留下的缓存不用：识别规则改过，旧结果里的名称字段可能是错的', async () => {
    const backend = fakeBackend();
    const options = { ...OPTIONS, codes: new Set(['csxhjctb_tyhda']) };
    await runProbe(options, backend.io, exactFieldsOf);
    const stale = new Map([...backend.saved].map(([key, probe]) => [key, { ...probe, version: 1 }]));
    const again = fakeBackend(undefined, stale);
    await runProbe(options, again.io, exactFieldsOf);
    expect(again.requests.length).toBeGreaterThan(1);
    expect(again.saved.get('csxhjctb_tyhda_2023')?.version).toBeGreaterThan(1);
  });

  it('超大的表只读第一页：深分页要 OFFSET，后端共用', async () => {
    const backend = fakeBackend(url =>
      url.pathname === '/api/query/attr/page' ? Response.json({ total: 3_000_000, list: schoolRecords(200) }) : undefined
    );
    await runProbe({ ...OPTIONS, codes: new Set(['csxhjctb_tyhda']) }, backend.io, exactFieldsOf);
    expect(backend.requests.filter(request => request.startsWith('/api/query/attr/page'))).toHaveLength(1);
  });

  it('后面的页失败时保留已取到的数据，错误记下来', async () => {
    const backend = fakeBackend(url => {
      if (url.pathname === '/api/query/attr/page' && url.searchParams.get('pageNum') !== '1') {
        return Response.json({ success: false, code: 500, msg: '系统异常' });
      }
      return url.pathname === '/api/query/attr/page' ? Response.json({ total: 2000, list: schoolRecords(200) }) : undefined;
    });
    const result = await runProbe({ ...OPTIONS, codes: new Set(['csxhjctb_tyhda']) }, backend.io, exactFieldsOf);
    expect(result.failures).toEqual([]);
    expect(result.probes[0]?.attributes).toMatchObject({ total: 2000, sampled: 200, error: '系统异常' });
  });

  it('--refresh 不用缓存', async () => {
    const backend = fakeBackend();
    const options = { ...OPTIONS, codes: new Set(['csxhjctb_tyhda']) };
    await runProbe(options, backend.io, exactFieldsOf);
    const again = fakeBackend(undefined, backend.saved);
    await runProbe({ ...options, refresh: true }, again.io, exactFieldsOf);
    expect(again.requests.length).toBeGreaterThan(1);
  });

  it('后端不回应时重试；重试后成功的结果照常', async () => {
    let tileFailures = 2;
    const failing = fakeBackend();
    const flaky: ProbeIO = {
      ...failing.io,
      fetch: (input, init) => {
        if (urlOf(input).includes('/api/tiles/') && tileFailures > 0) {
          tileFailures -= 1;
          return Promise.reject(new TypeError('fetch failed: Empty reply from server'));
        }
        return failing.io.fetch(input, init);
      }
    };
    const result = await runProbe({ ...OPTIONS, codes: new Set(['csxhjctb_tyhda']), zooms: [14] }, flaky, exactFieldsOf);
    expect(result.failures).toEqual([]);
    expect(result.probes).toHaveLength(1);
  });

  it('超时不重试：重试只会给后端多压几次重查询，错误写明', async () => {
    let attempts = 0;
    const base = fakeBackend();
    const slow: ProbeIO = {
      ...base.io,
      fetch: (input, init) => {
        if (urlOf(input).includes('/api/query/attr/page')) {
          attempts += 1;
          return Promise.reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
        }
        return base.io.fetch(input, init);
      }
    };
    const [result] = await runEnumerate([{ code: 'szy_kt', field: 'f' }], OPTIONS, slow);

    expect(attempts).toBe(1);
    expect(result).toMatchObject({ remaining: null, error: 'The operation was aborted due to timeout' });
  });

  it('重试后仍失败的瓦片集记下来、不写缓存，其他继续', async () => {
    const failing = fakeBackend();
    const flaky: ProbeIO = {
      ...failing.io,
      fetch: (input, init) =>
        urlOf(input).includes('/api/tiles/csxhjctb_tyhda')
          ? Promise.reject(new TypeError('fetch failed'))
          : failing.io.fetch(input, init)
    };
    const result = await runProbe(OPTIONS, flaky, exactFieldsOf);
    expect(result.failures).toEqual([{ tileset: 'csxhjctb_tyhda_2023', message: 'fetch failed' }]);
    expect(failing.saved.has('csxhjctb_tyhda_2023')).toBe(false);
    expect(failing.saved.has('szy_kt_2024')).toBe(true);
  });

  it('token 失效时整个探查停下来，不继续请求', async () => {
    const backend = fakeBackend(url => (url.pathname.startsWith('/api/') ? new Response('', { status: 401 }) : undefined));
    await expect(runProbe(OPTIONS, backend.io, exactFieldsOf)).rejects.toBeInstanceOf(ProbeAuthError);
  });

  it('--exact 查候选字段的准确分布，算出样本外的数量', async () => {
    const backend = fakeBackend();
    const options = { ...OPTIONS, codes: new Set(['csxhjctb_tyhda']), exact: true };
    const { probes } = await runProbe(options, backend.io, exactFieldsOf);
    const conditions = backend.requests
      .filter(request => request.includes('pageSize=1&') || request.endsWith('pageSize=1'))
      .map(request => new URL(request, 'http://x').searchParams.get('conditions'));
    expect(conditions).toContain(`"cc" = '08H211'`);
    expect(probes[0]?.exact?.cc).toEqual({ counts: { '08H213': 180, '08H211': 100 }, other: 20 });
    // 建议的字段一定要查，哪怕它不是评分最高的
    expect(conditions).toContain(`"ccn" = '高等院校'`);
  });

  it('不加 --exact 时不查准确分布；加了也只查最新一年', async () => {
    const backend = fakeBackend();
    const options = { ...OPTIONS, codes: new Set(['csxhjctb_tyhda']), years: 'all' } as const;
    const { probes } = await runProbe(options, backend.io, exactFieldsOf);
    expect(probes.every(probe => probe.exact === undefined)).toBe(true);
    const again = fakeBackend();
    const exact = await runProbe({ ...options, exact: true }, again.io, exactFieldsOf);
    const withExact = exact.probes.filter(probe => probe.exact !== undefined).map(probe => probe.year);
    expect(withExact).toEqual([2023]);
  });

  it('超过上限的表不查准确分布', async () => {
    const backend = fakeBackend();
    const options = { ...OPTIONS, codes: new Set(['csxhjctb_tyhda']), exact: true, exactLimit: 100 };
    const { probes } = await runProbe(options, backend.io, exactFieldsOf);
    expect(probes[0]?.exact).toEqual({});
    expect(backend.requests.some(request => request.includes('pageSize=1&'))).toBe(false);
  });
});

async function probed() {
  const result = await runProbe(OPTIONS, fakeBackend().io, exactFieldsOf);
  return { result, summaries: result.resources.map(resource => summarizeResource(resource, result.probes)) };
}

describe('枚举字段的全部取值', () => {
  // 少见的取值在第一页之后，空字符串和 NULL 混在里面
  const ROWS = [
    ...repeat({ LIN_ZHONG: '233' }, 300),
    ...repeat({ LIN_ZHONG: '111' }, 5),
    { LIN_ZHONG: '' },
    { LIN_ZHONG: "12'7" },
    { LIN_ZHONG: null }
  ];

  function enumerating() {
    return fakeBackend(url => {
      if (url.pathname !== '/api/query/attr/page') {
        return undefined;
      }
      const condition = url.searchParams.get('conditions') ?? '';
      const list = condition.includes('NOT IN') ? condition.slice(condition.indexOf('(')) : '';
      const excluded = new Set([...list.matchAll(/'((?:[^']|'')*)'/g)].map(match => (match[1] ?? '').replaceAll("''", "'")));
      const rows = ROWS.filter(({ LIN_ZHONG }) => LIN_ZHONG !== null && !excluded.has(LIN_ZHONG));
      return Response.json({ total: rows.length, list: rows.slice(0, 200) });
    });
  }
  const target = [{ code: 'szy_kt', field: 'lin_zhong' }];

  it('条件：没有已知取值时查非空，单引号双写', () => {
    expect(notInCondition('f', [])).toBe('"f" IS NOT NULL');
    expect(notInCondition('f', ['a', "b'c"])).toBe(`"f" NOT IN ('a','b''c')`);
  });

  it('一轮轮排除已知取值，直到没有记录：第一页之后的少见取值也能找到，NULL 不算', async () => {
    const [result] = await runEnumerate(target, OPTIONS, enumerating().io);

    expect(result).toMatchObject({ tileset: 'szy_kt_2024', remaining: 0, error: null });
    expect(result?.values).toStrictEqual(['', '111', "12'7", '233']);
  });

  it('从抽样见过的取值开始，写明哪些是这次才发现的', async () => {
    const backend = enumerating();
    const cached = await runProbe({ ...OPTIONS, codes: new Set(['csxhjctb_tyhda']) }, fakeBackend().io, exactFieldsOf);
    const probe = cached.probes[0];
    if (!probe) {
      throw new Error('没有探查结果');
    }
    const stats = sampleOf(repeat({ lin_zhong: '233' }, 3));
    const saved = { ...probe, tileset: 'szy_kt_2024', attributes: { ...probe.attributes, stats }, tiles: [] };
    const io: ProbeIO = { ...backend.io, load: tileset => (tileset === 'szy_kt_2024' ? saved : null) };

    const [result] = await runEnumerate(target, OPTIONS, io);

    expect(new URL(backend.requests[1] ?? '', 'http://x').searchParams.get('conditions')).toBe(`"lin_zhong" NOT IN ('233')`);
    expect(result?.discovered).toStrictEqual(['', '111', "12'7"]);
  });

  it('接口报错、取不到新取值时写明没列全，不当作列全了', async () => {
    const failing = fakeBackend(url =>
      url.pathname === '/api/query/attr/page' ? Response.json({ success: false, code: 500, msg: '系统异常' }) : undefined
    );
    const [failed] = await runEnumerate(target, OPTIONS, failing.io);
    expect(failed).toMatchObject({ remaining: null, error: '系统异常' });

    const stuck = fakeBackend(url =>
      url.pathname === '/api/query/attr/page' ? Response.json({ total: 5, list: [] }) : undefined
    );
    const [unfinished] = await runEnumerate(target, OPTIONS, stuck.io);
    expect(unfinished).toMatchObject({ remaining: 5, error: '还有 5 行，但取不到新的取值' });

    // 记录里这个字段是 null 或者没有时不算取值，不能写成文字的 "null"
    const empty = fakeBackend(url =>
      url.pathname === '/api/query/attr/page'
        ? Response.json({ total: 2, list: [{ lin_zhong: null }, { other: '1' }] })
        : undefined
    );
    const [blank] = await runEnumerate(target, OPTIONS, empty.io);
    expect(blank).toMatchObject({ values: [], remaining: 2 });
  });

  it('token 失效时停下来；资源树里没有的资源直接报错', async () => {
    const expired = fakeBackend(url => (url.pathname.startsWith('/api/') ? new Response('', { status: 401 }) : undefined));
    await expect(runEnumerate(target, OPTIONS, expired.io)).rejects.toBeInstanceOf(ProbeAuthError);
    await expect(runEnumerate([{ code: 'nope', field: 'f' }], OPTIONS, enumerating().io)).rejects.toThrow('nope');
  });
});

describe('报告', () => {
  it('编码在低级别的瓦片里缺失、名称都有时建议用名称，不用重新切片', async () => {
    const { summaries } = await probed();
    expect(summaries[0]?.primary?.field).toBe('ccn');
    const [, ...rows] = candidateRows(summaries);
    const row = rows.find(cells => cells[2] === 'csxhjctb_tyhda' && cells[6] === 'ccn');
    expect(row?.[7]).toBe('建议');
    expect(row?.[15]).toContain('瓦片里比 cc 保留得全');
  });

  it('属性能查、瓦片报错的瓦片集也写进概览', async () => {
    const backend = fakeBackend(url =>
      url.pathname.startsWith('/api/tiles/csxhjctb_tyhda')
        ? Response.json({ success: false, code: 500, msg: 'renderFields 非法: 面积' })
        : undefined
    );
    const result = await runProbe(OPTIONS, backend.io, exactFieldsOf);
    const summaries = result.resources.map(resource => summarizeResource(resource, result.probes));
    expect(summaries[0]?.status).toBe('candidate');
    const text = formatSummary(result, summaries);
    expect(text).toContain('- csxhjctb_tyhda_2023 瓦片：renderFields 非法: 面积');
    expect(text).toContain('- szy_kt_2024 属性：系统异常');
  });

  it('抽样漏掉、瓦片里才见到的取值也列出来，准确分布也会查（实测学校的 type 抽到 19 个，瓦片里 25 个）', async () => {
    const list = [...repeat({ type: '小学' }, 30), ...repeat({ type: '初级中学' }, 30)];
    const backend = fakeBackend(url => {
      if (url.pathname === '/api/query/attr/page') {
        const total = url.searchParams.get('conditions') ? 10 : 60;
        return Response.json({ total, list: url.searchParams.get('conditions') ? [] : list });
      }
      if (url.pathname.startsWith('/api/tiles/')) {
        const features = repeat({ properties: { type: '完全中学' } }, 10);
        return new Response(encodeTile('x', features).slice());
      }
      return undefined;
    });
    const options = { ...OPTIONS, codes: new Set(['csxhjctb_tyhda']), exact: true };
    const result = await runProbe(options, backend.io, exactFieldsOf);
    const conditions = backend.requests.map(request => new URL(request, 'http://x').searchParams.get('conditions'));
    expect(conditions).toContain(`"type" = '完全中学'`);
    const withoutExact = result.probes.map(({ exact: _exact, ...probe }) => probe);
    const summaries = result.resources.map(resource => summarizeResource(resource, withoutExact));
    const row = candidateRows(summaries).find(cells => cells[6] === 'type');
    expect(row?.[10]).toBe('3');
    expect(row?.[14]).toContain('完全中学（抽样外，瓦片里有）');
    // 瓦片里才有的取值不影响比例：分布仍按属性表
    expect(row?.[12]).toBe('50%');
  });

  it('只探查了部分年份时写明其他年份没有探查，不让"没有差异"误导人', async () => {
    const { summaries } = await probed();
    const [, ...rows] = candidateRows(summaries);
    expect(rows.find(cells => cells[2] === 'csxhjctb_tyhda')?.[16]).toBe('2022 年未探查');
  });

  it('切片要求列出要保留的字段；聚合要素写明要按分类聚合', async () => {
    const { summaries } = await probed();
    const [header, ...rows] = slicingRows(summaries);
    expect(header?.[0]).toBe('瓦片集');
    const row = rows.find(cells => cells[3] === 'ccn');
    expect(row?.[0]).toBe('csxhjctb_tyhda_2023');
    expect(row?.[5]).toBe('z7:100% z14:100%');
    expect(row?.[7]).toBe('是');
    expect(row?.[8]).toContain('z7 有 100% 是聚合要素');
    // 没有瓦片的资源判断不了，不列
    expect(rows.some(cells => cells[0]?.startsWith('szy_'))).toBe(false);
  });

  it('只有备选字段的资源要人先判断，不进切片要求', async () => {
    const list = [...repeat({ foo: 'a' }, 30), ...repeat({ foo: 'b' }, 30)];
    const backend = fakeBackend(url => {
      if (url.pathname === '/api/query/attr/page') {
        return Response.json({ total: 60, list });
      }
      return url.pathname.startsWith('/api/tiles/') ? new Response(new Uint8Array()) : undefined;
    });
    const result = await runProbe({ ...OPTIONS, codes: new Set(['csxhjctb_tyhda']) }, backend.io, exactFieldsOf);
    const summaries = result.resources.map(resource => summarizeResource(resource, result.probes));
    expect(summaries[0]).toMatchObject({ status: 'possible', primary: { field: 'foo' } });
    expect(slicingRows(summaries).slice(1)).toEqual([]);
  });

  it('候选表每个资源至少一行，名称和分布写在一起', async () => {
    const { summaries } = await probed();
    const [, ...rows] = candidateRows(summaries);
    const water = rows.find(cells => cells[2] === 'szy_kt');
    expect(water?.[5]).toBe('瓦片报错，暂时判断不了');
    const school = rows.find(cells => cells[2] === 'csxhjctb_tyhda' && cells[6] === 'cc');
    expect(school?.[9]).toBe('ccn');
    expect(school?.[14]).toContain('08H213 中小学（');
  });

  it('其他年份没有这个字段、多出取值时写在差异里', async () => {
    const backend = fakeBackend(url => {
      if (url.pathname === '/api/query/attr/page' && url.searchParams.get('layerCode') === 'csxhjctb_tyhda_2022') {
        const list = schoolRecords(60).map(({ guid, TYPE, NAME }) => ({ guid, TYPE: `${TYPE}（旧）`, NAME }));
        return Response.json({ total: 60, list });
      }
      return undefined;
    });
    const options = { ...OPTIONS, codes: new Set(['csxhjctb_tyhda']), years: 'all' } as const;
    const result = await runProbe(options, backend.io, exactFieldsOf);
    const [summary] = result.resources.map(resource => summarizeResource(resource, result.probes));
    const rows = candidateRows(summary ? [summary] : []).slice(1);
    expect(rows.find(cells => cells[6] === 'cc')?.[16]).toBe('2022 年没有这个字段');
    expect(rows.find(cells => cells[6] === 'type')?.[16]).toContain('2022 年多出');
  });

  it('输出里不出现 token', async () => {
    const { result, summaries } = await probed();
    const text = [
      toCsv(candidateRows(summaries)),
      toCsv(slicingRows(summaries)),
      formatSummary(result, summaries),
      JSON.stringify(result.probes)
    ].join('\n');
    expect(text).not.toContain('secret-token');
  });

  it('CSV 带 BOM，含逗号、引号和换行的单元格加引号', () => {
    expect(toCsv([['a,b', 'c"d', 'e\nf', 'g']])).toBe('﻿"a,b","c""d","e\nf",g\r\n');
  });
});
