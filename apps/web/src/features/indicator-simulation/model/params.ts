import { demoTarget, reachMeters, SIMULATION_INDICATORS, simulationIndicator, walkMeters } from './indicators';

/** 推演条件：年度、监测范围（市）、监测指标（编排图上的顺序） */
export interface SimulationConditions {
  readonly years: readonly number[];
  readonly cityCodes: readonly string[];
  readonly indicatorIds: readonly string[];
}

/** 计算规程：新规程站点步行 15 分钟，旧规程站点步行 5 分钟（服务中心都是 15 分钟） */
export type Rule = 'new' | 'old';
/** 覆盖认定：覆盖面积 ≥ 50% 的住宅图斑算覆盖，或者相交即算 */
export type Recognition = 'half' | 'intersect';

/** 可调整的参数：取值都来自 Excel 的计算方法，偏离标准值的是模拟情景（docs/modules/indicator-simulation.md） */
export interface SimulationParams {
  readonly rule: Rule;
  readonly recognition: Recognition;
  /** 常住人口相对七普的变化（%）：人均类的分母按它变化 */
  readonly popChange: number;
  /** 目标值，按指标编码；只影响达标判断 */
  readonly targets: Readonly<Record<string, number>>;
}

/** 常住人口变化的范围，界面的滑块按它设置 */
export const POP_CHANGE_RANGE = { min: -20, max: 20, step: 5 } as const;

let defaults: SimulationParams | undefined;

/** 标准口径：新规程、覆盖面积 ≥ 50%、七普常住人口；第一次用到时才算目标值，之后一直是同一个对象 */
export function defaultParams(): SimulationParams {
  defaults ??= {
    rule: 'new',
    recognition: 'half',
    popChange: 0,
    targets: Object.fromEntries(SIMULATION_INDICATORS.map(({ id }) => [id, demoTarget(id)]))
  };
  return defaults;
}

/** 用户能调整的参数项 */
export type ParamKey = 'rule' | 'recognition' | 'popChange' | 'targets';

/** 参数项在推演中的先后：归因按这个顺序逐项替换 */
export const PARAM_KEYS: readonly ParamKey[] = ['popChange', 'rule', 'recognition', 'targets'];

export const PARAM_LABELS: Readonly<Record<ParamKey, string>> = {
  rule: '计算规程',
  recognition: '覆盖认定',
  popChange: '常住人口变化',
  targets: '目标值'
};

export const RULE_LABELS: Readonly<Record<Rule, string>> = { new: '新规程', old: '旧规程' };
export const RECOGNITION_LABELS: Readonly<Record<Recognition, string>> = { half: '覆盖 ≥ 50%', intersect: '相交即算' };

/** 参数项对这项指标起不起作用：规程只对 Excel 写了规程变化的两项，认定只对住宅用地覆盖率，人口只对人均类 */
export function paramApplies(key: ParamKey, indicatorId: string): boolean {
  const indicator = simulationIndicator(indicatorId);
  switch (key) {
    case 'rule':
      return indicator.model === 'coverage' && indicator.ruleChange;
    case 'recognition':
      return indicator.model === 'coverage' && indicator.base === 'residential';
    case 'popChange':
      return indicator.model === 'perCapita';
    case 'targets':
      break;
  }
  return true;
}

/** 这些指标用得上的参数项，按推演中的先后 */
export function paramsOf(indicatorIds: readonly string[]): ParamKey[] {
  return PARAM_KEYS.filter(key => indicatorIds.some(id => paramApplies(key, id)));
}

/** 参数项取的是不是标准值；目标值不属于计算口径，总算标准 */
export function isStandard(key: ParamKey, params: SimulationParams): boolean {
  const standard = defaultParams();
  return key === 'targets' || params[key] === standard[key];
}

/** 这项指标在这组参数下偏离标准口径的参数项 */
export function scenarioKeys(params: SimulationParams, indicatorId: string): ParamKey[] {
  return PARAM_KEYS.filter(key => paramApplies(key, indicatorId) && !isStandard(key, params));
}

/** 这项指标是不是模拟情景：有起作用的参数不是标准值 */
export const isScenario = (params: SimulationParams, indicatorId: string): boolean =>
  scenarioKeys(params, indicatorId).length > 0;

/** 服务范围（米）：旧规程下站点按步行 5 分钟；人均类没有 */
export function serviceMeters(indicatorId: string, params: SimulationParams): number | null {
  const indicator = simulationIndicator(indicatorId);
  if (indicator.model === 'coverage' && indicator.ruleChange && params.rule === 'old') {
    return walkMeters(5);
  }
  return reachMeters(indicator);
}

// 按键比较目标值，键的先后不算
function sameNumbers(a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every(key => a[key] === b[key]);
}

/** 两组参数里不同的参数项，按 PARAM_KEYS 的顺序 */
export function changedParams(from: SimulationParams, to: SimulationParams): ParamKey[] {
  return PARAM_KEYS.filter(key => (key === 'targets' ? !sameNumbers(from.targets, to.targets) : from[key] !== to[key]));
}

/** 带正负号的百分比，如"+10%""−5%""0%" */
export const signedPercent = (value: number): string => `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value)}%`;

/** 参数项的取值说明，如"旧规程""相交即算""+10%"；目标值写成"n 项已调整" */
export function describeParam(key: ParamKey, params: SimulationParams, conditions: SimulationConditions): string {
  switch (key) {
    case 'rule':
      return RULE_LABELS[params.rule];
    case 'recognition':
      return RECOGNITION_LABELS[params.recognition];
    case 'popChange':
      return signedPercent(params.popChange);
    case 'targets':
      break;
  }
  const initial = defaultParams().targets;
  const changed = conditions.indicatorIds.filter(id => params.targets[id] !== initial[id]).length;
  return changed === 0 ? `${conditions.indicatorIds.length} 项默认` : `${changed} 项已调整`;
}
