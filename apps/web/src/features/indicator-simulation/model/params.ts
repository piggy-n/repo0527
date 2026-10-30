import { reachMeters, simulationIndicator, walkMeters } from './indicators';

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
}

/** 常住人口变化的范围，界面的滑块按它设置 */
export const POP_CHANGE_RANGE = { min: -20, max: 20, step: 5 } as const;

const DEFAULTS: SimulationParams = Object.freeze({ rule: 'new', recognition: 'half', popChange: 0 });

/** 标准口径：新规程、覆盖面积 ≥ 50%、七普常住人口；一直是同一个对象 */
export function defaultParams(): SimulationParams {
  return DEFAULTS;
}

/** 用户能调整的参数项 */
export type ParamKey = 'rule' | 'recognition' | 'popChange';

/** 参数项在推演中的先后：归因按这个顺序逐项替换 */
export const PARAM_KEYS: readonly ParamKey[] = ['popChange', 'rule', 'recognition'];

export const PARAM_LABELS: Readonly<Record<ParamKey, string>> = {
  rule: '计算规程',
  recognition: '覆盖认定',
  popChange: '常住人口变化'
};

export const RULE_LABELS: Readonly<Record<Rule, string>> = { new: '新规程', old: '旧规程' };
export const RECOGNITION_LABELS: Readonly<Record<Recognition, string>> = { half: '覆盖 ≥ 50%', intersect: '相交即算' };

/** 参数项对这项指标起不起作用：规程只对 Excel 写了规程变化的两项，认定只对住宅用地覆盖率，人口只对人均类 */
export function paramApplies(key: ParamKey, indicatorId: string): boolean {
  const indicator = simulationIndicator(indicatorId);
  const applies: Readonly<Record<ParamKey, boolean>> = {
    rule: indicator.model === 'coverage' && indicator.ruleChange,
    recognition: indicator.model === 'coverage' && indicator.base === 'residential',
    popChange: indicator.model === 'perCapita'
  };
  return applies[key];
}

/** 这些指标用得上的参数项，按推演中的先后 */
export function paramsOf(indicatorIds: readonly string[]): ParamKey[] {
  return PARAM_KEYS.filter(key => indicatorIds.some(id => paramApplies(key, id)));
}

/** 参数项取的是不是标准值 */
export function isStandard(key: ParamKey, params: SimulationParams): boolean {
  return params[key] === defaultParams()[key];
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

/** 两组参数里不同的参数项，按 PARAM_KEYS 的顺序 */
export function changedParams(from: SimulationParams, to: SimulationParams): ParamKey[] {
  return PARAM_KEYS.filter(key => from[key] !== to[key]);
}

/** 带正负号的百分比，如"+10%""−5%""0%" */
export const signedPercent = (value: number): string => `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value)}%`;

/** 参数项的取值说明，如"旧规程""相交即算""+10%" */
export function describeParam(key: ParamKey, params: SimulationParams): string {
  const texts: Readonly<Record<ParamKey, string>> = {
    rule: RULE_LABELS[params.rule],
    recognition: RECOGNITION_LABELS[params.recognition],
    popChange: signedPercent(params.popChange)
  };
  return texts[key];
}
