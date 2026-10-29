// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { requireIndicator } from '@/shared/city-indicators/catalog';
import { mockIndicatorValue } from '@/shared/city-indicators/mock-value';
import { JIANGSU_CITIES } from '@/shared/map/region/region-catalog';
import { indicatorResult } from './analysis';
import { createCalculator } from './calculator';
import { defaultParams, type SimulationParams } from './params';
import { loadTestAtlas } from './test-atlas';

const ALL = JIANGSU_CITIES.map(city => city.code);
const conditions = { years: [2026, 2025], cityCodes: ALL, indicatorIds: ['B-65', 'A-31', 'A-39', 'A-15'] };
const withPatch = (patch: Partial<SimulationParams>): SimulationParams => ({ ...defaultParams(), ...patch });
const calculatorOf = async () => createCalculator(await loadTestAtlas());
const province = async (params: SimulationParams, id: string, year = 2026) =>
  indicatorResult((await calculatorOf()).computeYear(conditions, params, year).indicators, id).value;

describe('区县人口', () => {
  it('一个市各区县的份额加起来是 1；户籍与常住之比等于该市的比值', async () => {
    const calculator = await calculatorOf();
    const suzhou = calculator.atlas.inCities(['320500']);
    const sum = (caliber: 'resident' | 'registered') => suzhou.reduce((total, district) => total + calculator.districtPopulation(district, 2026, caliber), 0);

    expect(sum('registered') / sum('resident')).toBeCloseTo(0.58, 6);
    expect(sum('resident')).toBeGreaterThan(1250);
    expect(sum('resident')).toBeLessThan(1350);
  });
});

describe('computeYear', () => {
  it('默认参数下，没有缺失的年度里市值等于驾驶舱的模拟值（覆盖率和人均值都是）', async () => {
    const calculator = await calculatorOf();
    const result = calculator.computeYear(conditions, defaultParams(), 2025);
    for (const id of ['B-65', 'A-39']) {
      for (const city of indicatorResult(result.indicators, id).cities) {
        expect(city.value).toBeCloseTo(mockIndicatorValue(city.code, requireIndicator(id), 2025), 1);
      }
    }
  });

  it('缺失人口只出现在最新年度：2 个区县、来自不同的市', async () => {
    const calculator = await calculatorOf();
    const missing = calculator.missingDistricts(2026, ALL);
    const rows = (year: number) => indicatorResult(calculator.computeYear(conditions, defaultParams(), year).indicators, 'B-65').rows;

    expect(missing.map(district => district.name)).toEqual(['溧水区', '广陵区']);
    expect(new Set(missing.map(district => district.cityCode)).size).toBe(2);
    expect(rows(2026).filter(row => row.missing).map(row => row.name)).toEqual(['溧水区', '广陵区']);
    expect(rows(2025).some(row => row.missing)).toBe(false);
  });

  it('剔除缺失的区县：标为剔除、不参与汇总；手动填写的人口改变人均值', async () => {
    const calculator = await calculatorOf();
    const [lishui] = calculator.missingDistricts(2026, ALL);
    if (!lishui) {
      throw new Error('应有缺失的区县');
    }
    const rowOf = (params: SimulationParams) => {
      const row = indicatorResult(calculator.computeYear(conditions, params, 2026).indicators, 'A-39').rows.find(item => item.code === lishui.code);
      if (!row) {
        throw new Error('缺少溧水区的结果');
      }
      return row;
    };
    const excluded = rowOf(withPatch({ missing: { kind: 'exclude' } }));
    const imputed = rowOf(defaultParams());
    const manual = rowOf(withPatch({ missing: { kind: 'manual', values: { [lishui.code]: imputed.weight * 2 } } }));

    expect(excluded.excluded).toBe(true);
    expect(imputed.excluded).toBe(false);
    expect(imputed.weight).toBe(calculator.imputedPopulation(lishui, 2026, 'resident'));
    expect(manual.value).toBeCloseTo(imputed.value / 2, 1);
  });

  it('步行类覆盖率随步行速度上升，固定距离类不变；纳入口径越宽越高', async () => {
    const faster = withPatch({ walkSpeed: 80 });

    expect(await province(faster, 'B-65')).toBeGreaterThan(await province(defaultParams(), 'B-65'));
    expect(await province(faster, 'A-15')).toBe(await province(defaultParams(), 'A-15'));
    const byScope = await Promise.all((['all', 'standard', 'large'] as const).map(scope => province(withPatch({ facilityScope: scope }), 'B-65')));
    expect(byScope.toSorted((a, b) => b - a)).toEqual(byScope);
  });

  it('规划新增只作用于选中的指标', async () => {
    const scoped = withPatch({ newFacilities: 20, scenarioIds: ['B-65'] });

    expect(await province(scoped, 'B-65')).toBeGreaterThan(await province(defaultParams(), 'B-65'));
    expect(await province(scoped, 'A-31')).toBe(await province(defaultParams(), 'A-31'));
  });

  it('户籍口径让户籍人口少的苏州人均值变高', async () => {
    const calculator = await calculatorOf();
    const suzhou = (params: SimulationParams) =>
      indicatorResult(calculator.computeYear(conditions, params, 2025).indicators, 'A-39').cities.find(city => city.code === '320500')?.value ?? 0;

    expect(suzhou(withPatch({ popCaliber: 'registered' }))).toBeGreaterThan(suzhou(defaultParams()) * 1.5);
  });

  it('达标对照演示目标值，接近是差距在 5% 以内；最低城市', async () => {
    const calculator = await calculatorOf();
    const result = indicatorResult(calculator.computeYear(conditions, defaultParams(), 2026).indicators, 'B-65');

    expect([result.passCount, result.total, result.target, result.value]).toEqual([5, 13, 70, 64.62]);
    expect(result.lowest.name).toBe('苏州市');
    for (const city of result.cities) {
      expect(city.pass).toBe(city.value >= 70);
      expect(city.near).toBe(city.value < 70 && city.value >= 66.5);
    }
  });

  it('覆盖率不超过 100，同样的条件和参数两次计算结果相同', async () => {
    const calculator = await calculatorOf();
    const params = withPatch({ walkSpeed: 100, newFacilities: 50, facilityScope: 'all' });
    const first = calculator.compute(conditions, params);

    expect(Object.keys(first)).toEqual(['2025', '2026']);
    expect(first[2026]?.indicators['B-65']?.rows.every(row => row.value <= 100)).toBe(true);
    expect(createCalculator(calculator.atlas).compute(conditions, params)).toEqual(first);
  });
});
