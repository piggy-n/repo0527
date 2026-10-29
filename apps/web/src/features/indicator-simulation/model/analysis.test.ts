// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { JIANGSU_CITIES } from '@/shared/map/region/region-catalog';
import { contributions, indicatorResult, passState, sameFacility, sensitivity, suggestion, valueBreaks } from './analysis';
import { createCalculator } from './calculator';
import { defaultParams, type SimulationParams } from './params';
import { loadTestAtlas } from './test-atlas';

const conditions = { years: [2026, 2025], cityCodes: JIANGSU_CITIES.map(city => city.code), indicatorIds: ['B-65', 'A-31', 'A-39'] };
const withPatch = (patch: Partial<SimulationParams>): SimulationParams => ({ ...defaultParams(), ...patch });
const calculatorOf = async () => createCalculator(await loadTestAtlas());

describe('contributions', () => {
  it('逐项替换参数，各项贡献加起来等于总的变化；目标值只算达标城市', async () => {
    const calculator = await calculatorOf();
    const to = withPatch({ popCaliber: 'registered', walkSpeed: 75, newFacilities: 20, targets: { ...defaultParams().targets, 'B-65': 65 } });
    const steps = contributions(calculator, conditions, defaultParams(), to, 'B-65', 2026);
    const value = (params: SimulationParams) => indicatorResult(calculator.computeYear(conditions, params, 2026).indicators, 'B-65');

    expect(steps.map(step => [step.key, step.from, step.to])).toEqual([
      ['popCaliber', '常住人口', '户籍人口'],
      ['walkSpeed', '60 米/分钟', '75 米/分钟'],
      ['newFacilities', '0%', '20%（全部指标）'],
      ['targets', '70', '65']
    ]);
    expect(steps.reduce((sum, step) => sum + step.delta, 0)).toBeCloseTo(value(to).value - value(defaultParams()).value, 6);
    expect(steps.reduce((sum, step) => sum + step.passDelta, 0)).toBe(value(to).passCount - value(defaultParams()).passCount);
    expect(steps.at(-1)?.delta).toBe(0);
  });

  it('别的指标改了目标值，不算这项指标的改动', async () => {
    const calculator = await calculatorOf();
    const to = withPatch({ targets: { ...defaultParams().targets, 'A-31': 70 } });

    expect(contributions(calculator, conditions, defaultParams(), to, 'B-65', 2026)).toEqual([]);
  });
});

describe('sensitivity', () => {
  it('步行类覆盖率看步行速度：40～100 共 13 个点，单调上升，当前是 60', async () => {
    const curve = sensitivity(await calculatorOf(), conditions, defaultParams(), 'B-65', 2026);

    expect(curve.key).toBe('walkSpeed');
    expect(curve.points.map(([x]) => x)).toEqual([40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100]);
    expect(curve.points.map(([, value]) => value).toSorted((a, b) => a - b)).toEqual(curve.points.map(([, value]) => value));
    expect(curve.current).toBe(60);
  });

  it('人均类看规划新增；不在作用范围里时当前是 0，曲线按算进范围画', async () => {
    const curve = sensitivity(await calculatorOf(), conditions, withPatch({ newFacilities: 20, scenarioIds: ['B-65'] }), 'A-39', 2026);

    expect(curve.key).toBe('newFacilities');
    expect(curve.points).toHaveLength(11);
    expect(curve.current).toBe(0);
    expect(curve.points.at(-1)?.[1]).toBeGreaterThan(curve.points[0]?.[1] ?? Infinity);
  });
});

describe('suggestion', () => {
  it('找最小的新增比例：公园绿地新增 20% 时全省达到 70%，作用于同一种设施的两项指标', async () => {
    const calculator = await calculatorOf();
    const idea = suggestion(calculator, conditions, defaultParams(), 'B-65', 2026);

    expect(idea).toMatchObject({ add: 20, reached: true, scenarioIds: ['B-65', 'A-39'] });
    expect(idea?.after.value).toBeGreaterThanOrEqual(70);
    // 少 5 个百分点就不够
    const less = indicatorResult(calculator.computeYear(conditions, withPatch({ newFacilities: 15, scenarioIds: ['B-65', 'A-39'] }), 2026).indicators, 'B-65');
    expect(less.value).toBeLessThan(70);
    expect(less.passCount - (idea?.before.passCount ?? 0)).toBeLessThan(3);
  });

  it('全部达标时没有建议；新增到上限也达不到时给出上限情景', async () => {
    const calculator = await calculatorOf();
    const allPass = withPatch({ targets: { ...defaultParams().targets, 'B-65': 0 } });
    const unreachable = withPatch({ targets: { ...defaultParams().targets, 'B-65': 99.9 } });

    expect(suggestion(calculator, conditions, allPass, 'B-65', 2026)).toBeNull();
    expect(suggestion(calculator, conditions, unreachable, 'B-65', 2026)).toMatchObject({ add: 50, reached: false });
  });

  it('同一种设施的已选指标', () => {
    expect(sameFacility(conditions, 'A-39')).toEqual(['B-65', 'A-39']);
    expect(sameFacility(conditions, 'A-31')).toEqual(['A-31']);
  });
});

describe('分级与达标', () => {
  it('分级断点：所选年度默认参数下区县值的五档分位数，递增', async () => {
    const breaks = valueBreaks(await calculatorOf(), conditions, 'B-65');

    expect(breaks).toEqual([45, 61, 72, 83]);
  });

  it('达标、接近（差距在 5% 以内）、未达标', () => {
    expect([passState(70, 70), passState(66.5, 70), passState(66.4, 70)]).toEqual(['pass', 'near', 'fail']);
  });
});
