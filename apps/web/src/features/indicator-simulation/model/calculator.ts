import { requireIndicator } from '@/shared/city-indicators/catalog';
import { mockIndicatorValue } from '@/shared/city-indicators/mock-value';
import { stableRandom } from '@/shared/city-indicators/stable-random';
import { findRegion } from '@/shared/map/region/region-catalog';
import { cached } from './cache';
import type { District, DistrictAtlas } from './districts';
import { simulationIndicator } from './indicators';
import { type FacilityScope, inScenario, type PopulationCaliber, type SimulationConditions, type SimulationParams } from './params';

/** 一个区县的计算结果；weight 是汇总时的人口（万人），剔除的区县不参与汇总 */
export interface DistrictResult {
  readonly code: string;
  readonly name: string;
  readonly cityCode: string;
  readonly value: number;
  readonly weight: number;
  readonly excluded: boolean;
  readonly missing: boolean;
  readonly pass: boolean;
}

export interface CityResult {
  readonly code: string;
  readonly name: string;
  readonly value: number;
  readonly pass: boolean;
  /** 没有达标，但差距在目标值的 5% 以内 */
  readonly near: boolean;
}

/** 一项指标在一个年度的结果：区县、市（人口加权）、全省（全部区县人口加权） */
export interface IndicatorResult {
  readonly rows: readonly DistrictResult[];
  readonly cities: readonly CityResult[];
  readonly value: number;
  readonly passCount: number;
  readonly total: number;
  readonly lowest: CityResult;
  readonly target: number;
}

export interface YearResult {
  readonly year: number;
  readonly indicators: Readonly<Record<string, IndicatorResult>>;
  /** 所选口径下监测范围的总人口（万人） */
  readonly population: number;
}

export interface Calculator {
  readonly atlas: DistrictAtlas;
  /** 区县人口（万人） */
  districtPopulation(district: District, year: number, caliber: PopulationCaliber): number;
  /** 区县基准值：默认参数下的值，人口加权均值等于该市的模拟值 */
  baseValue(year: number, indicatorId: string, district: District): number;
  /** 最新年度人口缺失的区县 */
  missingDistricts(year: number, cityCodes: readonly string[]): readonly District[];
  /** 按上年人口 × 近三年平均增长率插补的人口（万人，一位小数） */
  imputedPopulation(district: District, year: number, caliber: PopulationCaliber): number;
  computeYear(conditions: SimulationConditions, params: SimulationParams, year: number): YearResult;
  /** 全部年度 */
  compute(conditions: SimulationConditions, params: SimulationParams): Readonly<Record<number, YearResult>>;
}

// 常住人口（万人）与户籍/常住之比：演示用的量级，不作为统计数据引用
const CITY_POPULATION: Readonly<Record<string, readonly [resident: number, registeredRatio: number]>> = {
  320100: [954.7, 0.74],
  320200: [749.5, 0.68],
  320300: [902.9, 1.15],
  320400: [537.6, 0.75],
  320500: [1295.8, 0.58],
  320600: [773.3, 1.0],
  320700: [459.4, 1.15],
  320800: [455.3, 1.18],
  320900: [668.0, 1.18],
  321000: [458.0, 0.98],
  321100: [322.0, 0.87],
  321200: [450.6, 1.1],
  321300: [499.9, 1.2]
};

// 设施纳入口径：覆盖率按服务圈强度、人均值按面积打折扣
const SCOPE_COVERAGE: Readonly<Record<FacilityScope, number>> = { all: 1.18, standard: 1, large: 0.72 };
const SCOPE_AREA: Readonly<Record<FacilityScope, number>> = { all: 1.07, standard: 1, large: 0.86 };

const round = (value: number, digits: number) => Number(value.toFixed(digits));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const logit = (p: number) => Math.log(p / (1 - p));
// 达标判断用的"接近"：差距在目标值的 5% 以内
const NEAR = 0.95;

// 市的人口按年份小幅变化（2023 为锚点），户籍口径乘以户籍/常住之比
function cityPopulation(cityCode: string, year: number, caliber: PopulationCaliber): number {
  const entry = CITY_POPULATION[cityCode];
  if (!entry) {
    throw new Error(`没有 ${cityCode} 的演示人口`);
  }
  const [resident, ratio] = entry;
  const growth = (stableRandom(`${cityCode}:growth`) - 0.4) * 0.012;
  const value = resident * (1 + growth) ** (year - 2023);
  return caliber === 'registered' ? value * ratio : value;
}

export function createCalculator(atlas: DistrictAtlas): Calculator {
  // 区县份额：面积的 0.35 次方 × 市辖区 2.2 倍 × 散列扰动；户籍人口在城区略少、郊县略多
  const districtShares = cached(
    (cityCode: string, caliber: PopulationCaliber) => {
      const list = atlas.inCities([cityCode]);
      const weights = list.map(district => {
        const weight = district.area ** 0.35 * (district.urban ? 2.2 : 1) * (0.7 + 0.6 * stableRandom(`${district.code}:pop`));
        return caliber === 'registered' ? weight * (district.urban ? 0.92 : 1.08) : weight;
      });
      const total = weights.reduce((sum, weight) => sum + weight, 0);
      return new Map(list.map((district, index) => [district.code, (weights[index] ?? 0) / total]));
    },
    (cityCode, caliber) => `${cityCode}:${caliber}`
  );

  const districtPopulation = (district: District, year: number, caliber: PopulationCaliber) =>
    cityPopulation(district.cityCode, year, caliber) * (districtShares(district.cityCode, caliber).get(district.code) ?? 0);

  // 一个市的区县基准值：覆盖率在 logit 空间加区县差异再整体平移，人均值按比例加差异再缩放；两者的人口加权均值都等于市的模拟值
  const cityBaseValues = cached(
    (year: number, indicatorId: string, cityCode: string) => {
      const indicator = simulationIndicator(indicatorId);
      const target = mockIndicatorValue(cityCode, requireIndicator(indicatorId), year);
      const list = atlas.inCities([cityCode]);
      const weights = list.map(district => districtPopulation(district, year, 'resident'));
      const total = weights.reduce((sum, weight) => sum + weight, 0);
      const weightAt = (index: number) => weights[index] ?? 0;
      const spread = (district: District) => stableRandom(`${district.code}:${indicatorId}:level`) - 0.5;
      if (indicator.model === 'coverage') {
        const goal = Math.min(0.995, Math.max(0.005, target / 100));
        const offsets = list.map(district => logit(goal) + spread(district) * 1.6 + (district.urban ? 0.3 : -0.3));
        // 牛顿法解平移量，8 次足够收敛到 1e-9 以内
        let shift = 0;
        for (let step = 0; step < 8; step++) {
          const values = offsets.map(offset => sigmoid(offset + shift));
          const mean = values.reduce((sum, value, index) => sum + value * weightAt(index), 0) / total;
          const slope = values.reduce((sum, value, index) => sum + value * (1 - value) * weightAt(index), 0) / total;
          shift -= (mean - goal) / slope;
        }
        return new Map(list.map((district, index) => [district.code, sigmoid((offsets[index] ?? 0) + shift) * 100]));
      }
      const raw = list.map(district => Math.exp(spread(district) * 0.7 + (district.urban ? -0.12 : 0.1)));
      const mean = raw.reduce((sum, value, index) => sum + value * weightAt(index), 0) / total;
      return new Map(list.map((district, index) => [district.code, ((raw[index] ?? 0) / mean) * target]));
    },
    (year, indicatorId, cityCode) => `${year}:${indicatorId}:${cityCode}`
  );

  const baseValue = (year: number, indicatorId: string, district: District) =>
    cityBaseValues(year, indicatorId, district.cityCode).get(district.code) ?? 0;

  // 最多 2 个，优先来自不同的市；按年份和范围固定
  const missingDistricts = cached(
    (year: number, cityCodes: readonly string[]) => {
      const ranked = atlas
        .inCities(cityCodes)
        .toSorted((a, b) => stableRandom(`${year}:${a.code}:missing`) - stableRandom(`${year}:${b.code}:missing`));
      const picked: District[] = [];
      for (const district of ranked) {
        if (picked.length < 2 && !picked.some(item => item.cityCode === district.cityCode)) {
          picked.push(district);
        }
      }
      for (const district of ranked) {
        if (picked.length < 2 && !picked.includes(district)) {
          picked.push(district);
        }
      }
      return picked;
    },
    (year, cityCodes) => `${year}:${cityCodes.join(',')}`
  );

  const imputedPopulation = (district: District, year: number, caliber: PopulationCaliber) =>
    round(districtPopulation(district, year, caliber) * 1.008, 1);

  // 缺失的区县按处理方式给出汇总用的人口；剔除时为 null
  const weightOf = (district: District, year: number, params: SimulationParams, missing: boolean): number | null => {
    if (!missing) {
      return districtPopulation(district, year, params.popCaliber);
    }
    switch (params.missing.kind) {
      case 'exclude':
        return null;
      case 'manual':
        return params.missing.values[district.code] ?? imputedPopulation(district, year, params.popCaliber);
      case 'impute':
        break;
    }
    return imputedPopulation(district, year, params.popCaliber);
  };

  const computeYear = (conditions: SimulationConditions, params: SimulationParams, year: number): YearResult => {
    const { cityCodes, indicatorIds } = conditions;
    const latest = Math.max(...conditions.years);
    const missing = new Set(year === latest ? missingDistricts(year, cityCodes).map(district => district.code) : []);
    const list = atlas.inCities(cityCodes);
    const indicators: Record<string, IndicatorResult> = {};
    for (const id of indicatorIds) {
      const indicator = simulationIndicator(id);
      const target = params.targets[id] ?? 0;
      const add = inScenario(params, id) ? params.newFacilities / 100 : 0;
      const rows = list.map((district): DistrictResult => {
        const isMissing = missing.has(district.code);
        const weight = weightOf(district, year, params, isMissing);
        const base = baseValue(year, id, district);
        let value: number;
        if (indicator.model === 'coverage') {
          // 覆盖率 = 1 − (1 − 基准)^((v ÷ 60)² × 口径系数 × (1 + 新增))；固定距离类不随步行速度变化
          const reach = indicator.reach.kind === 'walk' ? (params.walkSpeed / 60) ** 2 : 1;
          value = 100 * (1 - (1 - base / 100) ** (reach * SCOPE_COVERAGE[params.facilityScope] * (1 + add)));
        } else {
          // 人均 = 基准 × 面积口径系数 × (1 + 新增) × 常住人口 ÷ 所选口径（或缺失处理给出）的人口
          const resident = districtPopulation(district, year, 'resident');
          value = base * SCOPE_AREA[params.facilityScope] * (1 + add) * (resident / (weight ?? resident));
        }
        value = round(value, indicator.precision);
        return {
          code: district.code,
          name: district.name,
          cityCode: district.cityCode,
          value,
          weight: weight ?? 0,
          excluded: weight === null,
          missing: isMissing,
          pass: value >= target
        };
      });
      const aggregate = (items: readonly DistrictResult[]) => {
        const included = items.filter(row => !row.excluded);
        const total = included.reduce((sum, row) => sum + row.weight, 0);
        return round(included.reduce((sum, row) => sum + row.value * row.weight, 0) / total, indicator.precision);
      };
      const cities = cityCodes.map((code): CityResult => {
        const value = aggregate(rows.filter(row => row.cityCode === code));
        return { code, name: findRegion(code)?.name ?? code, value, pass: value >= target, near: value < target && value >= target * NEAR };
      });
      const [first] = cities;
      if (!first) {
        throw new Error('推演条件里没有城市');
      }
      indicators[id] = {
        rows,
        cities,
        value: aggregate(rows),
        passCount: cities.filter(city => city.pass).length,
        total: cities.length,
        lowest: cities.reduce((low, city) => (city.value < low.value ? city : low), first),
        target
      };
    }
    return { year, indicators, population: list.reduce((sum, district) => sum + districtPopulation(district, year, params.popCaliber), 0) };
  };

  return {
    atlas,
    districtPopulation,
    baseValue,
    missingDistricts,
    imputedPopulation,
    computeYear,
    compute: (conditions, params) => Object.fromEntries(conditions.years.map(year => [year, computeYear(conditions, params, year)]))
  };
}
