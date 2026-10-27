// @vitest-environment node
import { describe, expect, it } from 'vitest';
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
  it('按市分组、按清单的先后；关键字匹配模型名或市名', () => {
    const catalog = buildModelCatalog(sceneManifestSchema.parse(MANIFEST), MANIFEST_URL);
    const summary = (keyword: string) =>
      groupByCity(catalog, keyword).map(({ cityName, models }) => [cityName, models.map(({ id }) => id)]);

    expect(summary('')).toStrictEqual([
      ['苏州市', ['sz-station', 'sz-white']],
      ['南京市', ['nj-oblique']]
    ]);
    expect(summary(' 白膜 ')).toStrictEqual([['苏州市', ['sz-white']]]);
    expect(summary('南京')).toStrictEqual([['南京市', ['nj-oblique']]]);
    expect(summary('没有的')).toStrictEqual([]);
  });
});
