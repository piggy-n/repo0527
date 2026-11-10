// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parsePly } from './ply.ts';
import { plyBytes } from './test-meshes.ts';

const emptyPly = (format: string) =>
  new TextEncoder().encode(`ply\nformat ${format} 1.0\nelement vertex 0\nend_header\n`);

describe('parsePly', () => {
  it('读出顶点和三角形', () => {
    const mesh = parsePly(plyBytes([0, 0, 1, 2, 0, 1, 0, 3, 1.5], [[0, 1, 2]]));
    expect([...mesh.positions]).toEqual([0, 0, 1, 2, 0, 1, 0, 3, 1.5]);
    expect([...mesh.triangles]).toEqual([0, 1, 2]);
  });

  it('四边形按扇形拆成两个三角形', () => {
    const mesh = parsePly(plyBytes([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], [[0, 1, 2, 3]]));
    expect([...mesh.triangles]).toEqual([0, 1, 2, 0, 2, 3]);
  });

  it('顶点多带的属性跳过，不错位', () => {
    const mesh = parsePly(plyBytes([1, 2, 3, 4, 5, 6, 7, 8, 9], [[2, 1, 0]], 2));
    expect([...mesh.positions]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect([...mesh.triangles]).toEqual([2, 1, 0]);
  });

  it('文本格式、大端、CRLF 换行、不是 PLY 的文件报错', () => {
    expect(() => parsePly(emptyPly('ascii'))).toThrow('二进制小端');
    expect(() => parsePly(emptyPly('binary_big_endian'))).toThrow('二进制小端');
    const crlf = new TextEncoder().encode('ply\r\nformat binary_little_endian 1.0\r\nend_header\r\n');
    expect(() => parsePly(crlf)).toThrow('CRLF');
    expect(() => parsePly(new TextEncoder().encode('hello'))).toThrow('不是 PLY');
  });

  it('别的类型和顺序：double 坐标、顶点多带 uchar、面在顶点前面、uint8 个数加 uint32 序号、面多带一个属性', () => {
    const header = [
      'ply',
      'format binary_little_endian 1.0',
      'element face 1',
      'property list uint8 uint32 vertex_index',
      'property uchar flags',
      'element vertex 3',
      'property double x',
      'property uchar quality',
      'property double y',
      'property double z',
      'end_header',
      ''
    ].join('\n');
    const head = new TextEncoder().encode(header);
    const bytes = new Uint8Array(head.length + 14 + 3 * 25);
    bytes.set(head);
    const view = new DataView(bytes.buffer);
    let offset = head.length;
    view.setUint8(offset, 3);
    offset += 1;
    for (const index of [2, 0, 1]) {
      view.setUint32(offset, index, true);
      offset += 4;
    }
    view.setUint8(offset, 7);
    offset += 1;
    for (const [x, y, z] of [
      [1.5, 2.5, 3.5],
      [4, 5, 6],
      [-7.25, 8, 9]
    ]) {
      view.setFloat64(offset, x, true);
      view.setUint8(offset + 8, 200);
      view.setFloat64(offset + 9, y, true);
      view.setFloat64(offset + 17, z, true);
      offset += 25;
    }
    const mesh = parsePly(bytes);
    expect([...mesh.positions]).toEqual([1.5, 2.5, 3.5, 4, 5, 6, -7.25, 8, 9]);
    expect([...mesh.triangles]).toEqual([2, 0, 1]);
  });

  it('面引用不存在的顶点（越界、负数）报错', () => {
    const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0];
    expect(() => parsePly(plyBytes(positions, [[0, 1, 5]]))).toThrow('不存在的顶点 5');
    expect(() => parsePly(plyBytes(positions, [[0, 1, -1]]))).toThrow('不存在的顶点 -1');
  });

  it('坐标不是有限数报错', () => {
    expect(() => parsePly(plyBytes([0, 0, 0, Number.NaN, 0, 0, 0, 1, 0], [[0, 1, 2]]))).toThrow('不是有限数');
  });

  it('文件比头部声明的短、长都报错', () => {
    const bytes = plyBytes([0, 0, 0, 1, 0, 0, 0, 1, 0], [[0, 1, 2]]);
    expect(() => parsePly(bytes.subarray(0, bytes.length - 3))).toThrow('比头部声明的短');
    const longer = new Uint8Array(bytes.length + 2);
    longer.set(bytes);
    expect(() => parsePly(longer)).toThrow('比头部声明的长 2 字节');
  });
});
