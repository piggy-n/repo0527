import { requireIndicator } from '@/shared/city-indicators/catalog';
import { mockIndicatorValue } from '@/shared/city-indicators/mock-value';
import { stableRandom } from '@/shared/city-indicators/stable-random';
import { findRegion } from '@/shared/map/region/region-catalog';
import { cached } from './cache';
import type { District, DistrictAtlas } from './districts';
import { type SimulationIndicator, simulationIndicator } from './indicators';
import type { SimulationConditions, SimulationParams } from './params';

/** 一个区县的计算结果；weight 是汇总时的权重：覆盖率是住宅用地或区县面积，人均值是人口 */
export interface DistrictResult {
  readonly code: string;
  readonly name: string;
  readonly cityCode: string;
  readonly value: number;
  readonly weight: number;
}

export interface CityResult {
  readonly code: string;
  readonly name: string;
  readonly value: number;
}

/** 一项指标在一个年度的结果：区县、市（加权）、全省（全部区县加权） */
export interface IndicatorResult {
  readonly rows: readonly DistrictResult[];
  readonly cities: readonly CityResult[];
  readonly value: number;
}

export interface YearResult {
  readonly year: number;
  readonly indicators: Readonly<Record<string, IndicatorResult>>;
  /** 监测范围按常住人口变化后的总人口（万人） */
  readonly population: number;
}

export interface Calculator {
  readonly atlas: DistrictAtlas;
  /** 区县的七普常住人口（万人），不随年份变化 */
  districtPopulation(district: District): number;
  /** 区县的住宅用地面积（平方千米，演示量级）：住宅用地覆盖率按它汇总 */
  residentialLand(district: District): number;
  /** 区县基准值：标准口径下的值，按汇总权重的均值等于该市的模拟值 */
  baseValue(year: number, indicatorId: string, district: District): number;
  computeYear(conditions: SimulationConditions, params: SimulationParams, year: number): YearResult;
  /** 全部年度 */
  compute(conditions: SimulationConditions, params: SimulationParams): Readonly<Record<number, YearResult>>;
}

// 七普常住人口（万人）：演示用的量级，不作为统计数据引用
const CITY_POPULATION: Readonly<Record<string, number>> = {
  320100: 931.5,
  320200: 746.2,
  320300: 908.4,
  320400: 527.8,
  320500: 1274.8,
  320600: 772.7,
  320700: 459.9,
  320800: 455.6,
  320900: 670.9,
  321000: 456.0,
  321100: 321.0,
  321200: 451.3,
  321300: 498.6
};

/** 旧规程：站点按步行 5 分钟，覆盖强度打的折扣 */
export const RULE_FACTOR = 0.6;
/** 相交即算：与服务范围相交的图斑都算覆盖，覆盖强度放大的倍数 */
export const INTERSECT_FACTOR = 1.25;

const round = (value: number, digits: number) => Number(value.toFixed(digits));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const logit = (p: number) => Math.log(p / (1 - p));

function cityPopulation(cityCode: string): number {
  const value = CITY_POPULATION[cityCode];
  if (value === undefined) {
    throw new Error(`没有 ${cityCode} 的演示人口`);
  }
  return value;
}

/** 覆盖强度：标准口径为 1，旧规程打折扣、相交即算放大；覆盖率 = 1 − (1 − 标准值)^强度 */
export function coverageStrength(indicator: SimulationIndicator, params: SimulationParams): number {
  if (indicator.model !== 'coverage') {
    return 1;
  }
  const rule = indicator.ruleChange && params.rule === 'old' ? RULE_FACTOR : 1;
  const recognition = indicator.base === 'residential' && params.recognition === 'intersect' ? INTERSECT_FACTOR : 1;
  return rule * recognition;
}

// 住宅用地：城镇住宅加农村宅基地，市辖区占的比例高
const residentialLand = (district: District): number =>
  district.area * (district.urban ? 0.16 : 0.05) * (0.8 + 0.4 * stableRandom(`${district.code}:land`));

export function createCalculator(atlas: DistrictAtlas): Calculator {
  // 区县份额：面积的 0.35 次方 × 市辖区 2.2 倍 × 散列扰动
  const districtShares = cached(
    (cityCode: string) => {
      const list = atlas.inCities([cityCode]);
      const weights = list.map(
        district =>
          district.area ** 0.35 * (district.urban ? 2.2 : 1) * (0.7 + 0.6 * stableRandom(`${district.code}:pop`))
      );
      const total = weights.reduce((sum, weight) => sum + weight, 0);
      return new Map(list.map((district, index) => [district.code, (weights[index] ?? 0) / total]));
    },
    cityCode => cityCode
  );

  const districtPopulation = (district: District) =>
    cityPopulation(district.cityCode) * (districtShares(district.cityCode).get(district.code) ?? 0);

  // 汇总权重：住宅用地覆盖率按住宅用地，城区面积覆盖率按区县面积，人均值按人口
  const weightOf = (indicator: SimulationIndicator, district: District): number => {
    if (indicator.model === 'perCapita') {
      return districtPopulation(district);
    }
    return indicator.base === 'residential' ? residentialLand(district) : district.area;
  };

  // 一个市的区县基准值：覆盖率在 logit 空间加区县差异再整体平移，人均值按比例加差异再缩放；两者的加权均值都等于市的模拟值
  const cityBaseValues = cached(
    (year: number, indicatorId: string, cityCode: string) => {
      const indicator = simulationIndicator(indicatorId);
      const target = mockIndicatorValue(cityCode, requireIndicator(indicatorId), year);
      const list = atlas.inCities([cityCode]);
      const weights = list.map(district => weightOf(indicator, district));
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

  const computeYear = (conditions: SimulationConditions, params: SimulationParams, year: number): YearResult => {
    const { cityCodes, indicatorIds } = conditions;
    const list = atlas.inCities(cityCodes);
    const people = 1 + params.popChange / 100;
    const indicators: Record<string, IndicatorResult> = {};
    for (const id of indicatorIds) {
      const indicator = simulationIndicator(id);
      const strength = coverageStrength(indicator, params);
      const rows = list.map((district): DistrictResult => {
        const base = baseValue(year, id, district);
        // 覆盖率按强度换算；人均值的分母是变化后的常住人口
        const raw = indicator.model === 'coverage' ? 100 * (1 - (1 - base / 100) ** strength) : base / people;
        const value = round(raw, indicator.precision);
        return {
          code: district.code,
          name: district.name,
          cityCode: district.cityCode,
          value,
          weight: weightOf(indicator, district)
        };
      });
      const aggregate = (items: readonly DistrictResult[]) => {
        const total = items.reduce((sum, row) => sum + row.weight, 0);
        return round(items.reduce((sum, row) => sum + row.value * row.weight, 0) / total, indicator.precision);
      };
      if (cityCodes.length === 0) {
        throw new Error('计算条件里没有城市');
      }
      const cities = cityCodes.map(
        (code): CityResult => ({
          code,
          name: findRegion(code)?.name ?? code,
          value: aggregate(rows.filter(row => row.cityCode === code))
        })
      );
      indicators[id] = { rows, cities, value: aggregate(rows) };
    }
    return {
      year,
      indicators,
      population: list.reduce((sum, district) => sum + districtPopulation(district), 0) * people
    };
  };

  return {
    atlas,
    districtPopulation,
    residentialLand,
    baseValue,
    computeYear,
    compute: (conditions, params) =>
      Object.fromEntries(conditions.years.map(year => [year, computeYear(conditions, params, year)]))
  };
}
