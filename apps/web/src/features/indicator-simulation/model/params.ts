import { reachMeters, reachText, simulationIndicator, standardWalkMinutes, walkMeters, walkOptions } from './indicators';
import type { SimulationScope } from './scope';

/** 推演条件：年度、监测范围（所选的市或自定义范围，ADR 0121）、监测指标（编排图上的顺序） */
export interface SimulationConditions {
  readonly years: readonly number[];
  readonly scope: SimulationScope;
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
  /** 改过的步行时长（分钟），按指标编码；等于标准时长的不记，只通过 withWalkMinutes 修改（ADR 0125） */
  readonly walkMinutes: Readonly<Record<string, number>>;
}

/** 常住人口变化的范围，界面的滑块按它设置 */
export const POP_CHANGE_RANGE = { min: -20, max: 20, step: 5 } as const;

const NO_WALK_CHANGE: SimulationParams['walkMinutes'] = Object.freeze({});
const DEFAULTS: SimulationParams = Object.freeze({
  rule: 'new',
  recognition: 'half',
  popChange: 0,
  walkMinutes: NO_WALK_CHANGE
});

/** 标准口径：新规程、覆盖面积 ≥ 50%、七普常住人口；一直是同一个对象 */
export function defaultParams(): SimulationParams {
  return DEFAULTS;
}

/** 用户能调整的参数项 */
export type ParamKey = 'rule' | 'recognition' | 'popChange' | 'walk';

/** 参数项在推演中的先后：归因按这个顺序逐项替换 */
export const PARAM_KEYS: readonly ParamKey[] = ['popChange', 'walk', 'rule', 'recognition'];

export const PARAM_LABELS: Readonly<Record<ParamKey, string>> = {
  rule: '计算规程',
  recognition: '覆盖认定',
  popChange: '常住人口变化',
  walk: '步行时长'
};

export const RULE_LABELS: Readonly<Record<Rule, string>> = { new: '新规程', old: '旧规程' };
export const RECOGNITION_LABELS: Readonly<Record<Recognition, string>> = { half: '覆盖 ≥ 50%', intersect: '相交即算' };

/** 参数项对这项指标起不起作用：规程只对 Excel 写了规程变化的两项，认定只对住宅用地覆盖率，人口只对人均类，时长只对步行类 */
export function paramApplies(key: ParamKey, indicatorId: string): boolean {
  const indicator = simulationIndicator(indicatorId);
  const applies: Readonly<Record<ParamKey, boolean>> = {
    rule: indicator.model === 'coverage' && indicator.ruleChange,
    recognition: indicator.model === 'coverage' && indicator.base === 'residential',
    popChange: indicator.model === 'perCapita',
    walk: standardWalkMinutes(indicator) !== null
  };
  return applies[key];
}

/** 这些指标用得上的参数项，按推演中的先后 */
export function paramsOf(indicatorIds: readonly string[]): ParamKey[] {
  return PARAM_KEYS.filter(key => indicatorIds.some(id => paramApplies(key, id)));
}

/** 参数项取的是不是标准值；步行时长要所有指标都没改过 */
export function isStandard(key: ParamKey, params: SimulationParams): boolean {
  return key === 'walk' ? Object.keys(params.walkMinutes).length === 0 : params[key] === DEFAULTS[key];
}

/** 这项指标在这组参数下偏离标准口径的参数项 */
export function scenarioKeys(params: SimulationParams, indicatorId: string): ParamKey[] {
  return PARAM_KEYS.filter(
    key =>
      paramApplies(key, indicatorId) &&
      (key === 'walk' ? params.walkMinutes[indicatorId] !== undefined : !isStandard(key, params))
  );
}

/** 这项指标是不是模拟情景：有起作用的参数不是标准值 */
export const isScenario = (params: SimulationParams, indicatorId: string): boolean =>
  scenarioKeys(params, indicatorId).length > 0;

/** 这项指标的步行时长（分钟）：改过的取设定值，否则是标准时长；不是步行类的指标为 null */
export function walkMinutesOf(params: SimulationParams, indicatorId: string): number | null {
  return params.walkMinutes[indicatorId] ?? standardWalkMinutes(simulationIndicator(indicatorId));
}

/** 设定一项指标的步行时长，传 null 是恢复标准；值没变时返回原来的对象。不是可选的时长时抛错 */
export function withWalkMinutes(
  params: SimulationParams,
  indicatorId: string,
  minutes: number | null
): SimulationParams {
  const indicator = simulationIndicator(indicatorId);
  if (minutes !== null && !walkOptions(indicator).includes(minutes)) {
    throw new Error(`${indicator.short}没有步行 ${minutes} 分钟这一档`);
  }
  const custom = minutes === standardWalkMinutes(indicator) ? null : minutes;
  if ((params.walkMinutes[indicatorId] ?? null) === custom) {
    return params;
  }
  const others = Object.entries(params.walkMinutes).filter(([id]) => id !== indicatorId);
  const walkMinutes = Object.fromEntries(custom === null ? others : [...others, [indicatorId, custom]]);
  return { ...params, walkMinutes: Object.keys(walkMinutes).length === 0 ? NO_WALK_CHANGE : walkMinutes };
}

/** 只留下这些指标的步行时长：去掉指标后不留看不见的设定 */
export function keepWalkMinutes(params: SimulationParams, indicatorIds: readonly string[]): SimulationParams {
  return Object.keys(params.walkMinutes)
    .filter(id => !indicatorIds.includes(id))
    .reduce((next, id) => withWalkMinutes(next, id, null), params);
}

/** 说到的时长取最近的一档：一样近时取短的，超过上限时是上限。不是步行类的指标抛错 */
export function snapWalkMinutes(indicatorId: string, minutes: number): number {
  const options = walkOptions(simulationIndicator(indicatorId));
  const [first] = options;
  if (first === undefined) {
    throw new Error(`指标 ${indicatorId} 不是步行类`);
  }
  return options.reduce(
    (best, option) => (Math.abs(option - minutes) < Math.abs(best - minutes) ? option : best),
    first
  );
}

/** 按这组参数的指标全称，如"社区卫生服务设施步行10分钟覆盖率"；没改过时长时就是目录里的名称 */
export function indicatorName(indicatorId: string, params: SimulationParams): string {
  const indicator = simulationIndicator(indicatorId);
  const standard = standardWalkMinutes(indicator);
  const minutes = params.walkMinutes[indicatorId];
  return minutes === undefined ? indicator.name : indicator.name.replace(`步行${standard}分钟`, `步行${minutes}分钟`);
}

/** 按这组参数的简称，如"社区卫生10分钟覆盖率"；没改过时长时就是目录里的简称 */
export function indicatorShort(indicatorId: string, params: SimulationParams): string {
  const { short } = simulationIndicator(indicatorId);
  const minutes = params.walkMinutes[indicatorId];
  return minutes === undefined ? short : short.replace('覆盖率', `${minutes}分钟覆盖率`);
}

/** 按这组参数的服务范围说明，如"步行 10 分钟（500 米）" */
export const reachTextOf = (indicatorId: string, params: SimulationParams): string =>
  reachText(simulationIndicator(indicatorId), params.walkMinutes[indicatorId]);

/** 服务范围（米）：旧规程下站点按步行 5 分钟，否则按设定的步行时长；人均类没有 */
export function serviceMeters(indicatorId: string, params: SimulationParams): number | null {
  const indicator = simulationIndicator(indicatorId);
  if (indicator.model === 'coverage' && indicator.ruleChange && params.rule === 'old') {
    return walkMeters(5);
  }
  const minutes = params.walkMinutes[indicatorId];
  return minutes === undefined ? reachMeters(indicator) : walkMeters(minutes);
}

const sameWalkMinutes = (a: SimulationParams['walkMinutes'], b: SimulationParams['walkMinutes']): boolean => {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => a[key] === b[key]);
};

/** 两组参数里不同的参数项，按 PARAM_KEYS 的顺序 */
export function changedParams(from: SimulationParams, to: SimulationParams): ParamKey[] {
  return PARAM_KEYS.filter(key =>
    key === 'walk' ? !sameWalkMinutes(from.walkMinutes, to.walkMinutes) : from[key] !== to[key]
  );
}

/** 带正负号的百分比，如"+10%""−5%""0%" */
export const signedPercent = (value: number): string => `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value)}%`;

// 步行时长的说明：没改过写"标准"，改了一项写指标和时长，多项写个数
function walkText({ walkMinutes }: SimulationParams): string {
  const entries = Object.entries(walkMinutes);
  const [first] = entries;
  if (!first) {
    return '标准';
  }
  if (entries.length > 1) {
    return `${entries.length} 项已调整`;
  }
  const [id, minutes] = first;
  return `${simulationIndicator(id).short.replace('覆盖率', '')} ${minutes} 分钟`;
}

/** 参数项的取值说明，如"旧规程""相交即算""+10%""社区卫生 10 分钟" */
export function describeParam(key: ParamKey, params: SimulationParams): string {
  const texts: Readonly<Record<ParamKey, string>> = {
    rule: RULE_LABELS[params.rule],
    recognition: RECOGNITION_LABELS[params.recognition],
    popChange: signedPercent(params.popChange),
    walk: walkText(params)
  };
  return texts[key];
}
