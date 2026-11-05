// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { PreparedTileset } from '../prepare-tileset';
import { translation } from './nav-frame';
import { navigationLeaves, rootTransform } from './nav-leaves';

const ROOT = Array.from(translation(-2781498, 4691157, 3296015));
const box = { box: [0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10] };

const tileset: PreparedTileset = {
  geometricError: 100,
  root: {
    geometricError: 50,
    boundingVolume: box,
    transform: ROOT,
    content: { uri: 'https://maps.test/root.b3dm' },
    children: [
      { geometricError: 0, boundingVolume: box, content: { uri: 'https://maps.test/a.b3dm' } },
      {
        geometricError: 10,
        boundingVolume: box,
        transform: Array.from(translation(10, 0, 0)),
        children: [
          {
            geometricError: 0,
            boundingVolume: box,
            transform: Array.from(translation(0, 5, 0)),
            content: { uri: 'https://maps.test/b.b3dm' }
          }
        ]
      }
    ]
  }
};

describe('navigationLeaves', () => {
  it('只取有内容、没有子节点的瓦片；根节点以下各级 transform 相乘，根节点自己的不算', () => {
    const leaves = navigationLeaves(tileset);

    expect(leaves.map(({ url }) => url)).toStrictEqual(['https://maps.test/a.b3dm', 'https://maps.test/b.b3dm']);
    expect(Array.from(leaves[0].toLocal.slice(12, 15))).toStrictEqual([0, 0, 0]);
    expect(Array.from(leaves[1].toLocal.slice(12, 15))).toStrictEqual([10, 5, 0]);
    expect(rootTransform(tileset)).toStrictEqual(ROOT);
  });

  it('根节点没有 transform、某级 transform 不是 16 个数时抛错', () => {
    const plain: PreparedTileset = { ...tileset, root: { ...tileset.root, transform: undefined } };
    expect(() => rootTransform(plain)).toThrow('瓦片集根节点没有 transform');
    const broken: PreparedTileset = {
      ...tileset,
      root: { ...tileset.root, children: [{ geometricError: 0, boundingVolume: box, transform: [1, 2] }] }
    };
    expect(() => navigationLeaves(broken)).toThrow('瓦片的 transform 不是 16 个数');
  });
});
