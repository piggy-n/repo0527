// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { type LoadJson, type PreparedTile, prepareTileset } from './prepare-tileset';

const BASE = 'https://maps.test/3dt/SZ_3DT/';
const SPHERE = { sphere: [1, 2, 3, 100] };

// 按地址返回 JSON；没有准备的地址以 404 失败
function loader(files: Readonly<Record<string, unknown>>): LoadJson {
  return vi.fn<LoadJson>(url => {
    const file = files[url];
    return file === undefined ? Promise.reject(new Error(`404 ${url}`)) : Promise.resolve(structuredClone(file));
  });
}

const prepare = (files: Readonly<Record<string, unknown>>, signal = new AbortController().signal) =>
  prepareTileset(`${BASE}tileset.json`, loader(files), signal);

const urisOf = (tile: PreparedTile): string[] => [
  ...(tile.content ? [tile.content.uri] : []),
  ...(tile.children ?? []).flatMap(urisOf)
];

describe('prepareTileset', () => {
  it('外部索引并进来作为子节点，内容地址改成绝对地址，其他字段照原样保留', async () => {
    const prepared = await prepare({
      [`${BASE}tileset.json`]: {
        asset: { version: '1.0' },
        geometricError: 500,
        root: {
          transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
          boundingVolume: SPHERE,
          geometricError: 500,
          refine: 'REPLACE',
          children: [{ boundingVolume: SPHERE, geometricError: 100, content: { uri: './Tile_1/Tile_1.json' } }]
        }
      },
      [`${BASE}Tile_1/Tile_1.json`]: {
        root: {
          boundingVolume: SPHERE,
          geometricError: 50,
          content: { uri: 'Tile_1_L1.b3dm' },
          children: [{ boundingVolume: SPHERE, geometricError: 10, content: { uri: 'Tile_1_L2.b3dm' } }]
        }
      }
    });

    expect(prepared.asset).toStrictEqual({ version: '1.0' });
    expect(prepared.root.transform).toHaveLength(16);
    expect(prepared.root.refine).toBe('REPLACE');
    expect(urisOf(prepared.root)).toStrictEqual([`${BASE}Tile_1/Tile_1_L1.b3dm`, `${BASE}Tile_1/Tile_1_L2.b3dm`]);
    // 外部索引的节点自己没有内容了
    expect(prepared.root.children?.[0]?.content).toBeUndefined();
  });

  it('数据目录外、包围球全是 0、没有子节点的空占位去掉；其他目录外的引用报错', async () => {
    const root = (uri: string, sphere = [0, 0, 0, 0]) => ({
      [`${BASE}tileset.json`]: {
        root: {
          boundingVolume: SPHERE,
          geometricError: 10,
          children: [
            { boundingVolume: { sphere }, geometricError: 0, content: { uri } },
            { boundingVolume: SPHERE, geometricError: 1, content: { uri: 'a.b3dm' } }
          ]
        }
      }
    });

    const prepared = await prepare(root('../../../../../../../../../.json'));
    expect(urisOf(prepared.root)).toStrictEqual([`${BASE}a.b3dm`]);

    await expect(prepare(root('../other/tileset.json', [1, 2, 3, 4]))).rejects.toThrow('瓦片引用超出数据目录');
  });

  it('索引循环引用时报错', async () => {
    const files = {
      [`${BASE}tileset.json`]: { root: { boundingVolume: SPHERE, geometricError: 1, content: { uri: 'a.json' } } },
      [`${BASE}a.json`]: { root: { boundingVolume: SPHERE, geometricError: 1, content: { uri: 'tileset.json' } } }
    };

    await expect(prepare(files)).rejects.toThrow('索引循环引用：tileset.json');
  });

  it('几何误差：没有内容的取子节点的最大值，叶节点为 0，子节点不超过父节点；索引的误差等于根节点的', async () => {
    const prepared = await prepare({
      [`${BASE}tileset.json`]: {
        geometricError: 53670,
        root: {
          boundingVolume: SPHERE,
          geometricError: 53670,
          children: [
            {
              boundingVolume: SPHERE,
              geometricError: 99999,
              content: { uri: 'a.b3dm' },
              children: [{ boundingVolume: SPHERE, geometricError: 5, content: { uri: 'b.b3dm' } }]
            },
            { boundingVolume: SPHERE, geometricError: 30, content: { uri: 'c.b3dm' } }
          ]
        }
      }
    });

    // 根没有内容：取子节点的最大值 99999；第一个子节点保留自己的误差，叶节点为 0
    expect(prepared.geometricError).toBe(99999);
    expect(prepared.root.geometricError).toBe(99999);
    expect(prepared.root.children?.map(child => child.geometricError)).toStrictEqual([99999, 0]);
    expect(prepared.root.children?.[0]?.children?.[0]?.geometricError).toBe(0);
  });

  it('没有内容的节点下面都是叶节点时保留自己的误差：取 0 时 Cesium 不再细分，什么也不画（白膜的索引）', async () => {
    const prepared = await prepare({
      [`${BASE}tileset.json`]: {
        geometricError: 774.14,
        root: {
          boundingVolume: SPHERE,
          geometricError: 193.53,
          refine: 'REPLACE',
          children: [
            { boundingVolume: SPHERE, geometricError: 0, content: { uri: 'tiles/1_0_0.b3dm' } },
            { boundingVolume: SPHERE, geometricError: 0, content: { uri: 'tiles/1_1_0.b3dm' } }
          ]
        }
      }
    });

    expect(prepared.geometricError).toBe(193.53);
    expect(prepared.root.geometricError).toBe(193.53);
    expect(prepared.root.children?.map(child => child.geometricError)).toStrictEqual([0, 0]);
  });

  it('旧版写作 url 的内容地址也认，整理后统一写作 uri', async () => {
    const prepared = await prepare({
      [`${BASE}tileset.json`]: { root: { boundingVolume: SPHERE, geometricError: 0, content: { url: 'old.b3dm' } } }
    });

    expect(prepared.root.content).toStrictEqual({ uri: `${BASE}old.b3dm` });
  });

  it('不是索引、下载失败、已中止时以原因结束', async () => {
    await expect(prepare({ [`${BASE}tileset.json`]: '<html>' })).rejects.toThrow('不是 3D Tiles 索引');
    await expect(prepare({ [`${BASE}tileset.json`]: { asset: {} } })).rejects.toThrow('root 不是对象');
    await expect(prepare({})).rejects.toThrow('404');

    const controller = new AbortController();
    controller.abort(new DOMException('卸载了', 'AbortError'));
    const files = { [`${BASE}tileset.json`]: { root: { boundingVolume: SPHERE, geometricError: 0 } } };
    await expect(prepare(files, controller.signal)).rejects.toThrow('卸载了');
  });
});
