// @vitest-environment node
import { describe, expect, it } from 'vitest';
import manifestText from '../../../public/3dt/manifest.json?raw';
import { type SceneManifest, sceneManifestSchema } from './api';
import { buildModelCatalog, groupByCity, routeTimeline } from './catalog';

const MANIFEST_URL = 'https://maps.test/yzt/3dt/manifest.json';

// ADR 0081 第 1 节的两种写法
const MANIFEST = {
  models: [
    {
      id: 'sz-station',
      name: '苏州站地下空间',
      cityCode: '320500',
      kind: 'indoor',
      underground: true,
      tileset: 'SZ_3DT/tileset.json',
      spawn: { lng: 120.6660669, lat: 31.317559, height: -5.1, heading: 76 },
      routes: [{ id: 'hall', name: '站厅', path: [[120.666, 31.3175, -3], [120.6665, 31.318, -3]] }]
    },
    {
      id: 'sz-white',
      name: '苏州白膜',
      cityCode: '320500',
      kind: 'white',
      underground: false,
      effects: [
        { id: 'plain', label: '无纹理', tileset: 'SZ_WhiteModel/plain/tileset.json' },
        { id: 'window', label: '效果1', tileset: 'SZ_WhiteModel/window/tileset.json' }
      ]
    },
    {
      id: 'nj-oblique',
      name: '新街口倾斜摄影',
      cityCode: '320100',
      kind: 'oblique',
      underground: false,
      tileset: 'NJ/tileset.json'
    },
    {
      id: 'xz-splat',
      name: '楚王山',
      cityCode: '320300',
      kind: 'splat',
      underground: false,
      lcc2: '%E6%A5%9A/lcc2-sog-result/%E6%A5%9A.lcc2',
      placement: { lng: 117.06, lat: 34.27, height: 59.7, heading: -0.04 }
    }
  ]
};

const parse = (value: unknown) => sceneManifestSchema.safeParse(value);

function withModel(patch: Record<string, unknown>): unknown {
  return { models: [{ ...MANIFEST.models[2], ...patch }] };
}

function withSplat(patch: Record<string, unknown>): unknown {
  return { models: [{ ...MANIFEST.models[3], ...patch }] };
}

describe('sceneManifestSchema', () => {
  it('三种写法都通过：白膜用 effects，高斯泼溅用 lcc2 和 placement，其他用 tileset；出生点和路线可以不写', () => {
    expect(parse(MANIFEST).success).toBe(true);
    expect(parse({ models: [] }).success).toBe(true);
  });

  it('高斯泼溅也可以写出生点和路线，路线的点可以多一个眼高（ADR 0156）', () => {
    const spawn = { lng: 117.06, lat: 34.27, height: 58.1, heading: 20 };
    const path = [
      [117.06, 34.27, 58.1],
      [117.0601, 34.27, 58.1, 1.2]
    ];
    expect(parse(withSplat({ spawn, routes: [{ id: 'tomb', name: '进墓室', path }] })).success).toBe(true);
  });

  it('任何一处不合法都整份不通过', () => {
    const invalid: unknown[] = [
      // 白膜写了 tileset、没有效果；其他模型写了 effects
      withModel({ kind: 'white', effects: undefined }),
      withModel({ kind: 'white', effects: [] }),
      withModel({ effects: [{ id: 'a', label: 'A', tileset: 'a.json' }] }),
      // 不认识的类型、不是江苏的市、区县代码、多余的字段
      withModel({ kind: 'bim' }),
      withModel({ cityCode: '110100' }),
      withModel({ cityCode: '320102' }),
      withModel({ color: 'red' }),
      // 路线少于两个点、点不是三个或四个数、眼高不在 0～1.6 米之间
      withModel({ routes: [{ id: 'r', name: 'R', path: [[120, 31, 0]] }] }),
      withModel({ routes: [{ id: 'r', name: 'R', path: [[120, 31], [121, 31]] }] }),
      withModel({ routes: [{ id: 'r', name: 'R', path: [[120, 31, 0, 1, 1], [121, 31, 0]] }] }),
      withModel({ routes: [{ id: 'r', name: 'R', path: [[120, 31, 0, 1.7], [121, 31, 0]] }] }),
      withModel({ routes: [{ id: 'r', name: 'R', path: [[120, 31, 0, 0], [121, 31, 0]] }] }),
      // ID 重复
      { models: [MANIFEST.models[2], MANIFEST.models[2]] },
      // 高斯泼溅（ADR 0149）：没有索引、没有摆放、摆放缺一项或超出范围、写了瓦片集的字段
      withSplat({ lcc2: undefined }),
      withSplat({ placement: undefined }),
      withSplat({ placement: { lng: 117.06, lat: 34.27, height: 59.7 } }),
      withSplat({ placement: { lng: 117.06, lat: 94.27, height: 59.7, heading: 0 } }),
      withSplat({ tileset: 'a/tileset.json' }),
      withSplat({ maximumScreenSpaceError: 8 }),
      // 有路线、没有出生点的泼溅：导航网格按出生点留区域，没有时会留下屋顶这类最大的一片（ADR 0156）
      withSplat({ spawn: undefined, routes: [{ id: 'r', name: 'R', path: [[117.06, 34.27, 58], [117.0601, 34.27, 58]] }] }),
      'not a manifest'
    ];

    expect(invalid.filter(value => parse(value).success)).toStrictEqual([]);
  });
});

describe('入库的清单（public/3dt/manifest.json）', () => {
  it('通过校验，地址都在 3dt 目录下，路线有长度', () => {
    const models = buildModelCatalog(sceneManifestSchema.parse(JSON.parse(manifestText)), MANIFEST_URL);

    expect(models.map(({ id, cityName }) => [id, cityName])).toStrictEqual([
      ['sz-station', '苏州市'],
      ['sz-white', '苏州市'],
      ['xz-gc', '徐州市'],
      ['xz-pc-lcc2', '徐州市'],
      ['wx-jkq', '无锡市'],
      ['wx-xwq02', '无锡市'],
      ['wx-xwq03', '无锡市'],
      ['xz-cws1', '徐州市'],
      ['xz-cws2', '徐州市'],
      ['xz-cws3', '徐州市'],
      ['xz-tls1', '徐州市'],
      ['xz-tsm', '徐州市'],
      ['xz-gshm', '徐州市'],
      ['xz-tls2', '徐州市'],
      ['xz-ddsh', '徐州市'],
      ['xz-szs', '徐州市']
    ]);
    const urls = models.flatMap(({ effects, splat }) => [...effects.map(({ url }) => url), ...(splat ? [splat.url] : [])]);
    expect(urls.every(url => url.startsWith('https://maps.test/yzt/3dt/'))).toBe(true);
    // 中文按 URL 编码写，相对清单解析后原样保留（ADR 0149 第 3 节）
    const chuwangshan = encodeURIComponent('楚王山1号');
    expect(models.find(({ id }) => id === 'xz-cws1')?.splat?.url).toBe(
      `https://maps.test/yzt/3dt/xuzhou/lcc2/${chuwangshan}/lcc2-sog-result/${chuwangshan}.lcc2`
    );
    const lengths = models.flatMap(({ routes }) => routes.map(({ length }) => Math.round(length)));
    // 星海广场站三条，驮篮山1号两条、土山墓三条（泼溅的路线取自扫描轨迹、拉直过，ADR 0156 第 4 节）
    expect(lengths).toStrictEqual([125, 133, 58, 211, 156, 47, 190, 155]);
    // 屏幕误差上限统一用引擎的默认值 8，清单只写例外（docs/config/3dt-manifest.md）
    expect(models.every(({ maximumScreenSpaceError }) => maximumScreenSpaceError === undefined)).toBe(true);
  });
});

// 模型目录的层级（用户 2026-11-11 定，docs/config/3dt-manifest.md）：<市的拼音>/<类型>/<模型目录>/…
const CITY_DIRECTORIES: Readonly<Record<string, string>> = { '320200': 'wuxi', '320300': 'xuzhou', '320500': 'suzhou' };

type ManifestModel = SceneManifest['models'][number];

function pathsOf(model: ManifestModel): string[] {
  if (model.kind === 'splat') {
    return [model.lcc2];
  }
  if (model.kind === 'white') {
    return model.effects.map(({ tileset }) => tileset);
  }
  return [model.tileset];
}

// 不合层级时返回原因
function layoutProblem(model: ManifestModel, path: string): string | null {
  const parts = path.split('/').map(part => decodeURIComponent(part));
  if (parts.map(part => encodeURIComponent(part)).join('/') !== path) {
    return `${path}：没有按段编码`;
  }
  const [city, type, directory, ...rest] = parts;
  if (city !== CITY_DIRECTORIES[model.cityCode]) {
    return `${path}：市的目录不对`;
  }
  // LCC2 保留交付时的目录名和里面的层级，索引的文件名也不一定是模型名（龟山汉墓、狮子山楚王墓）
  if (model.kind === 'splat') {
    const [result, file] = rest;
    const placed = type === 'lcc2' && rest.length === 2 && result === 'lcc2-sog-result' && file?.endsWith('.lcc2');
    return placed ? null : `${path}：不是 lcc2/<目录>/lcc2-sog-result/<索引>.lcc2`;
  }
  // 3D Tiles 的目录名和清单里的名称相同
  const placed = type === '3dtiles' && directory === model.name && rest.at(-1) === 'tileset.json';
  return placed ? null : `${path}：不是 3dtiles/<模型名>/…/tileset.json`;
}

describe('入库的清单：路线按播放的规则估算的时间（ADR 0156 R.5）', () => {
  it('星海广场站三条路线：锁住播放的规则（转头限速、转弯放慢），改了规则这里要跟着看', () => {
    const models = buildModelCatalog(sceneManifestSchema.parse(JSON.parse(manifestText)), MANIFEST_URL);
    const station = models.find(({ id }) => id === 'sz-station');
    // 4 m/s、1.6 m/s 走完的秒数，到 0.1 秒
    const seconds = (station?.routes ?? []).map(route => [
      route.id,
      Math.round(routeTimeline(route, 4).total * 10) / 10,
      Math.round(routeTimeline(route, 1.6).total * 10) / 10
    ]);
    // 按长度和速度是 31.3、33.2、14.4 秒（4 m/s），78.2、82.9、36.1 秒（1.6 m/s）：只有进站乘车的弯放慢得明显
    expect(seconds).toStrictEqual([
      ['enter', 33.5, 78.7],
      ['concourse', 33.5, 82.9],
      ['platform', 14.5, 36.1]
    ]);
  });
});

describe('入库的清单的目录层级', () => {
  it('3D Tiles 在 <市>/3dtiles/<模型名>/ 下，LCC2 在 <市>/lcc2/<目录>/lcc2-sog-result/ 下，每一段按 URL 编码', () => {
    const { models } = sceneManifestSchema.parse(JSON.parse(manifestText));
    const problems = models.flatMap(model => pathsOf(model).map(path => layoutProblem(model, path)));

    expect(problems.filter(problem => problem !== null)).toStrictEqual([]);
    expect(models.find(({ id }) => id === 'xz-pc-lcc2')).toMatchObject({
      name: '彭城广场（泼溅）',
      lcc2: `xuzhou/lcc2/${encodeURIComponent('城下城（测试）')}/lcc2-sog-result/${encodeURIComponent('20260922地下城.lcc2')}`
    });
  });
});

describe('清单里的屏幕误差上限', () => {
  it('是正数才通过；目录带上它，没写的不出现这一项', () => {
    expect(parse(withModel({ maximumScreenSpaceError: 8 })).success).toBe(true);
    expect(parse(withModel({ maximumScreenSpaceError: 0 })).success).toBe(false);
    expect(parse(withModel({ maximumScreenSpaceError: '8' })).success).toBe(false);

    const catalogOf = (patch: Record<string, unknown>) =>
      buildModelCatalog(sceneManifestSchema.parse(withModel(patch)), MANIFEST_URL);
    const [tuned] = catalogOf({ maximumScreenSpaceError: 8 });
    expect(tuned?.maximumScreenSpaceError).toBe(8);
    const [plain] = catalogOf({});
    expect(plain !== undefined && 'maximumScreenSpaceError' in plain).toBe(false);
  });
});

describe('buildModelCatalog', () => {
  it('地址按清单的地址解析成绝对地址，市名取自区划目录，白膜默认第一种效果', () => {
    const catalog = buildModelCatalog(sceneManifestSchema.parse(MANIFEST) satisfies SceneManifest, MANIFEST_URL);

    expect(catalog.map(({ id, cityName, defaultEffect }) => [id, cityName, defaultEffect])).toStrictEqual([
      ['sz-station', '苏州市', ''],
      ['sz-white', '苏州市', 'plain'],
      ['nj-oblique', '南京市', ''],
      ['xz-splat', '徐州市', '']
    ]);
    expect(catalog[0]?.effects).toStrictEqual([
      { id: '', label: '', url: 'https://maps.test/yzt/3dt/SZ_3DT/tileset.json' }
    ]);
    expect(catalog[1]?.effects.map(({ url }) => url)).toStrictEqual([
      'https://maps.test/yzt/3dt/SZ_WhiteModel/plain/tileset.json',
      'https://maps.test/yzt/3dt/SZ_WhiteModel/window/tileset.json'
    ]);
    expect(catalog[0]?.routes).toHaveLength(1);
    expect(catalog[2]?.routes).toStrictEqual([]);
    // 高斯泼溅没有瓦片集，带上索引的绝对地址和摆放；其他模型没有泼溅
    expect(catalog[3]).toMatchObject({
      kind: 'splat',
      effects: [],
      routes: [],
      splat: {
        url: 'https://maps.test/yzt/3dt/%E6%A5%9A/lcc2-sog-result/%E6%A5%9A.lcc2',
        placement: { lng: 117.06, lat: 34.27, height: 59.7, heading: -0.04 }
      }
    });
    expect(catalog.slice(0, 3).map(({ splat }) => splat)).toStrictEqual([null, null, null]);
  });
});

describe('groupByCity', () => {
  it('按市分组、市按区划代码排、组内按清单的先后；关键字匹配模型名或市名', () => {
    const catalog = buildModelCatalog(sceneManifestSchema.parse(MANIFEST), MANIFEST_URL);
    const summary = (keyword: string) =>
      groupByCity(catalog, keyword).map(({ cityName, models }) => [cityName, models.map(({ id }) => id)]);

    // 清单里苏州在前，南京的代码小排在前面
    expect(summary('')).toStrictEqual([
      ['南京市', ['nj-oblique']],
      ['徐州市', ['xz-splat']],
      ['苏州市', ['sz-station', 'sz-white']]
    ]);
    expect(summary(' 白膜 ')).toStrictEqual([['苏州市', ['sz-white']]]);
    expect(summary('南京')).toStrictEqual([['南京市', ['nj-oblique']]]);
    expect(summary('没有的')).toStrictEqual([]);
  });
});
