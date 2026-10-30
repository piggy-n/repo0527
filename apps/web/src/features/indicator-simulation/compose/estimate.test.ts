// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { JIANGSU_CITIES } from '@/shared/map/region/region-catalog';
import { indicatorResult } from '../model/analysis';
import { createCalculator } from '../model/calculator';
import { defaultParams, type SimulationParams } from '../model/params';
import { loadTestAtlas } from '../model/test-atlas';
import { estimate } from './estimate';

const nanjing = { years: [2025], cityCodes: ['320100'], indicatorIds: ['A-31', 'B-65'] };
const withPatch = (patch: Partial<SimulationParams>): SimulationParams => ({ ...defaultParams(), ...patch });
const calculatorOf = async () => createCalculator(await loadTestAtlas());

describe('estimate', () => {
  it('年度、范围、指标有一项没选时没有预估', async () => {
    const calculator = await calculatorOf();
    expect(estimate(calculator, { ...nanjing, years: [] }, defaultParams())).toBeNull();
    expect(estimate(calculator, { ...nanjing, cityCodes: [] }, defaultParams())).toBeNull();
    expect(estimate(calculator, { ...nanjing, indicatorIds: [] }, defaultParams())).toBeNull();
  });

  it('一个市：值和计算一致；自定义口径的指标带标准口径的值，标准口径的没有', async () => {
    const calculator = await calculatorOf();
    const params = withPatch({ rule: 'old' });
    const result = estimate(calculator, nanjing, params);
    const [rule, park] = result?.rows ?? [];
    const valueOf = (next: SimulationParams, id: string) =>
      indicatorResult(calculator.computeYear(nanjing, next, 2025).indicators, id).value;

    expect(result?.scope).toBe('南京市');
    expect(result?.year).toBe(2025);
    expect(rule).toStrictEqual({
      indicator: rule?.indicator,
      value: valueOf(params, 'A-31'),
      standard: valueOf(defaultParams(), 'A-31')
    });
    expect(rule?.value).toBeLessThan(rule?.standard ?? 0);
    expect(park?.standard).toBeNull();
  });

  it('几个市：全省时范围写全省', async () => {
    const calculator = await calculatorOf();
    const all = { ...nanjing, cityCodes: JIANGSU_CITIES.map(city => city.code), indicatorIds: ['B-65'] };
    const result = estimate(calculator, all, defaultParams());

    expect(result?.scope).toBe('全省');
    expect(estimate(calculator, { ...nanjing, cityCodes: ['320100', '320500'] }, defaultParams())?.scope).toBe('2 个市');
  });

  it('几个年度：默认最新一年，可以指定其中一年，指定的不在条件里时按最新一年', async () => {
    const calculator = await calculatorOf();
    const years = { ...nanjing, years: [2026, 2024] };

    expect(estimate(calculator, years, defaultParams())?.year).toBe(2026);
    expect(estimate(calculator, years, defaultParams(), 2024)?.year).toBe(2024);
    expect(estimate(calculator, years, defaultParams(), 2025)?.year).toBe(2026);
    expect(estimate(calculator, years, defaultParams(), 2024)?.rows[0]?.value).toBe(
      indicatorResult(calculator.computeYear(years, defaultParams(), 2024).indicators, 'A-31').value
    );
  });
});
