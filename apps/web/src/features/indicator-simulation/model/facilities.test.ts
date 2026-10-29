// @vitest-environment node
import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';
import { describe, expect, it } from 'vitest';
import { createCalculator } from './calculator';
import { createFacilityLayout } from './facilities';
import { defaultParams, type SimulationParams } from './params';
import { loadTestAtlas } from './test-atlas';

// 镇江 6 个区县：点数适中，测试快
const conditions = { years: [2026], cityCodes: ['321100'], indicatorIds: ['B-65', 'A-39', 'B-61'] };
const withPatch = (patch: Partial<SimulationParams>): SimulationParams => ({ ...defaultParams(), ...patch });
const layoutOf = async () => {
  const calculator = createCalculator(await loadTestAtlas());
  return { calculator, layout: createFacilityLayout(calculator) };
};

describe('createFacilityLayout', () => {
  it('点都落在所属区县里，同样的参数得到同样的点', async () => {
    const { calculator, layout } = await layoutOf();
    const points = layout.points(conditions, 'B-65', defaultParams(), 2026);
    const outside = points.filter(point => {
      const { geometry } = calculator.atlas.get(point.districtCode);
      return !booleanPointInPolygon([...point.coordinates], { type: 'Feature', properties: {}, geometry });
    });

    expect(points.length).toBeGreaterThan(100);
    expect(outside).toEqual([]);
    expect(createFacilityLayout(calculator).points(conditions, 'B-65', defaultParams(), 2026)).toEqual(points);
  });

  it('同一种设施（公园绿地）的覆盖率和人均值用同一批点', async () => {
    const { layout } = await layoutOf();

    expect(layout.points(conditions, 'A-39', defaultParams(), 2026)).toEqual(layout.points(conditions, 'B-65', defaultParams(), 2026));
  });

  it('纳入口径越窄点越少，数量与叙述用的总数一致', async () => {
    const { layout } = await layoutOf();
    const counts = (['all', 'standard', 'large'] as const).map(scope => {
      const params = withPatch({ facilityScope: scope });
      return [layout.points(conditions, 'B-65', params, 2026).length, layout.total(conditions, 'B-65', params, 2026)];
    });

    const [all = 0, standard = 0, large = 0] = counts.map(([points = 0]) => points);
    expect(all).toBeGreaterThan(standard);
    expect(standard).toBeGreaterThan(large);
    for (const [points = 0, total = 0] of counts) {
      expect(Math.abs(points - total) / total).toBeLessThan(0.05);
    }
  });

  it('规划新增：按现状点数的比例补点，只作用于范围里的指标', async () => {
    const { layout } = await layoutOf();
    const base = layout.points(conditions, 'B-65', defaultParams(), 2026);
    const planned = layout.points(conditions, 'B-65', withPatch({ newFacilities: 20 }), 2026).filter(point => point.planned);
    const outOfScope = layout.points(conditions, 'B-61', withPatch({ newFacilities: 20, scenarioIds: ['B-65'] }), 2026);

    expect(planned.length / base.length).toBeGreaterThan(0.15);
    expect(planned.length / base.length).toBeLessThan(0.3);
    expect(outOfScope.some(point => point.planned)).toBe(false);
  });

  it('没有覆盖率指标的设施（体育用地）按人口估算数量', async () => {
    const { layout } = await layoutOf();

    expect(layout.total(conditions, 'B-61', defaultParams(), 2026)).toBeGreaterThan(0);
  });
});
