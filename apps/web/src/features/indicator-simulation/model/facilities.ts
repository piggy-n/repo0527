import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';
import type { LngLat } from '@yzt/map-core';
import { stableRandom } from '@/shared/city-indicators/stable-random';
import { cached } from './cache';
import type { Calculator } from './calculator';
import type { District } from './districts';
import { reachMeters, SIMULATION_INDICATORS, simulationIndicator } from './indicators';
import type { SimulationConditions } from './params';

/** 地图上的一个设施点 */
export interface FacilityPoint {
  readonly id: string;
  readonly coordinates: LngLat;
  readonly districtCode: string;
}

export interface FacilityLayout {
  /** 某项指标的设施数量（不撒点，供叙述用） */
  total(conditions: SimulationConditions, indicatorId: string, year: number): number;
  /** 某项指标的设施点 */
  points(conditions: SimulationConditions, indicatorId: string, year: number): FacilityPoint[];
}

// 每个区县最多 150 个点，地图上看得清也不卡
const MAX_POINTS = 150;
// 经纬度与千米的换算按江苏中部的纬度
const KM_PER_LNG = 111.32 * Math.cos((32.5 * Math.PI) / 180);
const KM_PER_LAT = 110.57;

/**
 * 设施点只用于地图示意：按区县固定撒点，偏向区县中心（城区更集中）。
 * 数量按覆盖率反推：覆盖率 = 1 − e^(−密度 × π r²)，没有覆盖率指标的设施按人口估算。点不避开水体
 */
export function createFacilityLayout(calculator: Calculator): FacilityLayout {
  // 同一种设施按它的覆盖率指标估算数量（公园绿地按 B-65），标准口径
  const coverageOf = new Map(
    SIMULATION_INDICATORS.flatMap(indicator =>
      indicator.model === 'coverage' ? [[indicator.facility, indicator.id] as const] : []
    )
  );
  const effectiveArea = (district: District) =>
    Math.min(district.area * (district.urban ? 0.6 : 0.12), calculator.districtPopulation(district) * 0.9);

  const count = cached(
    (facility: string, year: number, district: District) => {
      const coverageId = coverageOf.get(facility);
      let value: number;
      if (coverageId) {
        const radius = (reachMeters(simulationIndicator(coverageId)) ?? 0) / 1000;
        const coverage = calculator.baseValue(year, coverageId, district) / 100;
        value = (-Math.log(1 - coverage) * effectiveArea(district)) / (Math.PI * radius * radius);
      } else {
        value = calculator.districtPopulation(district) * 0.3;
      }
      return Math.max(2, Math.min(MAX_POINTS, Math.round(value)));
    },
    (facility, year, district) => `${facility}:${year}:${district.code}`
  );

  // 先在中心附近按正态分布取点（Box-Muller），25 次都落在区县外时改在外包范围里均匀取，最多 40 次
  const place = cached(
    (facility: string, year: number, district: District): FacilityPoint[] => {
      const sigma = Math.sqrt(effectiveArea(district)) / 2.2;
      const [west, south, east, north] = district.bounds;
      const feature = { type: 'Feature' as const, properties: {}, geometry: district.geometry };
      const points: FacilityPoint[] = [];
      const total = count(facility, year, district);
      for (let index = 0; index < total; index++) {
        // 散列键沿用原来的写法，撒点位置不变
        const key = `${facility}:${district.code}:base:${index}`;
        for (let attempt = 0; attempt < 40; attempt++) {
          let point: LngLat;
          if (attempt < 25) {
            const u = Math.max(1e-6, stableRandom(`${key}:${attempt}:u`));
            const v = stableRandom(`${key}:${attempt}:v`);
            const r = Math.sqrt(-2 * Math.log(u)) * sigma;
            point = [
              district.center[0] + (r * Math.cos(2 * Math.PI * v)) / KM_PER_LNG,
              district.center[1] + (r * Math.sin(2 * Math.PI * v)) / KM_PER_LAT
            ];
          } else {
            point = [
              west + stableRandom(`${key}:${attempt}:x`) * (east - west),
              south + stableRandom(`${key}:${attempt}:y`) * (north - south)
            ];
          }
          if (booleanPointInPolygon([...point], feature)) {
            points.push({ id: key, coordinates: point, districtCode: district.code });
            break;
          }
        }
      }
      return points;
    },
    (facility, year, district) => `${facility}:${year}:${district.code}`
  );

  return {
    total(conditions, indicatorId, year) {
      const { facility } = simulationIndicator(indicatorId);
      return calculator.atlas
        .inCities(conditions.cityCodes)
        .reduce((total, district) => total + count(facility, year, district), 0);
    },
    points(conditions, indicatorId, year) {
      const { facility } = simulationIndicator(indicatorId);
      return calculator.atlas.inCities(conditions.cityCodes).flatMap(district => place(facility, year, district));
    }
  };
}

const layouts = new WeakMap<Calculator, FacilityLayout>();

/** 同一个计算器共用一份设施撒点：叙述、地图都从这里取，缓存不重复 */
export function facilityLayoutOf(calculator: Calculator): FacilityLayout {
  let layout = layouts.get(calculator);
  if (!layout) {
    layout = createFacilityLayout(calculator);
    layouts.set(calculator, layout);
  }
  return layout;
}
