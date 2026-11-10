// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parsePly } from './ply.ts';
import { plyBytes } from './test-meshes.ts';

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

  it('文本格式、不是 PLY 的文件报错', () => {
    const ascii = new TextEncoder().encode('ply\nformat ascii 1.0\nelement vertex 0\nend_header\n');
    expect(() => parsePly(ascii)).toThrow('二进制小端');
    expect(() => parsePly(new TextEncoder().encode('hello'))).toThrow('不是 PLY');
  });
});
