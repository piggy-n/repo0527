// @vitest-environment node
import type { Position } from 'geojson';
import { describe, expect, it } from 'vitest';
import {
  ANALYSIS_VERTICES,
  AREA_LIMITS,
  coordinateIssue,
  geometryMeasure,
  prepareArea,
  vertexCount
} from './area-geometry';

// 南京附近边长约 1 千米的正方形
const square = (west: number, south: number, size = 0.01): Position[] => [
  [west, south],
  [west + size, south],
  [west + size, south + size],
  [west, south + size],
  [west, south]
];

function prepared(polygons: Position[][][]) {
  const result = prepareArea(polygons);
  if (!result.ok) {
    throw new Error(`应当可以使用：${result.problem.message}`);
  }
  return result.area;
}

describe('prepareArea', () => {
  it('整理成 MultiPolygon，算出面积和节点数', () => {
    const area = prepared([[square(118.8, 32)]]);
    expect(area.geometry.type).toBe('MultiPolygon');
    // 0.01 度经度约 0.944 千米（北纬 32 度），0.01 度纬度约 1.109 千米
    expect(area.area).toBeCloseTo(1.047, 2);
    expect(area.vertices).toBe(4);
    expect(area.notices).toEqual([]);
  });

  it('互相重叠的面合并，面积不重复计算，并提示', () => {
    const area = prepared([[square(118.8, 32, 0.02)], [square(118.81, 32.01, 0.02)]]);
    const single = geometryMeasure({ type: 'Polygon', coordinates: [square(118.8, 32, 0.02)] }).area;
    expect(area.area).toBeLessThan(single * 2);
    expect(area.area).toBeCloseTo(single * 1.75, 1);
    expect(area.notices).toContain('范围里有交叉的边或互相重叠的面，已合并为有效的面');
  });

  it('交叉的边（8 字形）拆成两个面', () => {
    const bowtie: Position[] = [[118.8, 32], [118.82, 32.02], [118.82, 32], [118.8, 32.02], [118.8, 32]];
    const area = prepared([[bowtie]]);
    expect(area.geometry.coordinates).toHaveLength(2);
    expect(area.notices).toContain('范围里有交叉的边或互相重叠的面，已合并为有效的面');
  });

  it('去掉不足 3 个节点的环，未闭合的环补上首点', () => {
    const open = square(118.8, 32).slice(0, -1);
    const area = prepared([[open], [[[118.9, 32], [118.91, 32], [118.9, 32]]]]);
    expect(area.geometry.coordinates).toHaveLength(1);
    expect(area.notices).toEqual(['去掉了 1 个不足 3 个节点的环']);
  });

  it('全部退化、没有面积时不能使用', () => {
    expect(prepareArea([[[[118.8, 32], [118.81, 32], [118.8, 32]]]])).toMatchObject({
      ok: false,
      problem: { code: 'geometry-invalid' }
    });
    const line: Position[] = [[118.8, 32], [118.81, 32], [118.82, 32], [118.8, 32]];
    expect(prepareArea([[line]])).toMatchObject({ ok: false, problem: { code: 'geometry-invalid' } });
  });

  it('面积不足 1 公顷、超过上限时不能使用', () => {
    expect(prepareArea([[square(118.8, 32, 0.0005)]])).toMatchObject({ ok: false, problem: { code: 'too-small' } });
    expect(prepareArea([[square(110, 25, 5)]])).toMatchObject({ ok: false, problem: { code: 'too-large' } });
  });

  it('节点超过上限时不整理', () => {
    const ring: Position[] = Array.from({ length: AREA_LIMITS.vertices + 1 }, (_, index) => [
      118 + Math.cos(index) * 0.1,
      32 + Math.sin(index) * 0.1
    ]);
    expect(prepareArea([[ring]])).toMatchObject({ ok: false, problem: { code: 'too-complex' } });
  });

  it('节点很多时按逐步加大的容差简化后再分析，并说明精度和面积变化', () => {
    const count = 20_000;
    const ring: Position[] = Array.from({ length: count }, (_, index) => {
      const angle = (index / count) * Math.PI * 2;
      const radius = 0.2 * (1 + 0.1 * Math.sin(angle * 37) + 0.0005 * Math.sin(angle * 4001));
      return [118.8 + Math.cos(angle) * radius, 32 + Math.sin(angle) * radius];
    });
    const area = prepared([[[...ring, ring[0] ?? [0, 0]]]]);
    expect(area.vertices).toBeLessThanOrEqual(ANALYSIS_VERTICES);
    expect(area.notices).toHaveLength(1);
    expect(area.notices[0]).toMatch(/^范围有 20,000 个节点，分析时按约 \d+ 米的精度简化为 [\d,]+ 个，面积变化(不到 0\.01| 0\.\d\d)%$/);
  });

  it('缩略图的轮廓不超过 400 个节点', () => {
    const ring: Position[] = Array.from({ length: 5000 }, (_, index) => {
      const angle = (index / 5000) * Math.PI * 2;
      const radius = 0.1 * (1 + 0.1 * Math.sin(angle * 40));
      return [118.8 + Math.cos(angle) * radius, 32 + Math.sin(angle) * radius];
    });
    const area = prepared([[[...ring, ring[0] ?? [0, 0]]]]);
    expect(area.vertices).toBe(5000);
    expect(vertexCount(area.outline)).toBeLessThanOrEqual(400);
  });
});

describe('coordinateIssue', () => {
  it('分出投影坐标、经纬度颠倒和不是数的值', () => {
    expect(coordinateIssue([[square(118.8, 32)]])).toBeNull();
    expect(coordinateIssue([[[[40512345, 3540000], [40513345, 3540000], [40512345, 3541000]]]])).toBe('projected');
    expect(coordinateIssue([[[[32, 118.8], [32.01, 118.8], [32, 118.81]]]])).toBe('swapped');
    expect(coordinateIssue([[[[118.8, Number.NaN], [118.81, 32], [118.8, 32.01]]]])).toBe('invalid');
  });
});
