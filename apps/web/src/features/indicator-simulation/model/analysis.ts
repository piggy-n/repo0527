import type { Calculator, IndicatorResult } from './calculator';
import { simulationIndicator } from './indicators';
import {
  changedParams,
  defaultParams,
  describeParam,
  paramApplies,
  type ParamKey,
  POP_CHANGE_RANGE,
  RECOGNITION_LABELS,
  type Recognition,
  type Rule,
  RULE_LABELS,
  type SimulationConditions,
  type SimulationParams,
  withParam
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
  // 对这项指标不起作用的参数、别的指标改了目标值，都和这项指标无关
  const keys = changedParams(from, to).filter(
    key => paramApplies(key, indicatorId) && (key !== 'targets' || from.targets[indicatorId] !== to.targets[indicatorId])
  );
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

/** 参数敏感性的一个情景：计算规程、覆盖认定的一种组合 */
export interface SensitivityOption {
  readonly label: string;
  readonly value: number;
  readonly current: boolean;
  readonly standard: boolean;
}

/**
 * 参数敏感性：这项指标自己的参数取不同值时的全省值。人均类按常住人口变化画曲线，
 * 住宅用地覆盖率列出计算规程、覆盖认定的各种组合；没有可调参数（城区面积覆盖率）时为 null
 */
export type Sensitivity =
  | { readonly kind: 'curve'; readonly points: readonly (readonly [x: number, value: number])[]; readonly current: number }
  | {
      readonly kind: 'options';
      /** 取不同值的参数：计算规程、覆盖认定中这项指标用得上的 */
      readonly keys: readonly ParamKey[];
      readonly options: readonly SensitivityOption[];
    };

export function sensitivity(
  calculator: Calculator,
  conditions: SimulationConditions,
  params: SimulationParams,
  indicatorId: string,
  year: number
): Sensitivity | null {
  const single = { ...conditions, indicatorIds: [indicatorId] };
  const valueOf = (next: SimulationParams) => indicatorResult(calculator.computeYear(single, next, year).indicators, indicatorId).value;
  if (paramApplies('popChange', indicatorId)) {
    const points: (readonly [number, number])[] = [];
    for (let x = POP_CHANGE_RANGE.min; x <= POP_CHANGE_RANGE.max; x += POP_CHANGE_RANGE.step) {
      points.push([x, valueOf({ ...params, popChange: x })]);
    }
    return { kind: 'curve', points, current: params.popChange };
  }
  const rules: readonly Rule[] = paramApplies('rule', indicatorId) ? ['new', 'old'] : [params.rule];
  const recognitions: readonly Recognition[] = paramApplies('recognition', indicatorId) ? ['half', 'intersect'] : [params.recognition];
  if (rules.length * recognitions.length === 1) {
    return null;
  }
  const standard = defaultParams();
  const options = rules.flatMap(rule =>
    recognitions.map((recognition): SensitivityOption => {
      const changed = [
        ...(rule === standard.rule ? [] : [RULE_LABELS[rule]]),
        ...(recognition === standard.recognition ? [] : [RECOGNITION_LABELS[recognition]])
      ];
      return {
        label: changed.length === 0 ? '标准口径' : changed.join(' + '),
        value: valueOf({ ...params, rule, recognition }),
        current: rule === params.rule && recognition === params.recognition,
        standard: changed.length === 0
      };
    })
  );
  const keys: ParamKey[] = [
    ...(rules.length > 1 ? ['rule' as const] : []),
    ...(recognitions.length > 1 ? ['recognition' as const] : [])
  ];
  return { kind: 'options', keys, options };
}

/** 地图分级的断点：所选年度在标准口径下的区县值取五档分位数，年度、版本之间的颜色可比 */
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
