// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { floorQuad, plyOf, triangles } from './nav-testing';
import { parsePlyTriangles } from './ply';

// 按头部和写入函数拼一个二进制 PLY
function ply(header: string, size: number, write: (view: DataView, offset: number) => void): ArrayBuffer {
  const head = new TextEncoder().encode(header);
  const out = new ArrayBuffer(head.length + size);
  new Uint8Array(out).set(head);
  write(new DataView(out), head.length);
  return out;
}

// 一个 1 × 1 米的正方形：四个顶点 double，面写成一个四边形，顶点多一个属性；面在顶点前面
const QUAD_HEADER =
  'ply\nformat binary_little_endian 1.0\n' +
  'element face 1\nproperty list uchar uint vertex_index\n' +
  'element vertex 4\nproperty double x\nproperty double y\nproperty double z\nproperty uchar red\nend_header\n';
const QUAD_SIZE = 1 + 4 * 4 + 4 * 25;

function quad(lastIndex = 3, extra = 0): ArrayBuffer {
  return ply(QUAD_HEADER, QUAD_SIZE + extra, (view, start) => {
    view.setUint8(start, 4);
    [0, 1, 2, lastIndex].forEach((index, k) => view.setUint32(start + 1 + k * 4, index, true));
    const corners = [
      [0, 0, 2],
      [1, 0, 2],
      [1, 1, 2],
      [0, 1, 2]
    ];
    corners.forEach((corner, i) => {
      const offset = start + 17 + i * 25;
      corner.forEach((value, k) => view.setFloat64(offset + k * 8, value, true));
      view.setUint8(offset + 24, 255);
    });
  });
}

describe('parsePlyTriangles', () => {
  it('LCC2 碰撞网格的写法：顶点三个 float，面是三角形，原样给出每个三角形的三个顶点', () => {
    const points = triangles(floorQuad(1, 2, 4, 6, -5.5));
    expect(Array.from(parsePlyTriangles(plyOf(points)))).toStrictEqual(Array.from(points));
  });

  it('多边形按扇形拆成三角形；跳过不是坐标的属性，面可以在顶点前面，double 也能读', () => {
    // 四边形 0-1-2-3 拆成 0-1-2 和 0-2-3
    expect(Array.from(parsePlyTriangles(quad()))).toStrictEqual([0, 0, 2, 1, 0, 2, 1, 1, 2, 0, 0, 2, 1, 1, 2, 0, 1, 2]);
  });

  it('不是二进制小端的 PLY、面引用了不存在的顶点、长度和头部对不上都报错', () => {
    expect(() => parsePlyTriangles(new TextEncoder().encode('solid stl\n').buffer)).toThrow('不是 PLY 文件');
    const ascii = ply('ply\nformat ascii 1.0\nelement vertex 0\nend_header\n', 0, () => undefined);
    expect(() => parsePlyTriangles(ascii)).toThrow('只支持二进制小端的 PLY');
    expect(() => parsePlyTriangles(quad(4))).toThrow('PLY 的面引用了不存在的顶点 4（共 4 个顶点）');
    expect(() => parsePlyTriangles(quad(3, 2))).toThrow('PLY 文件比头部声明的长 2 字节');
    expect(() => parsePlyTriangles(plyOf(triangles(floorQuad(0, 0, 1, 1, 0))).slice(0, -1))).toThrow(
      'PLY 文件比头部声明的短'
    );
  });
});
