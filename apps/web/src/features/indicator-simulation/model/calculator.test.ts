// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { requireIndicator } from '@/shared/city-indicators/catalog';
import { mockIndicatorValue } from '@/shared/city-indicators/mock-value';
import { JIANGSU_CITIES } from '@/shared/map/region/region-catalog';
import { indicatorResult } from './analysis';
import { coverageStrength, createCalculator, INTERSECT_FACTOR, RULE_FACTOR } from './calculator';
import { simulationIndicator } from './indicators';
import { defaultParams, type SimulationParams } from './params';
import { loadTestAtlas } from './test-atlas';

const ALL = JIANGSU_CITIES.map(city => city.code);
const conditions = { years: [2026, 2025], cityCodes: ALL, indicatorIds: ['B-65', 'A-31', 'A-39', 'A-15'] };
const withPatch = (patch: Partial<SimulationParams>): SimulationParams => ({ ...defaultParams(), ...patch });
const calculatorOf = async () => createCalculator(await loadTestAtlas());
const resultOf = async (params: SimulationParams, id: string, year = 2026) =>
  indicatorResult((await calculatorOf()).computeYear(conditions, params, year).indicators, id);

describe('区县人口与住宅用地', () => {
  it('一个市各区县的人口加起来是该市的七普常住人口，不随年份变化', async () => {
    const calculator = await calculatorOf();
    const suzhou = calculator.atlas.inCities(['320500']);

    expect(suzhou.reduce((sum, district) => sum + calculator.districtPopulation(district), 0)).toBeCloseTo(1274.8, 6);
  });

  it('住宅用地都大于 0，市辖区占区县面积的比例高', async () => {
    const calculator = await calculatorOf();
    const share = (urban: boolean) => {
      const list = calculator.atlas.all.filter(district => district.urban === urban);
      return list.reduce((sum, district) => sum + calculator.residentialLand(district), 0) / list.reduce((sum, district) => sum + district.area, 0);
    };

    expect(calculator.atlas.all.every(district => calculator.residentialLand(district) > 0)).toBe(true);
    expect(share(true)).toBeGreaterThan(share(false) * 2);
  });
});

describe('computeYear', () => {
  it('标准口径下各年度的市值等于驾驶舱的模拟值（覆盖率和人均值都是）', async () => {
    const calculator = await calculatorOf();
    for (const year of [2025, 2026]) {
      const result = calculator.computeYear(conditions, defaultParams(), year);
      for (const id of ['B-65', 'A-39', 'A-15']) {
        for (const city of indicatorResult(result.indicators, id).cities) {
          expect(city.value).toBeCloseTo(mockIndicatorValue(city.code, requireIndicator(id), year), 1);
        }
      }
    }
  });

  it('汇总权重：住宅用地覆盖率按住宅用地，城区面积覆盖率按区县面积，人均值按人口', async () => {
    const calculator = await calculatorOf();
    const weights = (id: string) =>
      indicatorResult(calculator.computeYear(conditions, defaultParams(), 2026).indicators, id).rows.map(row => row.weight);
    const districts = calculator.atlas.inCities(ALL);

    expect(weights('B-65')).toEqual(districts.map(district => calculator.residentialLand(district)));
    expect(weights('A-15')).toEqual(districts.map(district => district.area));
    expect(weights('A-39')).toEqual(districts.map(district => calculator.districtPopulation(district)));
  });

  it('覆盖强度：旧规程打折扣、相交即算放大，只对用得上的指标', () => {
    const both = withPatch({ rule: 'old', recognition: 'intersect' });

    expect(coverageStrength(simulationIndicator('A-31'), both)).toBeCloseTo(RULE_FACTOR * INTERSECT_FACTOR, 9);
    expect(coverageStrength(simulationIndicator('B-65'), both)).toBe(INTERSECT_FACTOR);
    expect(coverageStrength(simulationIndicator('A-15'), both)).toBe(1);
    expect(coverageStrength(simulationIndicator('A-39'), both)).toBe(1);
    expect(coverageStrength(simulationIndicator('A-31'), defaultParams())).toBe(1);
  });

  it('旧规程让社区卫生覆盖率下降，不影响公园绿地覆盖率', async () => {
    const old = withPatch({ rule: 'old' });

    expect((await resultOf(old, 'A-31')).value).toBeLessThan((await resultOf(defaultParams(), 'A-31')).value);
    expect((await resultOf(old, 'B-65')).value).toBe((await resultOf(defaultParams(), 'B-65')).value);
  });

  it('相交即算让住宅用地覆盖率上升，城区面积覆盖率和人均值不变', async () => {
    const intersect = withPatch({ recognition: 'intersect' });

    expect((await resultOf(intersect, 'B-65')).value).toBeGreaterThan((await resultOf(defaultParams(), 'B-65')).value);
    expect((await resultOf(intersect, 'A-15')).value).toBe((await resultOf(defaultParams(), 'A-15')).value);
    expect((await resultOf(intersect, 'A-39')).value).toBe((await resultOf(defaultParams(), 'A-39')).value);
  });

  it('常住人口增加 10%：每个区县的人均值除以 1.1，覆盖率不变，总人口跟着变', async () => {
    const calculator = await calculatorOf();
    const more = withPatch({ popChange: 10 });
    const before = calculator.computeYear(conditions, defaultParams(), 2026);
    const after = calculator.computeYear(conditions, more, 2026);
    const rows = (result: typeof before) => indicatorResult(result.indicators, 'A-39').rows.map(row => row.value);

    rows(after).forEach((value, index) => expect(value).toBeCloseTo((rows(before)[index] ?? 0) / 1.1, 1));
    expect(indicatorResult(after.indicators, 'B-65').value).toBe(indicatorResult(before.indicators, 'B-65').value);
    expect(after.population).toBeCloseTo(before.population * 1.1, 6);
  });

  it('达标对照目标值，接近是差距在 5% 以内；最低城市', async () => {
    const result = await resultOf(defaultParams(), 'B-65');

    expect([result.passCount, result.total, result.target, result.value]).toEqual([5, 13, 70, 66.56]);
    expect(result.lowest.name).toBe('苏州市');
    for (const city of result.cities) {
      expect(city.pass).toBe(city.value >= 70);
      expect(city.near).toBe(city.value < 70 && city.value >= 66.5);
    }
  });

  it('覆盖率不超过 100，同样的条件和参数两次计算结果相同', async () => {
    const calculator = await calculatorOf();
    const params = withPatch({ rule: 'old', recognition: 'intersect', popChange: 20 });
    const first = calculator.compute(conditions, params);

    expect(Object.keys(first)).toEqual(['2025', '2026']);
    expect(first[2026]?.indicators['B-65']?.rows.every(row => row.value <= 100)).toBe(true);
    expect(createCalculator(calculator.atlas).compute(conditions, params)).toEqual(first);
  });
});
