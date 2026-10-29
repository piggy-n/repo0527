// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { JIANGSU_CITIES } from '@/shared/map/region/region-catalog';
import { contributions, indicatorResult, passState, sensitivity, valueBreaks } from './analysis';
import { createCalculator } from './calculator';
import { defaultParams, type SimulationParams } from './params';
import { loadTestAtlas } from './test-atlas';

const conditions = {
  years: [2026, 2025],
  cityCodes: JIANGSU_CITIES.map(city => city.code),
  indicatorIds: ['B-65', 'A-31', 'A-39', 'A-15']
};
const withPatch = (patch: Partial<SimulationParams>): SimulationParams => ({ ...defaultParams(), ...patch });
const calculatorOf = async () => createCalculator(await loadTestAtlas());

describe('contributions', () => {
  it('逐项替换参数，各项贡献加起来等于总的变化；对这项指标不起作用的参数不列；目标值只算达标城市', async () => {
    const calculator = await calculatorOf();
    const to = withPatch({ popChange: 10, rule: 'old', recognition: 'intersect', targets: { ...defaultParams().targets, 'A-31': 75 } });
    const steps = contributions(calculator, conditions, defaultParams(), to, 'A-31', 2026);
    const value = (params: SimulationParams) => indicatorResult(calculator.computeYear(conditions, params, 2026).indicators, 'A-31');

    expect(steps.map(step => [step.key, step.from, step.to])).toEqual([
      ['rule', '新规程', '旧规程'],
      ['recognition', '覆盖 ≥ 50%', '相交即算'],
      ['targets', '80', '75']
    ]);
    expect(steps.reduce((sum, step) => sum + step.delta, 0)).toBeCloseTo(value(to).value - value(defaultParams()).value, 6);
    expect(steps.reduce((sum, step) => sum + step.passDelta, 0)).toBe(value(to).passCount - value(defaultParams()).passCount);
    expect(steps[0]?.delta).toBeLessThan(0);
    expect(steps[1]?.delta).toBeGreaterThan(0);
    expect(steps.at(-1)?.delta).toBe(0);
  });

  it('别的指标改了目标值，不算这项指标的改动', async () => {
    const calculator = await calculatorOf();
    const to = withPatch({ targets: { ...defaultParams().targets, 'A-31': 70 } });

    expect(contributions(calculator, conditions, defaultParams(), to, 'B-65', 2026)).toEqual([]);
  });
});

describe('sensitivity', () => {
  it('人均类：常住人口 −20%～+20% 共 9 个点，人口越多人均值越低，当前取值是参数里的', async () => {
    const curve = sensitivity(await calculatorOf(), conditions, withPatch({ popChange: 10 }), 'A-39', 2026);
    if (curve?.kind !== 'curve') {
      throw new Error('人均类应是曲线');
    }
    const values = curve.points.map(([, value]) => value);

    expect(curve.points.map(([x]) => x)).toEqual([-20, -15, -10, -5, 0, 5, 10, 15, 20]);
    expect(values.toSorted((a, b) => b - a)).toEqual(values);
    expect(curve.current).toBe(10);
  });

  it('社区卫生覆盖率：规程和认定的四种组合，旧规程最低、相交即算最高，标出当前', async () => {
    const result = sensitivity(await calculatorOf(), conditions, withPatch({ rule: 'old' }), 'A-31', 2026);
    if (result?.kind !== 'options') {
      throw new Error('覆盖率应是组合');
    }
    const value = (label: string) => result.options.find(option => option.label === label)?.value ?? Number.NaN;

    expect(result.keys).toEqual(['rule', 'recognition']);
    expect(result.options.map(option => [option.label, option.current, option.standard])).toEqual([
      ['标准口径', false, true],
      ['相交即算', false, false],
      ['旧规程', true, false],
      ['旧规程 + 相交即算', false, false]
    ]);
    expect(value('旧规程')).toBeLessThan(value('标准口径'));
    expect(value('相交即算')).toBeGreaterThan(value('标准口径'));
  });

  it('公园绿地覆盖率只有认定一项：两种组合；消防救援没有可调参数：没有敏感性', async () => {
    const calculator = await calculatorOf();
    const result = sensitivity(calculator, conditions, defaultParams(), 'B-65', 2026);

    expect(result?.kind === 'options' && [result.keys, result.options.map(option => option.label)]).toEqual([
      ['recognition'],
      ['标准口径', '相交即算']
    ]);
    expect(sensitivity(calculator, conditions, defaultParams(), 'A-15', 2026)).toBeNull();
  });
});

describe('分级与达标', () => {
  it('分级断点：所选年度标准口径下区县值的五档分位数，递增', async () => {
    const breaks = valueBreaks(await calculatorOf(), conditions, 'B-65');

    expect(breaks).toEqual([44, 61, 72, 82]);
  });

  it('达标、接近（差距在 5% 以内）、未达标', () => {
    expect([passState(70, 70), passState(66.5, 70), passState(66.4, 70)]).toEqual(['pass', 'near', 'fail']);
  });
});
