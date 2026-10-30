import { JIANGSU_CITIES } from '@/shared/map/region/region-catalog';
import { SIMULATION_INDICATORS, simulationIndicator } from '../model/indicators';
import { defaultParams, paramApplies, type ParamKey, type SimulationConditions, type SimulationParams } from '../model/params';

/** 可选的年度，新的在前；与驾驶舱的开放年份一致 */
export const SIMULATION_YEARS: readonly number[] = [2026, 2025, 2024, 2023, 2022, 2021];

/** 编排的条件和参数 */
export interface Composition {
  readonly conditions: SimulationConditions;
  readonly params: SimulationParams;
}

/** 编排图的三列条件 */
export type ConditionKind = 'years' | 'region' | 'indicators';

export const CONDITION_LABELS: Readonly<Record<ConditionKind, string>> = {
  years: '年份',
  region: '监测范围',
  indicators: '监测指标'
};

const CITY_CODES = JIANGSU_CITIES.map(city => city.code);

/** 演示用的完整编排：最新年度、全省、公园绿地覆盖率、社区卫生覆盖率、人均公园绿地，标准口径 */
export function sampleComposition(): Composition {
  return {
    conditions: { years: [2026], cityCodes: CITY_CODES, indicatorIds: ['B-65', 'A-31', 'A-39'] },
    params: defaultParams()
  };
}

/** 空的编排：打开页面和重置条件后，没有条件，参数是标准口径 */
export function emptyComposition(): Composition {
  return { conditions: { years: [], cityCodes: [], indicatorIds: [] }, params: defaultParams() };
}

function assertYear(year: number): void {
  if (!SIMULATION_YEARS.includes(year)) {
    throw new Error(`没有可选的年度 ${year}`);
  }
}

function assertCity(code: string): void {
  if (!CITY_CODES.includes(code)) {
    throw new Error(`没有城市 ${code}`);
  }
}

/** 加上或去掉一个年度；年度按新的在前排列 */
export function withYear(composition: Composition, year: number, on: boolean): Composition {
  assertYear(year);
  const { conditions } = composition;
  const years = on ? [...new Set([...conditions.years, year])] : conditions.years.filter(item => item !== year);
  return { ...composition, conditions: { ...conditions, years: years.toSorted((a, b) => b - a) } };
}

/** 加上或去掉一个市；市按区划目录的顺序排列 */
export function withCity(composition: Composition, code: string, on: boolean): Composition {
  assertCity(code);
  const { conditions } = composition;
  const cityCodes = CITY_CODES.filter(item => (item === code ? on : conditions.cityCodes.includes(item)));
  return { ...composition, conditions: { ...conditions, cityCodes } };
}

/** 全选或清空监测范围 */
export function withAllCities(composition: Composition, on: boolean): Composition {
  return { ...composition, conditions: { ...composition.conditions, cityCodes: on ? CITY_CODES : [] } };
}

/** 加上（排在最后）或去掉一项指标 */
export function withIndicator(composition: Composition, id: string, on: boolean): Composition {
  simulationIndicator(id);
  const { conditions } = composition;
  if (conditions.indicatorIds.includes(id) === on) {
    return composition;
  }
  const indicatorIds = on ? [...conditions.indicatorIds, id] : conditions.indicatorIds.filter(item => item !== id);
  return { ...composition, conditions: { ...conditions, indicatorIds } };
}

/** 把第 from 项指标移到第 to 项 */
export function withIndicatorMoved(composition: Composition, from: number, to: number): Composition {
  const ids = [...composition.conditions.indicatorIds];
  if (from < 0 || from >= ids.length || to < 0 || to >= ids.length) {
    throw new Error(`指标位置超出范围：${from} → ${to}`);
  }
  const [id] = ids.splice(from, 1);
  if (id === undefined) {
    return composition;
  }
  ids.splice(to, 0, id);
  return { ...composition, conditions: { ...composition.conditions, indicatorIds: ids } };
}

/** 还缺哪几列条件，按编排图的顺序 */
export function missingConditions({ years, cityCodes, indicatorIds }: SimulationConditions): ConditionKind[] {
  const counts: Readonly<Record<ConditionKind, number>> = {
    years: years.length,
    region: cityCodes.length,
    indicators: indicatorIds.length
  };
  return (['years', 'region', 'indicators'] as const).filter(kind => counts[kind] === 0);
}

/** 参数项作用于哪些已选指标：编排图的悬停高亮和连线用 */
export function affectedIndicators(key: ParamKey, conditions: SimulationConditions): string[] {
  return conditions.indicatorIds.filter(id => paramApplies(key, id));
}

/** 名称、简称或编码含有关键字的指标；没有关键字时是全部 */
export function searchIndicators(keyword: string): typeof SIMULATION_INDICATORS {
  const text = keyword.trim();
  if (text === '') {
    return SIMULATION_INDICATORS;
  }
  const upper = text.toUpperCase();
  return SIMULATION_INDICATORS.filter(item => item.name.includes(text) || item.short.includes(text) || item.id.includes(upper));
}
