// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { type ScanWalkway, walkwayTriangles } from './walkway';

// 三角形的顶点 [x, y, z]
const verticesOf = (points: Float32Array) =>
  Array.from({ length: points.length / 3 }, (_, i) => [points[i * 3], points[i * 3 + 1], points[i * 3 + 2]]);

describe('walkwayTriangles', () => {
  it('每段一个矩形，两头各伸出半个宽度，从起点的高度斜到终点的高度', () => {
    const points = walkwayTriangles([
      {
        path: [
          [0, 0, 0],
          [4, 0, 1]
        ],
        width: 1
      }
    ]);

    expect(points).toHaveLength(2 * 9);
    const vertices = verticesOf(points);
    expect(Math.min(...vertices.map(([x]) => x))).toBeCloseTo(-0.5);
    expect(Math.max(...vertices.map(([x]) => x))).toBeCloseTo(4.5);
    expect(Math.min(...vertices.map(([, y]) => y))).toBeCloseTo(-0.5);
    expect(Math.max(...vertices.map(([, y]) => y))).toBeCloseTo(0.5);
    // 起点一头在 0 米，终点一头在 1 米
    for (const [x, , z] of vertices) {
      expect(z).toBe(x < 2 ? 0 : 1);
    }
  });

  it('拐弯处两段各自伸出去，盖住拐角；水平长度为 0 的段跳过', () => {
    const points = walkwayTriangles([
      {
        path: [
          [0, 0, 0],
          [2, 0, 0],
          [2, 0, 0.3],
          [2, 2, 0.3]
        ],
        width: 0.8
      }
    ]);

    expect(points).toHaveLength(2 * 2 * 9);
    const vertices = verticesOf(points);
    // 第一段伸到 x = 2.4，第二段从 y = -0.4 开始：拐角 (2.4, -0.4) 这一侧也盖住了
    expect(Math.max(...vertices.map(([x]) => x))).toBeCloseTo(2.4);
    expect(Math.min(...vertices.map(([, y]) => y))).toBeCloseTo(-0.4);
  });

  it('几条一起换，没有时是空的', () => {
    const one: ScanWalkway = {
      path: [
        [0, 0, 0],
        [1, 0, 0]
      ],
      width: 1
    };
    expect(walkwayTriangles([one, one])).toHaveLength(4 * 9);
    expect(walkwayTriangles([])).toHaveLength(0);
  });
});
