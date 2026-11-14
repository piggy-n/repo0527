// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  allKeys,
  branchKeys,
  type CatalogLeaf,
  type CatalogNode,
  catalogCover,
  findCatalogNode,
  leavesOf,
  visibleKeys
} from './catalog-tree';

const leaf = (key: string, added = false): CatalogLeaf => ({
  kind: 'leaf',
  key,
  label: key,
  icon: 'geometry-polygon',
  added
});

// 基础库（国土变更：a、b；水资源：c）、三区三线（d）
const TREE: CatalogNode[] = [
  {
    kind: 'branch',
    key: 'base',
    label: '基础库',
    children: [
      { kind: 'branch', key: 'land', label: '国土变更', children: [leaf('a', true), leaf('b')] },
      { kind: 'branch', key: 'water', label: '水资源', children: [leaf('c')] }
    ]
  },
  { kind: 'branch', key: 'zones', label: '三区三线', children: [leaf('d', true)] }
];

describe('目录节点', () => {
  it('分类下面全部的项按目录的先后；全部的键、分类的键', () => {
    expect(leavesOf(TREE[0]).map(item => item.key)).toStrictEqual(['a', 'b', 'c']);
    expect(allKeys(TREE)).toStrictEqual(['base', 'land', 'a', 'b', 'water', 'c', 'zones', 'd']);
    expect(branchKeys(TREE)).toStrictEqual(['base', 'land', 'water', 'zones']);
  });

  it('显示着的键：收起的分类下面的不算，搜索时全部展开', () => {
    expect(visibleKeys(TREE, new Set(['base', 'land']), false)).toStrictEqual([
      'base',
      'land',
      'a',
      'b',
      'water',
      'zones'
    ]);
    expect(visibleKeys(TREE, new Set(), false)).toStrictEqual(['base', 'zones']);
    expect(visibleKeys(TREE, new Set(), true)).toStrictEqual(allKeys(TREE));
  });

  it('按键找节点，没有时为 null', () => {
    expect(findCatalogNode(TREE, 'water')?.label).toBe('水资源');
    expect(findCatalogNode(TREE, 'nope')).toBeNull();
  });
});

describe('catalogCover', () => {
  it('分类算下面全部的项；已加入的不算加入、没加入的不算移出，去重，按目录的先后', () => {
    expect(catalogCover(TREE, ['zones', 'base', 'b'])).toStrictEqual({ add: ['b', 'c'], remove: ['a', 'd'] });
  });

  it('只选了已加入的：没有能加入的；只选了没加入的：没有能移出的；不在目录里的键忽略', () => {
    expect(catalogCover(TREE, ['a', 'd'])).toStrictEqual({ add: [], remove: ['a', 'd'] });
    expect(catalogCover(TREE, ['water', 'nope'])).toStrictEqual({ add: ['c'], remove: [] });
    expect(catalogCover(TREE, [])).toStrictEqual({ add: [], remove: [] });
  });
});
