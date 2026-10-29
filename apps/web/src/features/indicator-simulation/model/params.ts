import { demoTarget, SIMULATION_INDICATORS, simulationIndicator } from './indicators';

/** 推演条件：年度、监测范围（市）、监测指标（编排图上的顺序） */
export interface SimulationConditions {
  readonly years: readonly number[];
  readonly cityCodes: readonly string[];
  readonly indicatorIds: readonly string[];
}

export type PopulationCaliber = 'resident' | 'registered';
export type FacilityScope = 'all' | 'standard' | 'large';

/** 最新年度人口缺失的处理：按趋势插补、剔除这些区县、手动填写（万人，按区县代码） */
export type MissingTreatment =
  | { readonly kind: 'impute' }
  | { readonly kind: 'exclude' }
  | { readonly kind: 'manual'; readonly values: Readonly<Record<string, number>> };

/** 可调整的参数：数据核查、空间分析、评价分级各自用到其中几项 */
export interface SimulationParams {
  readonly popCaliber: PopulationCaliber;
  readonly missing: MissingTreatment;
  /** 步行速度（米/分钟），步行类覆盖率的服务半径 = 速度 × 分钟数 */
  readonly walkSpeed: number;
  readonly facilityScope: FacilityScope;
  /** 规划新增设施（%）：情景假设，在现有设施附近按比例补点 */
  readonly newFacilities: number;
  /** 规划新增作用于哪些指标；null 是全部 */
  readonly scenarioIds: readonly string[] | null;
  /** 演示目标值，按指标编码 */
  readonly targets: Readonly<Record<string, number>>;
}

/** 参数的取值范围，界面的滑块按它设置 */
export const WALK_SPEED_RANGE = { min: 40, max: 100, step: 5 } as const;
export const NEW_FACILITIES_RANGE = { min: 0, max: 50, step: 5 } as const;

let defaults: SimulationParams | undefined;

/** 默认参数：常住人口、插补、60 米/分钟、规模以上设施、不新增；第一次用到时才算目标值，之后一直是同一个对象 */
export function defaultParams(): SimulationParams {
  defaults ??= {
    popCaliber: 'resident',
    missing: { kind: 'impute' },
    walkSpeed: 60,
    facilityScope: 'standard',
    newFacilities: 0,
    scenarioIds: null,
    targets: Object.fromEntries(SIMULATION_INDICATORS.map(({ id }) => [id, demoTarget(id)]))
  };
  return defaults;
}

/** 一项指标在不在规划新增的作用范围里 */
export const inScenario = (params: SimulationParams, id: string): boolean => params.scenarioIds === null || params.scenarioIds.includes(id);

/** 用户能调整的参数项；规划新增和它的作用范围算一项，缺失处理和手动填写的数字算一项 */
export type ParamKey = 'popCaliber' | 'missing' | 'walkSpeed' | 'facilityScope' | 'newFacilities' | 'targets';

/** 参数项在推演中的先后：归因按这个顺序逐项替换 */
export const PARAM_KEYS: readonly ParamKey[] = ['popCaliber', 'missing', 'walkSpeed', 'facilityScope', 'newFacilities', 'targets'];

export const PARAM_LABELS: Readonly<Record<ParamKey, string>> = {
  popCaliber: '人口口径',
  missing: '缺失数据处理',
  walkSpeed: '步行速度',
  facilityScope: '设施纳入口径',
  newFacilities: '规划新增设施',
  targets: '演示目标值'
};

export const CALIBER_LABELS: Readonly<Record<PopulationCaliber, string>> = { resident: '常住人口', registered: '户籍人口' };
export const SCOPE_LABELS: Readonly<Record<FacilityScope, string>> = { all: '全部设施', standard: '规模以上设施', large: '仅中大型设施' };
export const MISSING_LABELS: Readonly<Record<MissingTreatment['kind'], string>> = { impute: '按趋势插补', exclude: '剔除缺失区县', manual: '手动填写' };

// 按键比较两组数字（目标值、手动填写的人口），键的先后不算
function sameNumbers(a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every(key => a[key] === b[key]);
}

// 作用范围按集合比较：null（全部）只等于 null
function sameScope(a: readonly string[] | null, b: readonly string[] | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return a.length === b.length && a.every(id => b.includes(id));
}

function sameMissing(a: MissingTreatment, b: MissingTreatment): boolean {
  if (a.kind === 'manual' && b.kind === 'manual') {
    return sameNumbers(a.values, b.values);
  }
  return a.kind === b.kind;
}

/** 两组参数里不同的参数项，按 PARAM_KEYS 的顺序 */
export function changedParams(from: SimulationParams, to: SimulationParams): ParamKey[] {
  const same: Readonly<Record<ParamKey, () => boolean>> = {
    popCaliber: () => from.popCaliber === to.popCaliber,
    missing: () => sameMissing(from.missing, to.missing),
    walkSpeed: () => from.walkSpeed === to.walkSpeed,
    facilityScope: () => from.facilityScope === to.facilityScope,
    newFacilities: () => from.newFacilities === to.newFacilities && sameScope(from.scenarioIds, to.scenarioIds),
    targets: () => sameNumbers(from.targets, to.targets)
  };
  return PARAM_KEYS.filter(key => !same[key]());
}

/** 规划新增作用的指标：全部，或一两项的简称，多了写"某某等 n 项" */
export function scenarioText(params: SimulationParams, conditions: SimulationConditions): string {
  if (params.scenarioIds === null) {
    return '全部指标';
  }
  const names = params.scenarioIds.filter(id => conditions.indicatorIds.includes(id)).map(id => simulationIndicator(id).short);
  if (names.length === 0) {
    return '无指标';
  }
  return names.length <= 2 ? names.join('、') : `${names[0]}等 ${names.length} 项`;
}

/** 参数项的取值说明，如"60 米/分钟""20%（公园绿地覆盖率）"；目标值写成"n 项已调整" */
export function describeParam(key: ParamKey, params: SimulationParams, conditions: SimulationConditions): string {
  switch (key) {
    case 'popCaliber':
      return CALIBER_LABELS[params.popCaliber];
    case 'missing':
      return params.missing.kind === 'manual'
        ? `手动填写（${Object.values(params.missing.values).map(value => `${value} 万人`).join('、')}）`
        : MISSING_LABELS[params.missing.kind];
    case 'walkSpeed':
      return `${params.walkSpeed} 米/分钟`;
    case 'facilityScope':
      return SCOPE_LABELS[params.facilityScope];
    case 'newFacilities':
      return params.newFacilities === 0 ? '0%' : `${params.newFacilities}%（${scenarioText(params, conditions)}）`;
    case 'targets':
      break;
  }
  const initial = defaultParams().targets;
  const changed = conditions.indicatorIds.filter(id => params.targets[id] !== initial[id]).length;
  return changed === 0 ? `${conditions.indicatorIds.length} 项默认` : `${changed} 项已调整`;
}
