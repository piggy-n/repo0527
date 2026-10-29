import type { Calculator, IndicatorResult } from './calculator';
import { isWalkCoverage, simulationIndicator } from './indicators';
import {
  changedParams,
  defaultParams,
  describeParam,
  inScenario,
  NEW_FACILITIES_RANGE,
  type ParamKey,
  type SimulationConditions,
  type SimulationParams,
  WALK_SPEED_RANGE
} from './params';

/** 达标、接近（差距在目标值的 5% 以内）、未达标 */
export type PassState = 'pass' | 'near' | 'fail';

export function passState(value: number, target: number): PassState {
  if (value >= target) {
    return 'pass';
  }
  return value >= target * 0.95 ? 'near' : 'fail';
}

/** 一项参数改动对某个指标的贡献 */
export interface Contribution {
  readonly key: ParamKey;
  readonly from: string;
  readonly to: string;
  /** 全省值的变化；目标值只影响达标判断，变化是 0 */
  readonly delta: number;
  readonly passDelta: number;
}

/**
 * 变化归因：按推演中的先后，把参数项一项一项从 from 换成 to，每一步全省值的变化就是这一项的贡献；
 * 各项贡献加起来等于总的变化。目标值最后换，只算达标城市的变化
 */
export function contributions(
  calculator: Calculator,
  conditions: SimulationConditions,
  from: SimulationParams,
  to: SimulationParams,
  indicatorId: string,
  year: number
): Contribution[] {
  const single = { ...conditions, indicatorIds: [indicatorId] };
  const resultOf = (params: SimulationParams) => indicatorResult(calculator.computeYear(single, params, year).indicators, indicatorId);
  let current = from;
  let before = resultOf(current);
  // 别的指标改了目标值，和这项指标无关
  const keys = changedParams(from, to).filter(key => key !== 'targets' || from.targets[indicatorId] !== to.targets[indicatorId]);
  return keys.map(key => {
    current = withParam(current, key, to);
    const after = resultOf(current);
    const step: Contribution = {
      key,
      from: key === 'targets' ? String(from.targets[indicatorId]) : describeParam(key, from, conditions),
      to: key === 'targets' ? String(to.targets[indicatorId]) : describeParam(key, to, conditions),
      delta: after.value - before.value,
      passDelta: after.passCount - before.passCount
    };
    before = after;
    return step;
  });
}

// 把一项参数换成 source 的取值；规划新增连同它的作用范围一起换
function withParam(params: SimulationParams, key: ParamKey, source: SimulationParams): SimulationParams {
  switch (key) {
    case 'popCaliber':
      return { ...params, popCaliber: source.popCaliber };
    case 'missing':
      return { ...params, missing: source.missing };
    case 'walkSpeed':
      return { ...params, walkSpeed: source.walkSpeed };
    case 'facilityScope':
      return { ...params, facilityScope: source.facilityScope };
    case 'newFacilities':
      return { ...params, newFacilities: source.newFacilities, scenarioIds: source.scenarioIds };
    case 'targets':
      break;
  }
  return { ...params, targets: source.targets };
}

/** 敏感性曲线：步行类覆盖率看步行速度，其余看规划新增（这项指标算进作用范围） */
export interface Sensitivity {
  readonly key: 'walkSpeed' | 'newFacilities';
  readonly points: readonly (readonly [x: number, value: number])[];
  readonly current: number;
}

export function sensitivity(
  calculator: Calculator,
  conditions: SimulationConditions,
  params: SimulationParams,
  indicatorId: string,
  year: number
): Sensitivity {
  const walk = isWalkCoverage(simulationIndicator(indicatorId));
  const range = walk ? WALK_SPEED_RANGE : NEW_FACILITIES_RANGE;
  const single = { ...conditions, indicatorIds: [indicatorId] };
  const withScenario = params.scenarioIds === null || inScenario(params, indicatorId) ? params.scenarioIds : [...params.scenarioIds, indicatorId];
  const points: (readonly [number, number])[] = [];
  for (let x = range.min; x <= range.max; x += range.step) {
    const next: SimulationParams = walk ? { ...params, walkSpeed: x } : { ...params, newFacilities: x, scenarioIds: withScenario };
    points.push([x, indicatorResult(calculator.computeYear(single, next, year).indicators, indicatorId).value]);
  }
  return {
    key: walk ? 'walkSpeed' : 'newFacilities',
    points,
    current: walk ? params.walkSpeed : inScenario(params, indicatorId) ? params.newFacilities : 0
  };
}

/** 同一种设施的已选指标：新增公园绿地同时影响覆盖率和人均值 */
export function sameFacility(conditions: SimulationConditions, indicatorId: string): string[] {
  const { facility } = simulationIndicator(indicatorId);
  return conditions.indicatorIds.filter(id => simulationIndicator(id).facility === facility);
}

/** 建议情景：规划新增多少这类设施；reached 为 false 时是新增到上限也达不到的"上限情景" */
export interface Suggestion {
  readonly add: number;
  readonly scenarioIds: readonly string[];
  readonly before: IndicatorResult;
  readonly after: IndicatorResult;
  readonly reached: boolean;
}

/**
 * 在 0～50% 的新增设施里，找最小的、能让全省达标或多约四分之一的市达标的比例；
 * 都做不到时给出新增 50% 的效果，没有提升时没有建议；全部达标时也没有建议
 */
export function suggestion(
  calculator: Calculator,
  conditions: SimulationConditions,
  params: SimulationParams,
  indicatorId: string,
  year: number
): Suggestion | null {
  const resultOf = (next: SimulationParams) => indicatorResult(calculator.computeYear(conditions, next, year).indicators, indicatorId);
  const before = resultOf(params);
  const start = inScenario(params, indicatorId) ? params.newFacilities : 0;
  if (before.passCount === before.total || start >= NEW_FACILITIES_RANGE.max) {
    return null;
  }
  const scenarioIds = sameFacility(conditions, indicatorId);
  const need = Math.max(1, Math.min(3, Math.ceil(before.total / 4)));
  let after = before;
  let add = start;
  while (add < NEW_FACILITIES_RANGE.max) {
    add = Math.min(NEW_FACILITIES_RANGE.max, add + NEW_FACILITIES_RANGE.step);
    after = resultOf({ ...params, newFacilities: add, scenarioIds });
    if (after.value >= after.target || after.passCount - before.passCount >= need) {
      return { add, scenarioIds, before, after, reached: true };
    }
  }
  return after.value > before.value ? { add, scenarioIds, before, after, reached: false } : null;
}

/** 地图分级的断点：所选年度在默认参数下的区县值取五档分位数，年度、版本之间的颜色可比 */
export function valueBreaks(calculator: Calculator, conditions: SimulationConditions, indicatorId: string): readonly number[] {
  const single = { ...conditions, indicatorIds: [indicatorId] };
  const values = conditions.years
    .flatMap(year => indicatorResult(calculator.computeYear(single, defaultParams(), year).indicators, indicatorId).rows.map(row => row.value))
    .toSorted((a, b) => a - b);
  const digits = simulationIndicator(indicatorId).unit === '%' ? 0 : 1;
  return [0.2, 0.4, 0.6, 0.8].map(q => Number((values[Math.floor(q * (values.length - 1))] ?? 0).toFixed(digits)));
}

/** 取一项指标的结果；条件里没有这项时抛错 */
export function indicatorResult(indicators: Readonly<Record<string, IndicatorResult>>, id: string): IndicatorResult {
  const result = indicators[id];
  if (!result) {
    throw new Error(`计算结果里没有指标 ${id}`);
  }
  return result;
}
