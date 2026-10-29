import { JIANGSU_CITIES } from '@/shared/map/region/region-catalog';
import { isWalkCoverage, SIMULATION_INDICATORS, simulationIndicator } from '../model/indicators';
import {
  defaultParams,
  describeParam,
  inScenario,
  type ParamKey,
  type SimulationConditions,
  type SimulationParams
} from '../model/params';

/** 可选的年度，新的在前；与驾驶舱的开放年份一致 */
export const SIMULATION_YEARS: readonly number[] = [2026, 2025, 2024, 2023, 2022, 2021];

/** 编排阶段可设的参数项；缺失数据的处理要等数据核查发现缺失后才出现 */
export const COMPOSE_PARAM_KEYS: readonly ParamKey[] = [
  'popCaliber',
  'walkSpeed',
  'facilityScope',
  'newFacilities',
  'targets'
];

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

/** 打开页面时的编排：最新年度、全省、公园绿地覆盖率、社区卫生覆盖率、人均公园绿地 */
export function defaultComposition(): Composition {
  return {
    conditions: { years: [2026], cityCodes: CITY_CODES, indicatorIds: ['B-65', 'A-31', 'A-39'] },
    params: defaultParams()
  };
}

/** 清空后的编排：没有条件，参数回到默认 */
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

/** 规划新增的作用范围只留已选的指标；覆盖了全部已选指标时记为全部（null） */
export function normalizedParams(params: SimulationParams, indicatorIds: readonly string[]): SimulationParams {
  if (params.scenarioIds === null) {
    return params;
  }
  const scope = params.scenarioIds;
  const scenarioIds = indicatorIds.filter(id => scope.includes(id));
  if (scenarioIds.length === indicatorIds.length && indicatorIds.length > 0) {
    return { ...params, scenarioIds: null };
  }
  const same = scenarioIds.length === scope.length && scenarioIds.every((id, index) => scope[index] === id);
  return same ? params : { ...params, scenarioIds };
}

/** 加上（排在最后）或去掉一项指标；去掉时作用范围里也去掉 */
export function withIndicator(composition: Composition, id: string, on: boolean): Composition {
  simulationIndicator(id);
  const { conditions, params } = composition;
  const has = conditions.indicatorIds.includes(id);
  if (has === on) {
    return composition;
  }
  const indicatorIds = on ? [...conditions.indicatorIds, id] : conditions.indicatorIds.filter(item => item !== id);
  // 加上的指标不进已经限定的作用范围
  return { conditions: { ...conditions, indicatorIds }, params: on ? params : normalizedParams(params, indicatorIds) };
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

/** 换参数：作用范围按已选指标整理 */
export function withParams(composition: Composition, params: SimulationParams): Composition {
  return { ...composition, params: normalizedParams(params, composition.conditions.indicatorIds) };
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

/** 参数项影响哪些已选指标：编排图的悬停高亮和情景连线用 */
export function affectedIndicators(
  key: ParamKey,
  conditions: SimulationConditions,
  params: SimulationParams
): string[] {
  const { indicatorIds } = conditions;
  switch (key) {
    case 'walkSpeed':
      return indicatorIds.filter(id => isWalkCoverage(simulationIndicator(id)));
    case 'newFacilities':
      return indicatorIds.filter(id => inScenario(params, id));
    case 'popCaliber':
    case 'missing':
    case 'facilityScope':
    case 'targets':
      break;
  }
  return [...indicatorIds];
}

/** 参数节点上的取值；所选指标用不到步行速度时注明 */
export function paramValueText(key: ParamKey, conditions: SimulationConditions, params: SimulationParams): string {
  const text = describeParam(key, params, conditions);
  return key === 'walkSpeed' && affectedIndicators(key, conditions, params).length === 0 ? `${text}（未用到）` : text;
}

/** 名称或简称含有关键字的指标；没有关键字时是全部 */
export function searchIndicators(keyword: string): typeof SIMULATION_INDICATORS {
  const text = keyword.trim();
  if (text === '') {
    return SIMULATION_INDICATORS;
  }
  return SIMULATION_INDICATORS.filter(item => item.name.includes(text) || item.short.includes(text));
}
