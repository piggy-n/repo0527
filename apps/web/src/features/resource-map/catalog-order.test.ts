// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { EMPTY_CATALOG_ORDER, moveInCatalog, orderedChildren, storedCatalogOrderSchema } from './catalog-order';

const self = (key: string) => key;

describe('orderedChildren', () => {
  it('没有记录时按原来的顺序', () => {
    expect(orderedChildren(['a', 'b', 'c'], self)).toStrictEqual(['a', 'b', 'c']);
    expect(orderedChildren(['a', 'b', 'c'], self, [])).toStrictEqual(['a', 'b', 'c']);
  });

  it('记录里仍存在的按记录的顺序在前，新出现的按原来的顺序在后，不在了的忽略', () => {
    expect(orderedChildren(['a', 'b', 'c', 'd'], self, ['c', 'x', 'a'])).toStrictEqual(['c', 'a', 'b', 'd']);
  });
});

describe('moveInCatalog', () => {
  it('只记这个父节点的新顺序，其他父节点不变', () => {
    const order = { other: ['y', 'x'] };

    const next = moveInCatalog(order, 'p', ['a', 'b', 'c'], 2, 0);

    expect(next).toStrictEqual({ other: ['y', 'x'], p: ['c', 'a', 'b'] });
    expect(moveInCatalog(next, 'p', ['c', 'a', 'b'], 0, 2)).toStrictEqual({ other: ['y', 'x'], p: ['a', 'b', 'c'] });
  });

  it('位置不变时原样返回；越界、键重复时抛错', () => {
    expect(moveInCatalog(EMPTY_CATALOG_ORDER, 'p', ['a', 'b'], 1, 1)).toBe(EMPTY_CATALOG_ORDER);
    expect(() => moveInCatalog(EMPTY_CATALOG_ORDER, 'p', ['a', 'b'], 0, 2)).toThrow(RangeError);
    expect(() => moveInCatalog(EMPTY_CATALOG_ORDER, 'p', ['a', 'b'], -1, 0)).toThrow(RangeError);
    expect(() => moveInCatalog(EMPTY_CATALOG_ORDER, 'p', ['a', 'a'], 0, 1)).toThrow('重复的键');
  });
});

describe('storedCatalogOrderSchema', () => {
  it('每个父节点下的键不能重复', () => {
    expect(storedCatalogOrderSchema.safeParse({ '': ['a', 'b'], p: [] }).success).toBe(true);
    expect(storedCatalogOrderSchema.safeParse({ p: ['a', 'a'] }).success).toBe(false);
    expect(storedCatalogOrderSchema.safeParse({ p: 'a' }).success).toBe(false);
  });
});
