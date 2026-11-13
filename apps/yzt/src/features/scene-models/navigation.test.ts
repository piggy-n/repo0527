import { HttpResponse, http as mock } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fetchLcc2Index } from './api';
import { scanMeshesOf } from './navigation';

const server = setupServer();

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});

const INDEX_URL = 'http://localhost:3000/3dt/xuzhou/lcc2/%E5%A2%93/lcc2-sog-result/%E5%A2%93.lcc2';

// 两级节点：根节点没有网格，两个子节点各带一个，第二个下面还有一个；网格序号和 meshFiles 的顺序无关
const INDEX = {
  epsg: 4548,
  root: {
    id: '0',
    boundingBox: { min: [-10, -5, -2], max: [30, 40, 8] },
    meshFiles: ['data/mesh/a.ply', 'data/mesh/b.ply', 'data/mesh/c.ply'],
    child: {
      '0': {
        id: '0_0',
        boundingBox: { min: [-10, -5, -2], max: [10, 20, 8] },
        data: { splats: { name: 0 }, mesh: { name: 2, vertex: 30, face: 45 }, bvh: { name: 2 } }
      },
      '1': {
        id: '0_1',
        boundingBox: { min: [10, 20, -2], max: [30, 40, 8] },
        data: { mesh: { name: 0, vertex: 10, face: 12 } },
        child: {
          '0': {
            id: '0_1_0',
            boundingBox: { min: [10, 20, -2], max: [20, 30, 8] },
            data: { mesh: { name: 1, face: 7 } }
          }
        }
      }
    }
  }
};

describe('fetchLcc2Index、scanMeshesOf', () => {
  it('列出带碰撞网格的节点：文件按索引的地址解析，三角形数、包围盒照索引', async () => {
    server.use(mock.get(INDEX_URL, () => HttpResponse.json(INDEX)));
    const index = await fetchLcc2Index(INDEX_URL, new AbortController().signal);

    expect(scanMeshesOf(index, INDEX_URL)).toStrictEqual([
      {
        url: 'http://localhost:3000/3dt/xuzhou/lcc2/%E5%A2%93/lcc2-sog-result/data/mesh/c.ply',
        triangles: 45,
        min: [-10, -5, -2],
        max: [10, 20, 8]
      },
      {
        url: 'http://localhost:3000/3dt/xuzhou/lcc2/%E5%A2%93/lcc2-sog-result/data/mesh/a.ply',
        triangles: 12,
        min: [10, 20, -2],
        max: [30, 40, 8]
      },
      {
        url: 'http://localhost:3000/3dt/xuzhou/lcc2/%E5%A2%93/lcc2-sog-result/data/mesh/b.ply',
        triangles: 7,
        min: [10, 20, -2],
        max: [20, 30, 8]
      }
    ]);
  });

  it('开头带 BOM 的索引也能读；网格序号超出 meshFiles 时报错', async () => {
    const broken = { root: { ...INDEX.root, meshFiles: ['data/mesh/a.ply'] } };
    const body = `\uFEFF${JSON.stringify(broken)}`;
    server.use(mock.get(INDEX_URL, () => new HttpResponse(body, { headers: { 'Content-Type': 'application/json' } })));
    const index = await fetchLcc2Index(INDEX_URL, new AbortController().signal);

    expect(index.root.meshFiles).toStrictEqual(['data/mesh/a.ply']);
    expect(() => scanMeshesOf(index, INDEX_URL)).toThrow('LCC2 索引的网格序号 2 超出了 meshFiles（共 1 个）');
  });

  it('不是索引（节点没有包围盒）时请求失败', async () => {
    server.use(mock.get(INDEX_URL, () => HttpResponse.json({ root: { meshFiles: [] } })));
    await expect(fetchLcc2Index(INDEX_URL, new AbortController().signal)).rejects.toMatchObject({
      kind: 'invalid-response'
    });
  });
});
