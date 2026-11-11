// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { translation } from './nav/nav-frame';
import { navigationLeaves } from './nav/nav-leaves';
import { type LoadJson, type PreparedTile, prepareTileset } from './prepare-tileset';

const BASE = 'https://maps.test/3dt/SZ_3DT/';
const SPHERE = { sphere: [1, 2, 3, 100] };
const ROOT_SPHERE = { sphere: [0, 0, 0, 7] };
// 绕 z 轴转 90°（列主序）：和平移相乘时顺序不同结果不同
const ROTATE_Z = [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

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

const boxOf = (size: number) => ({ box: [0, 0, 0, size, 0, 0, 0, size, 0, 0, 0, 10] });

// 根节点下一个引用 a.json 的瓦片，两边按需带 transform、refine
function externalFiles(
  options: {
    readonly outer?: readonly number[];
    readonly inner?: readonly number[];
    readonly refine?: string;
    readonly rootRefine?: string;
  } = {}
) {
  const { outer, inner, refine, rootRefine } = options;
  return {
    [`${BASE}tileset.json`]: {
      root: {
        boundingVolume: SPHERE,
        geometricError: 100,
        children: [
          {
            boundingVolume: SPHERE,
            geometricError: 10,
            content: { uri: 'a.json' },
            ...(outer ? { transform: outer } : {}),
            ...(refine ? { refine } : {})
          }
        ]
      }
    },
    [`${BASE}a.json`]: {
      root: {
        boundingVolume: ROOT_SPHERE,
        geometricError: 0,
        content: { uri: 'a.b3dm' },
        ...(inner ? { transform: inner } : {}),
        ...(rootRefine ? { refine: rootRefine } : {})
      }
    }
  };
}

const hoistedOf = async (options: Parameters<typeof externalFiles>[0]) =>
  (await prepare(externalFiles(options))).root.children?.[0];

// a.json 的根没有内容、下面两个叶节点；引用它的是索引的根，或者有内容的根下面一个带 transform 的子节点
function emptyRootFiles(referencedBy: 'root' | 'child') {
  const reference = { content: { uri: 'a.json' } };
  return {
    [`${BASE}tileset.json`]: {
      root: {
        boundingVolume: SPHERE,
        geometricError: 100,
        ...(referencedBy === 'root'
          ? reference
          : {
            content: { uri: 'p.b3dm' },
            children: [{ boundingVolume: SPHERE, geometricError: 20, transform: ROTATE_Z, ...reference }]
          })
      }
    },
    [`${BASE}a.json`]: {
      root: {
        boundingVolume: ROOT_SPHERE,
        geometricError: 20,
        refine: 'ADD',
        children: [
          {
            boundingVolume: SPHERE,
            geometricError: 0,
            transform: Array.from(translation(10, 0, 0)),
            content: { uri: 'b.b3dm' }
          },
          { boundingVolume: SPHERE, geometricError: 0, content: { uri: 'c.b3dm' } }
        ]
      }
    }
  };
}

describe('prepareTileset', () => {
  it('外部索引的根节点换到引用它的位置，内容地址改成绝对地址，其他字段照原样保留', async () => {
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
          boundingVolume: ROOT_SPHERE,
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
    // 中间没有不带内容的节点，误差和包围体是外部根节点的
    const hoisted = prepared.root.children?.[0];
    expect(hoisted?.content?.uri).toBe(`${BASE}Tile_1/Tile_1_L1.b3dm`);
    expect(hoisted?.geometricError).toBe(50);
    expect(hoisted?.boundingVolume).toStrictEqual(ROOT_SPHERE);
  });

  it('外部根节点没有内容时换上它的子节点（transform 相乘、refine 沿用）；索引的根引用它时保留这个根', async () => {
    const spliced = await prepare(emptyRootFiles('child'));
    const [b, c] = spliced.root.children ?? [];
    expect(spliced.root.children).toHaveLength(2);
    expect([b?.content?.uri, b?.refine, b?.transform]).toStrictEqual([
      `${BASE}b.b3dm`,
      'ADD',
      [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0, 10, 0, 1]
    ]);
    expect([c?.content?.uri, c?.refine, c?.transform]).toStrictEqual([`${BASE}c.b3dm`, 'ADD', ROTATE_Z]);

    const top = await prepare(emptyRootFiles('root'));
    expect(top.root.content).toBeUndefined();
    expect(top.root.boundingVolume).toStrictEqual(ROOT_SPHERE);
    expect(urisOf(top.root)).toStrictEqual([`${BASE}b.b3dm`, `${BASE}c.b3dm`]);
  });

  it('外部根节点是数据目录外的空占位时去掉引用它的瓦片；索引的根引用它时报错', async () => {
    const placeholder = { boundingVolume: { sphere: [0, 0, 0, 0] }, geometricError: 0, content: { uri: '../../x.b3dm' } };
    const prepared = await prepare({
      [`${BASE}tileset.json`]: {
        root: {
          boundingVolume: SPHERE,
          geometricError: 10,
          children: [
            { boundingVolume: SPHERE, geometricError: 1, content: { uri: 'a.json' } },
            { boundingVolume: SPHERE, geometricError: 1, content: { uri: 'b.b3dm' } }
          ]
        }
      },
      [`${BASE}a.json`]: { root: placeholder }
    });
    expect(urisOf(prepared.root)).toStrictEqual([`${BASE}b.b3dm`]);

    await expect(
      prepare({
        [`${BASE}tileset.json`]: { root: { boundingVolume: SPHERE, geometricError: 10, content: { uri: 'a.json' } } },
        [`${BASE}a.json`]: { root: placeholder }
      })
    ).rejects.toThrow('根节点是空占位');
  });

  it('多层外部索引各带 transform：逐层相乘，导航网格的叶节点坐标变换和不换位置时相同', async () => {
    const prepared = await prepare({
      [`${BASE}tileset.json`]: {
        root: {
          boundingVolume: SPHERE,
          geometricError: 100,
          children: [{ boundingVolume: SPHERE, geometricError: 10, transform: ROTATE_Z, content: { uri: 'a.json' } }]
        }
      },
      [`${BASE}a.json`]: {
        root: {
          boundingVolume: SPHERE,
          geometricError: 10,
          transform: Array.from(translation(10, 0, 0)),
          content: { uri: 'a.b3dm' },
          children: [
            {
              boundingVolume: SPHERE,
              geometricError: 1,
              transform: Array.from(translation(0, 3, 0)),
              content: { uri: 'b.json' }
            }
          ]
        }
      },
      [`${BASE}b.json`]: { root: { boundingVolume: SPHERE, geometricError: 0, content: { uri: 'b.b3dm' } } }
    });

    const a = prepared.root.children?.[0];
    expect(a?.transform).toStrictEqual([0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0, 10, 0, 1]);
    expect(a?.children?.[0]?.transform).toStrictEqual(Array.from(translation(0, 3, 0)));
    // 转 90° 后再平移 (10, 3, 0)，也就是落在 (-3, 10, 0)
    expect(navigationLeaves(prepared).map(leaf => [leaf.url, Array.from(leaf.toLocal)])).toStrictEqual([
      [`${BASE}b.b3dm`, [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, -3, 10, 0, 1]]
    ]);
  });

  it('CesiumLab 的多层外部索引：每一层都换成外部根节点，没有内容的节点只剩索引的根，根保留自己的误差', async () => {
    const prepared = await prepare({
      [`${BASE}tileset.json`]: {
        geometricError: 4424.79,
        root: {
          boundingVolume: boxOf(1400),
          geometricError: 4424.79,
          refine: 'REPLACE',
          children: [{ boundingVolume: boxOf(1400), geometricError: 163.89, content: { uri: 'top/0.json' } }]
        }
      },
      [`${BASE}top/0.json`]: {
        geometricError: 163.89,
        root: {
          boundingVolume: boxOf(1400),
          geometricError: 163.89,
          content: { uri: '0.glb' },
          children: [
            { boundingVolume: boxOf(50), geometricError: 7.25, content: { uri: '../Tile_1/Tile_1.json' } },
            { boundingVolume: boxOf(1400), geometricError: 163.89, content: { uri: 'empty.glb' } }
          ]
        }
      },
      [`${BASE}Tile_1/Tile_1.json`]: {
        geometricError: 7.25,
        root: {
          boundingVolume: boxOf(50),
          geometricError: 7.25,
          content: { uri: 'Tile_1.glb' },
          children: [{ boundingVolume: boxOf(50), geometricError: 0, content: { uri: 'Tile_1_L2.glb' } }]
        }
      }
    });

    const empty: PreparedTile[] = [];
    const collectEmpty = (tile: PreparedTile) => {
      if (!tile.content) {
        empty.push(tile);
      }
      tile.children?.forEach(collectEmpty);
    };
    collectEmpty(prepared.root);
    expect(empty).toStrictEqual([prepared.root]);
    // 根的误差不能改小：改小后远处当时的 Cesium 在根上停下，整个模型都不画
    expect(prepared.geometricError).toBe(4424.79);
    expect(prepared.root.geometricError).toBe(4424.79);
    const top = prepared.root.children?.[0];
    expect([top?.content?.uri, top?.geometricError]).toStrictEqual([`${BASE}top/0.glb`, 163.89]);
    const block = top?.children?.[0];
    expect([block?.content?.uri, block?.geometricError]).toStrictEqual([`${BASE}Tile_1/Tile_1.glb`, 7.25]);
  });

  it('换位置时引用瓦片的 transform 在外、外部根节点的在内相乘，只有一边时照原样；结果是能写进 JSON 的数组', async () => {
    const inner = Array.from(translation(10, 0, 0));

    // 先转再平移：平移量跟着转到 y 方向；反过来乘会留在 x 方向
    const both = (await hoistedOf({ outer: ROTATE_Z, inner }))?.transform;
    expect(both).toStrictEqual([0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0, 10, 0, 1]);
    expect(JSON.parse(JSON.stringify(both))).toStrictEqual(both);
    expect((await hoistedOf({ outer: ROTATE_Z }))?.transform).toStrictEqual(ROTATE_Z);
    expect((await hoistedOf({ inner }))?.transform).toStrictEqual(inner);
    const plain = await hoistedOf({});
    expect(plain?.content?.uri).toBe(`${BASE}a.b3dm`);
    expect(plain).not.toHaveProperty('transform');
    await expect(hoistedOf({ outer: [1, 2, 3] })).rejects.toThrow('tileset.json 的瓦片 的 transform 不是 16 个数');
    await expect(hoistedOf({ inner: [1, 2, 3] })).rejects.toThrow('a.json 的瓦片 的 transform 不是 16 个数');
  });

  it('外部根节点没写 refine 时沿用引用瓦片的，写了的用自己的', async () => {
    expect((await hoistedOf({ refine: 'ADD' }))?.refine).toBe('ADD');
    expect((await hoistedOf({ refine: 'ADD', rootRefine: 'REPLACE' }))?.refine).toBe('REPLACE');
  });

  it('引用外部索引的瓦片又有子节点时报错（3D Tiles 不允许）', async () => {
    const files = {
      [`${BASE}tileset.json`]: {
        root: {
          boundingVolume: SPHERE,
          geometricError: 10,
          content: { uri: 'a.json' },
          children: [{ boundingVolume: SPHERE, geometricError: 0, content: { uri: 'b.b3dm' } }]
        }
      },
      [`${BASE}a.json`]: { root: { boundingVolume: SPHERE, geometricError: 0, content: { uri: 'a.b3dm' } } }
    };

    await expect(prepare(files)).rejects.toThrow('引用了外部索引，不能再有子节点：a.json');
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

  it('几何误差：没有内容的取自己和子节点的较大值，有内容的用自己的，叶节点为 0，子节点不超过父节点', async () => {
    const leaf = (uri: string) => ({ boundingVolume: SPHERE, geometricError: 0, content: { uri } });
    const prepared = await prepare({
      [`${BASE}tileset.json`]: {
        geometricError: 100,
        root: {
          boundingVolume: SPHERE,
          geometricError: 100,
          children: [
            {
              boundingVolume: SPHERE,
              geometricError: 10,
              children: [{ boundingVolume: SPHERE, geometricError: 50, children: [leaf('a.b3dm')] }]
            },
            {
              boundingVolume: SPHERE,
              geometricError: 20,
              content: { uri: 'p.b3dm' },
              children: [
                { boundingVolume: SPHERE, geometricError: 40, content: { uri: 'q.b3dm' }, children: [leaf('r.b3dm')] }
              ]
            },
            { boundingVolume: SPHERE, geometricError: 30, content: { uri: 'c.b3dm' } }
          ]
        }
      }
    });

    const [empty, withContent, single] = prepared.root.children ?? [];
    // 没有内容的 10 抬到子节点的 50：取 10 时子节点被压到 10，当时的 Cesium 停在没有内容的子节点上，这一块就空了
    expect([empty?.geometricError, empty?.children?.[0]?.geometricError]).toStrictEqual([50, 50]);
    // 有内容的用自己的 20，子节点的 40 压到 20；叶节点为 0；索引的误差等于根节点的
    expect([withContent?.geometricError, withContent?.children?.[0]?.geometricError]).toStrictEqual([20, 20]);
    expect(single?.geometricError).toBe(0);
    expect([prepared.geometricError, prepared.root.geometricError]).toStrictEqual([100, 100]);
  });

  it('没有内容的节点下面都是叶节点时用自己的误差：取 0 时当时的 Cesium 不再细分，什么也不画（白膜的索引）', async () => {
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
