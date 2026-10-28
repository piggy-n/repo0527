// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseB3dmTriangles } from './b3dm';
import { translation } from './nav-frame';
import { b3dmOf, floorQuad, triangles } from './nav-testing';

const round = (values: Float32Array) => Array.from(values, value => Math.round(value * 1000) / 1000);

describe('parseB3dmTriangles', () => {
  it('glTF 的 y 向上换成 z 向上，加上 RTC_CENTER，再按 toLocal 换到根节点局部系', () => {
    const local = triangles(floorQuad(1, 2, 3, 5, -4));
    const buffer = b3dmOf(local, { rtc: [100, 200, -10] });

    expect(round(parseB3dmTriangles(buffer))).toStrictEqual(round(local));
    // 内容坐标再平移到根节点局部系
    const moved = round(parseB3dmTriangles(buffer, translation(10, 0, 1)));
    expect(moved.slice(0, 3)).toStrictEqual([11, 2, -3]);
  });

  it('带索引的三角形列表和不带索引的一样；跳过不是三角形列表的图元', () => {
    const local = triangles(floorQuad(0, 0, 2, 2, 0));
    const plain = parseB3dmTriangles(b3dmOf(local));

    expect(round(parseB3dmTriangles(b3dmOf(local, { indexed: true })))).toStrictEqual(round(plain));
    expect(parseB3dmTriangles(b3dmOf(local, { withLines: true }))).toHaveLength(plain.length);
  });

  it('不是 b3dm、要求不支持的扩展时抛错', () => {
    expect(() => parseB3dmTriangles(new TextEncoder().encode('i3dm0000000000000000000000000000').buffer)).toThrow(
      '不是 b3dm 瓦片'
    );
    const buffer = b3dmOf(triangles(floorQuad(0, 0, 1, 1, 0)), { extensionsRequired: ['KHR_draco_mesh_compression'] });
    expect(() => parseB3dmTriangles(buffer)).toThrow('不支持的 glTF 扩展：KHR_draco_mesh_compression');
  });
});
