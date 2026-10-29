import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';
import type { LngLat } from '@yzt/map-core';
import { stableRandom } from '@/shared/city-indicators/stable-random';
import { cached } from './cache';
import type { Calculator } from './calculator';
import type { District } from './districts';
import { reachMeters, SIMULATION_INDICATORS, simulationIndicator } from './indicators';
import { defaultParams, type FacilityScope, inScenario, type SimulationConditions, type SimulationParams } from './params';

/** 地图上的一个设施点；rank 决定纳入口径（越大越"大"），planned 是规划新增的 */
export interface FacilityPoint {
  readonly id: string;
  readonly coordinates: LngLat;
  readonly rank: number;
  readonly districtCode: string;
  readonly planned: boolean;
}

export interface FacilityLayout {
  /** 某项指标的现状设施数量（不撒点，供叙述用） */
  total(conditions: SimulationConditions, indicatorId: string, params: SimulationParams, year: number): number;
  /** 某项指标在当前参数下的设施点：按纳入口径筛选，规划新增的另外标出 */
  points(conditions: SimulationConditions, indicatorId: string, params: SimulationParams, year: number): FacilityPoint[];
}

// 纳入口径：规模以上去掉最小的 15%，仅中大型去掉 45%
const SCOPE_CUT: Readonly<Record<FacilityScope, number>> = { all: 0, standard: 0.15, large: 0.45 };
// 每个区县最多的点数：现状 150、规划新增 80，地图上看得清也不卡
const MAX_POINTS = { base: 150, planned: 80 } as const;
// 经纬度与千米的换算按江苏中部的纬度
const KM_PER_LNG = 111.32 * Math.cos((32.5 * Math.PI) / 180);
const KM_PER_LAT = 110.57;

type Salt = keyof typeof MAX_POINTS;

/**
 * 设施点只用于地图示意：按区县固定撒点，偏向区县中心（城区更集中）。
 * 数量按覆盖率反推：覆盖率 = 1 − e^(−密度 × π r²)，没有覆盖率指标的设施按人口估算。点不避开水体
 */
export function createFacilityLayout(calculator: Calculator): FacilityLayout {
  // 同一种设施按它的覆盖率指标估算数量（公园绿地按 B-65），默认参数、现状
  const coverageOf = new Map(
    SIMULATION_INDICATORS.flatMap(indicator => (indicator.model === 'coverage' ? [[indicator.facility, indicator.id] as const] : []))
  );
  const effectiveArea = (district: District, year: number) =>
    Math.min(district.area * (district.urban ? 0.6 : 0.12), calculator.districtPopulation(district, year, 'resident') * 0.9);

  const count = cached(
    (facility: string, year: number, district: District, salt: Salt) => {
      const coverageId = coverageOf.get(facility);
      let value: number;
      if (coverageId) {
        const radius = (reachMeters(simulationIndicator(coverageId), defaultParams().walkSpeed) ?? 0) / 1000;
        const coverage = calculator.baseValue(year, coverageId, district) / 100;
        value = (-Math.log(1 - coverage) * effectiveArea(district, year)) / (Math.PI * radius * radius);
      } else {
        value = calculator.districtPopulation(district, year, 'resident') * 0.3;
      }
      return Math.max(2, Math.min(MAX_POINTS[salt], Math.round(value)));
    },
    (facility, year, district, salt) => `${facility}:${year}:${district.code}:${salt}`
  );

  // 先在中心附近按正态分布取点（Box-Muller），25 次都落在区县外时改在外包范围里均匀取，最多 40 次
  const place = cached(
    (facility: string, year: number, district: District, salt: Salt): FacilityPoint[] => {
      const sigma = Math.sqrt(effectiveArea(district, year)) / 2.2;
      const [west, south, east, north] = district.bounds;
      const feature = { type: 'Feature' as const, properties: {}, geometry: district.geometry };
      const points: FacilityPoint[] = [];
      const total = count(facility, year, district, salt);
      for (let index = 0; index < total; index++) {
        const key = `${facility}:${district.code}:${salt}:${index}`;
        for (let attempt = 0; attempt < 40; attempt++) {
          let point: LngLat;
          if (attempt < 25) {
            const u = Math.max(1e-6, stableRandom(`${key}:${attempt}:u`));
            const v = stableRandom(`${key}:${attempt}:v`);
            const r = Math.sqrt(-2 * Math.log(u)) * sigma;
            point = [district.center[0] + (r * Math.cos(2 * Math.PI * v)) / KM_PER_LNG, district.center[1] + (r * Math.sin(2 * Math.PI * v)) / KM_PER_LAT];
          } else {
            point = [west + stableRandom(`${key}:${attempt}:x`) * (east - west), south + stableRandom(`${key}:${attempt}:y`) * (north - south)];
          }
          if (booleanPointInPolygon([...point], feature)) {
            points.push({ id: key, coordinates: point, rank: stableRandom(`${key}:rank`), districtCode: district.code, planned: salt === 'planned' });
            break;
          }
        }
      }
      return points;
    },
    (facility, year, district, salt) => `${facility}:${year}:${district.code}:${salt}`
  );

  return {
    total(conditions, indicatorId, params, year) {
      const { facility } = simulationIndicator(indicatorId);
      const kept = 1 - SCOPE_CUT[params.facilityScope];
      const sum = calculator.atlas.inCities(conditions.cityCodes).reduce((total, district) => total + count(facility, year, district, 'base'), 0);
      return Math.round(sum * kept);
    },
    points(conditions, indicatorId, params, year) {
      const { facility } = simulationIndicator(indicatorId);
      const cut = SCOPE_CUT[params.facilityScope];
      const add = inScenario(params, indicatorId) ? params.newFacilities / 100 : 0;
      return calculator.atlas.inCities(conditions.cityCodes).flatMap(district => {
        const base = place(facility, year, district, 'base');
        const planned = add > 0 ? place(facility, year, district, 'planned').slice(0, Math.round(base.length * add)) : [];
        return base.filter(point => point.rank >= cut).concat(planned);
      });
    }
  };
}
