// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { ResourceTreeCategory } from './api';
import { buildCatalog } from './catalog';

function layer(code: string, geoType: 'Polygon' | 'Line' | 'Point', yearList: [number, ...number[]], name = code) {
  return { code, name, geoType, yearList };
}

const TREE: ResourceTreeCategory[] = [
  {
    code: null,
    name: '基础库',
    children: [
      {
        code: 'tdzy',
        name: '土地资源',
        children: [layer('bgdc_dltb', 'Polygon', [2022]), layer('bgdc_cjdcqjx', 'Line', [2022])]
      },
      { code: null, name: '森林', children: [] }
    ]
  },
  {
    code: null,
    name: '公共库',
    children: [
      {
        code: 'csxhjctb',
        name: '城市国土空间监测',
        children: [
          layer('csxhjctb_hydl', 'Line', [2023]),
          layer('csxhjctb_gyssp', 'Point', [2025]),
          layer('csxhjctb_hydl', 'Line', [2025, 2024])
        ]
      }
    ]
  },
  { code: 'sqsx', name: '三区三线', children: [layer('gtkjgh_czkfbj', 'Polygon', [2026])] }
];

describe('buildCatalog', () => {
  it('资源按目录顺序编号，几何类型换成图层类型，记下所属分类', () => {
    const catalog = buildCatalog(TREE);

    const rows = [...catalog.resources.values()].map(({ code, geometry, index, categoryId }) => [
      code,
      geometry,
      index,
      categoryId
    ]);

    expect(rows).toStrictEqual([
      ['bgdc_dltb', 'fill', 0, '基础库 / 土地资源'],
      ['bgdc_cjdcqjx', 'line', 1, '基础库 / 土地资源'],
      ['csxhjctb_hydl', 'line', 2, '公共库 / 城市国土空间监测'],
      ['csxhjctb_gyssp', 'circle', 3, '公共库 / 城市国土空间监测'],
      ['gtkjgh_czkfbj', 'fill', 4, '三区三线']
    ]);
    expect(catalog.problems).toStrictEqual([]);
  });

  it('同一个 code 按年份重复出现：合并年份，升序、不重复，只保留第一次的位置', () => {
    const catalog = buildCatalog(TREE);

    expect(catalog.resources.get('csxhjctb_hydl')?.years).toStrictEqual([2023, 2024, 2025]);
    const [, publicLibrary] = catalog.categories;
    const [monitoring] = publicLibrary?.children ?? [];
    expect(monitoring?.kind === 'category' ? monitoring.children : null).toStrictEqual([
      { kind: 'resource', code: 'csxhjctb_hydl' },
      { kind: 'resource', code: 'csxhjctb_gyssp' }
    ]);
  });

  it('分类的 ID 是名称路径；空分类保留', () => {
    const [base] = buildCatalog(TREE).categories;

    expect(base).toMatchObject({ kind: 'category', id: '基础库', name: '基础库' });
    const children = base?.children.map(node =>
      node.kind === 'category' ? [node.id, node.children.length] : node.code
    );
    expect(children).toStrictEqual([
      ['基础库 / 土地资源', 2],
      ['基础库 / 森林', 0]
    ]);
  });

  it('同一个 code 出现在两个分类、几何类型不同：以第一次的为准，记进问题列表，不抛错', () => {
    const tree: ResourceTreeCategory[] = [
      { code: null, name: '甲', children: [layer('x', 'Polygon', [2022])] },
      { code: null, name: '乙', children: [layer('x', 'Line', [2023])] }
    ];

    const catalog = buildCatalog(tree);

    expect(catalog.resources.get('x')).toMatchObject({ geometry: 'fill', categoryId: '甲', years: [2022, 2023] });
    expect(catalog.categories[1]?.children).toStrictEqual([]);
    expect(catalog.problems).toStrictEqual([
      { kind: 'code-in-two-categories', code: 'x', categoryIds: ['甲', '乙'] },
      { kind: 'conflicting-geometry', code: 'x', geometries: ['fill', 'line'] }
    ]);
  });

  it('同名的兄弟分类：ID 重复，记进问题列表', () => {
    const tree: ResourceTreeCategory[] = [
      { code: null, name: '甲', children: [] },
      { code: null, name: '甲', children: [] }
    ];

    expect(buildCatalog(tree).problems).toStrictEqual([{ kind: 'duplicate-category', id: '甲' }]);
  });
});
