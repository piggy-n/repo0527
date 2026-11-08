// @vitest-environment node
import { describe, expect, it } from 'vitest';
import manifestText from '../../../public/3dt/manifest.json?raw';
import { type SceneManifest, sceneManifestSchema } from './api';
import { buildModelCatalog, groupByCity } from './catalog';

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
        { id: 'window', label: '内置效果1', tileset: 'SZ_WhiteModel/window/tileset.json' }
      ]
    },
    {
      id: 'nj-oblique',
      name: '新街口倾斜摄影',
      cityCode: '320100',
      kind: 'oblique',
      underground: false,
      tileset: 'NJ/tileset.json'
    }
  ]
};

const parse = (value: unknown) => sceneManifestSchema.safeParse(value);

function withModel(patch: Record<string, unknown>): unknown {
  return { models: [{ ...MANIFEST.models[2], ...patch }] };
}

describe('sceneManifestSchema', () => {
  it('两种写法都通过：白膜用 effects，其他用 tileset；出生点和路线可以不写', () => {
    expect(parse(MANIFEST).success).toBe(true);
    expect(parse({ models: [] }).success).toBe(true);
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
      // 路线少于两个点、点不是三个数
      withModel({ routes: [{ id: 'r', name: 'R', path: [[120, 31, 0]] }] }),
      withModel({ routes: [{ id: 'r', name: 'R', path: [[120, 31], [121, 31]] }] }),
      // ID 重复
      { models: [MANIFEST.models[2], MANIFEST.models[2]] },
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
      ['wx-jkq', '无锡市'],
      ['wx-jkq2', '无锡市']
    ]);
    const urls = models.flatMap(({ effects }) => effects.map(({ url }) => url));
    expect(urls.every(url => url.startsWith('https://maps.test/yzt/3dt/'))).toBe(true);
    const lengths = models.flatMap(({ routes }) => routes.map(({ length }) => Math.round(length)));
    expect(lengths).toStrictEqual([125, 133, 58]);
    // 经开区（JKQ）在 16.5 级以上要看到块根下面的一级，单独设 8（docs/modules/map-cesium.md）
    expect(models.map(({ maximumScreenSpaceError }) => maximumScreenSpaceError)).toStrictEqual([
      undefined,
      undefined,
      undefined,
      8,
      undefined
    ]);
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
      ['nj-oblique', '南京市', '']
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
      ['苏州市', ['sz-station', 'sz-white']]
    ]);
    expect(summary(' 白膜 ')).toStrictEqual([['苏州市', ['sz-white']]]);
    expect(summary('南京')).toStrictEqual([['南京市', ['nj-oblique']]]);
    expect(summary('没有的')).toStrictEqual([]);
  });
});
