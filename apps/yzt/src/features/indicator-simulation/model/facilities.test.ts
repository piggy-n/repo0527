// @vitest-environment node
import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';
import { describe, expect, it } from 'vitest';
import { createCalculator } from './calculator';
import { createFacilityLayout } from './facilities';
import { areaScope, citiesScope } from './scope';
import { NANJING_RINGS, testArea } from './test-area';
import { loadTestAtlas } from './test-atlas';

// 镇江 6 个区县：点数适中，测试快
const conditions = { years: [2026], scope: citiesScope(['321100']), indicatorIds: ['B-65', 'A-39', 'B-61'] };
const layoutOf = async () => {
  const calculator = createCalculator(await loadTestAtlas());
  return { calculator, layout: createFacilityLayout(calculator) };
};

describe('createFacilityLayout', () => {
  it('点都落在所属区县里，同样的条件得到同样的点', async () => {
    const { calculator, layout } = await layoutOf();
    const points = layout.points(conditions, 'B-65', 2026);
    const outside = points.filter(point => {
      const { geometry } = calculator.atlas.get(point.districtCode);
      return !booleanPointInPolygon([...point.coordinates], { type: 'Feature', properties: {}, geometry });
    });

    expect(points.length).toBeGreaterThan(100);
    expect(outside).toEqual([]);
    expect(createFacilityLayout(calculator).points(conditions, 'B-65', 2026)).toEqual(points);
  });

  it('同一种设施（公园绿地）的覆盖率和人均值用同一批点', async () => {
    const { layout } = await layoutOf();

    expect(layout.points(conditions, 'A-39', 2026)).toEqual(layout.points(conditions, 'B-65', 2026));
  });

  it('撒点数量与叙述用的总数一致', async () => {
    const { layout } = await layoutOf();
    const points = layout.points(conditions, 'B-65', 2026).length;
    const total = layout.total(conditions, 'B-65', 2026);

    expect(Math.abs(points - total) / total).toBeLessThan(0.05);
  });

  it('没有覆盖率指标的设施（体育用地）按人口估算数量', async () => {
    const { layout } = await layoutOf();

    expect(layout.total(conditions, 'B-61', 2026)).toBeGreaterThan(0);
  });
});

describe('自定义范围的设施点（ADR 0121）', () => {
  it('只留范围内的点；数量就是地图上的点数', async () => {
    const { calculator, layout } = await layoutOf();
    const area = await testArea(calculator.atlas, NANJING_RINGS);
    const custom = { years: [2026], scope: areaScope(area), indicatorIds: ['B-65'] };
    const points = layout.points(custom, 'B-65', 2026);
    const inside = { type: 'Feature' as const, properties: {}, geometry: area.geometry };
    const whole = layout.points({ ...custom, scope: citiesScope(['320100']) }, 'B-65', 2026);

    expect(points.length).toBeGreaterThan(0);
    expect(points.length).toBeLessThan(whole.length);
    expect(points.every(point => booleanPointInPolygon([...point.coordinates], inside))).toBe(true);
    expect(layout.total(custom, 'B-65', 2026)).toBe(points.length);
  });
});
