// @vitest-environment node
import type { Position } from 'geojson';
import { describe, expect, it, vi } from 'vitest';
import { type AreaCoverage, COVER_RULES, coverRegions, type RegionShape } from './area-coverage';
import type { AreaGeometry } from './area-geometry';

const box = (west: number, south: number, east: number, north: number): Position[] => [
  [west, south],
  [east, south],
  [east, north],
  [west, north],
  [west, south]
];
const area = (...rings: Position[][]): AreaGeometry => ({
  type: 'MultiPolygon',
  coordinates: rings.map(ring => [ring])
});

// 两个相邻的行政区，各约 10 × 11 千米
const A: RegionShape = { code: 'A', geometry: { type: 'Polygon', coordinates: [box(118.8, 32, 118.9, 32.1)] } };
const B: RegionShape = { code: 'B', geometry: { type: 'Polygon', coordinates: [box(118.9, 32, 119, 32.1)] } };
const REGIONS = [A, B];

async function cover(geometry: AreaGeometry): Promise<AreaCoverage> {
  const outcome = await coverRegions(geometry, REGIONS, { scopeName: '测试区' });
  if (!outcome.ok) {
    throw new Error(`应当可以使用：${outcome.problem.message}`);
  }
  return outcome.coverage;
}

const relations = (coverage: AreaCoverage) => coverage.covers.map(({ code, relation }) => `${code}:${relation}`);

// 1 度经度在北纬 32 度约 94.4 千米，1 米约这么多度
const METER = 1 / 94400;

describe('coverRegions', () => {
  it('和行政区一样大时全部覆盖，只共边的邻居不算', async () => {
    const coverage = await cover(area(box(118.8, 32, 118.9, 32.1)));
    expect(relations(coverage)).toEqual(['A:full']);
    expect(coverage.covers[0]?.ratio).toBeCloseTo(1, 6);
    expect(coverage.touches).toEqual([]);
    expect(coverage.outsideArea).toBe(0);
  });

  it('盖住一半时部分覆盖，比例和面积按椭球面计算', async () => {
    const coverage = await cover(area(box(118.8, 32, 118.95, 32.1)));
    expect(relations(coverage)).toEqual(['A:full', 'B:partial']);
    const b = coverage.covers[1];
    expect(b?.ratio).toBeCloseTo(0.5, 3);
    // 分块求面积的舍入误差在平方米量级
    expect(coverage.coveredArea).toBeCloseTo(coverage.area, 3);
  });

  it('只越过边界几米的细条算边界相交，不算覆盖', async () => {
    const coverage = await cover(area(box(118.8, 32, 118.9 + 10 * METER, 32.1)));
    expect(relations(coverage)).toEqual(['A:full']);
    expect(coverage.touches.map(touch => touch.code)).toEqual(['B']);
  });

  it('边界向里缩几米仍是全部覆盖，缩几百米是部分覆盖', async () => {
    const near = await cover(area(box(118.8 + 5 * METER, 32 + 5 * METER, 118.9 - 5 * METER, 32.1 - 5 * METER)));
    expect(relations(near)).toEqual(['A:full']);
    expect(near.covers[0]?.ratio).toBeLessThan(1 - COVER_RULES.fullRatio / 10);
    const far = await cover(area(box(118.8 + 300 * METER, 32 + 300 * METER, 118.9 - 300 * METER, 32.1 - 300 * METER)));
    expect(relations(far)).toEqual(['A:partial']);
  });

  it('细长的范围（20 米宽）不按宽度判成边界相交', async () => {
    const corridor = await cover(area(box(118.85, 32.05, 118.95, 32.05 + 20 * METER)));
    expect(relations(corridor)).toEqual(['A:partial', 'B:partial']);
  });

  it('伸出行政区的部分记为在外面的面积', async () => {
    const coverage = await cover(area(box(118.7, 32, 118.9, 32.1)));
    expect(relations(coverage)).toEqual(['A:full']);
    expect(coverage.outsideArea).toBeCloseTo(coverage.area / 2, 0);
    expect(coverage.coveredArea).toBeCloseTo(coverage.area / 2, 0);
  });

  it('多块的范围分别求交', async () => {
    const coverage = await cover(area(box(118.82, 32.02, 118.84, 32.04), box(118.96, 32.02, 118.98, 32.04)));
    expect(relations(coverage)).toEqual(['A:partial', 'B:partial']);
  });

  it('不与行政区重叠，或只沿边界略有重叠时不能使用', async () => {
    await expect(coverRegions(area(box(116, 31, 116.1, 31.1)), REGIONS, { scopeName: '测试区' })).resolves.toEqual({
      ok: false,
      problem: { code: 'outside', message: '范围不在测试区内：与测试区的区县都不重叠。请检查坐标系，或重新绘制' }
    });
    const edge = await coverRegions(area(box(118.7, 32, 118.8 + 5 * METER, 32.1)), REGIONS, { scopeName: '测试区' });
    expect(edge).toMatchObject({ ok: false, problem: { code: 'outside' } });
    expect(edge.ok ? '' : edge.problem.message).toContain('只沿测试区的边界略有重叠');
  });

  it('每个行政区之前让出一次，取消时停下', async () => {
    const checkpoint = vi.fn<() => Promise<void>>(() => Promise.resolve());
    await coverRegions(area(box(118.8, 32, 118.95, 32.1)), REGIONS, { scopeName: '测试区', checkpoint });
    expect(checkpoint).toHaveBeenCalledTimes(2);
    const aborted = new DOMException('取消', 'AbortError');
    const cancel = vi.fn<() => Promise<void>>(() => Promise.reject(aborted));
    await expect(
      coverRegions(area(box(118.8, 32, 118.95, 32.1)), REGIONS, { scopeName: '测试区', checkpoint: cancel })
    ).rejects.toBe(aborted);
  });

  it('节点多时先裁到外包框再求交，结果不变', async () => {
    // 2400 个节点的圆，跨两个行政区
    const ring: Position[] = Array.from({ length: 2400 }, (_, index) => {
      const angle = (index / 2400) * Math.PI * 2;
      return [118.9 + Math.cos(angle) * 0.03, 32.05 + Math.sin(angle) * 0.03];
    });
    const coverage = await cover(area([...ring, ring[0] ?? [0, 0]]));
    expect(relations(coverage)).toEqual(['A:partial', 'B:partial']);
    expect(coverage.covers[0]?.area).toBeCloseTo(coverage.covers[1]?.area ?? 0, 1);
  });
});
