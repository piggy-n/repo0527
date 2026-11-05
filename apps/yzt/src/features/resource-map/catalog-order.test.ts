// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { CatalogNode } from './catalog';
import { CATALOG_ROOT, orderedChildren, treeOrder } from './catalog-order';

const self = (key: string) => key;

const resource = (code: string): CatalogNode => ({ kind: 'resource', code });
const category = (id: string, children: CatalogNode[]): CatalogNode => ({ kind: 'category', id, name: id, children });

// 甲下面是 a、b 和分类乙（c、d），丙下面是 e，丁是空分类
const TREE: CatalogNode[] = [
  category('甲', [resource('a'), resource('b'), category('乙', [resource('c'), resource('d')])]),
  category('丙', [resource('e')]),
  category('丁', [])
];

describe('orderedChildren', () => {
  it('键里有的按键的顺序在前，没有的按原来的顺序在后，不在了的键忽略', () => {
    expect(orderedChildren(['a', 'b', 'c'], self, [])).toStrictEqual(['a', 'b', 'c']);
    expect(orderedChildren(['a', 'b', 'c', 'd'], self, ['c', 'x', 'a'])).toStrictEqual(['c', 'a', 'b', 'd']);
  });
});

describe('treeOrder', () => {
  it('同级按最靠前的资源排，再深度优先列出资源：同一个分类的资源连在一起', () => {
    expect(treeOrder(TREE, ['a', 'b', 'c', 'd', 'e'])).toStrictEqual(['a', 'b', 'c', 'd', 'e']);
    expect(treeOrder(TREE, ['e', 'c', 'a', 'd', 'b'])).toStrictEqual(['e', 'c', 'd', 'a', 'b']);
  });

  it('顺序里没有的资源排在同级的最后，位置一样的保持目录的顺序', () => {
    expect(treeOrder(TREE, ['e', 'b'])).toStrictEqual(['e', 'b', 'a', 'c', 'd']);
    expect(treeOrder(TREE, [])).toStrictEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('给出调整时，那个父节点下按调整后的顺序排，分类带着它的资源一起挪；面板上不显示的空分类可以不在键里', () => {
    const order = ['a', 'b', 'c', 'd', 'e'];

    expect(treeOrder(TREE, order, { parentId: CATALOG_ROOT, keys: ['甲', '丙'], from: 1, to: 0 })).toStrictEqual([
      'e',
      'a',
      'b',
      'c',
      'd'
    ]);
    expect(treeOrder(TREE, order, { parentId: '甲', keys: ['a', 'b', '乙'], from: 2, to: 0 })).toStrictEqual([
      'c',
      'd',
      'a',
      'b',
      'e'
    ]);
    expect(treeOrder(TREE, order, { parentId: '乙', keys: ['c', 'd'], from: 0, to: 1 })).toStrictEqual([
      'a',
      'b',
      'd',
      'c',
      'e'
    ]);
  });

  it('调整的位置越界、键重复时抛错', () => {
    const order = ['a', 'b', 'c', 'd', 'e'];

    expect(() => treeOrder(TREE, order, { parentId: '乙', keys: ['c', 'd'], from: 0, to: 2 })).toThrow(RangeError);
    expect(() => treeOrder(TREE, order, { parentId: '乙', keys: ['c', 'd'], from: -1, to: 0 })).toThrow(RangeError);
    expect(() => treeOrder(TREE, order, { parentId: '乙', keys: ['c', 'c'], from: 0, to: 1 })).toThrow('重复的键');
  });
});
