import { JIANGSU_CITIES } from '@/shared/map/region/region-catalog';
import { indicatorResult, type PassState, passState } from '../model/analysis';
import type { Calculator } from '../model/calculator';
import { type SimulationIndicator, simulationIndicator } from '../model/indicators';
import { defaultParams, isScenario, type SimulationConditions, type SimulationParams } from '../model/params';

/** 一个市时是它的达标状态，几个市时是达标的市数 */
export type EstimatePass =
  | { readonly kind: 'single'; readonly state: PassState }
  | { readonly kind: 'cities'; readonly count: number; readonly total: number };

/** 预估的一项指标：这组参数下的值；模拟情景时还有标准口径的值 */
export interface EstimateRow {
  readonly indicator: SimulationIndicator;
  readonly value: number;
  /** 标准口径的值；不是模拟情景时为 null */
  readonly standard: number | null;
  readonly target: number;
  readonly pass: EstimatePass;
}

export interface Estimate {
  /** 监测范围的说明，如"南京市""全省""3 个市" */
  readonly scope: string;
  /** 预估的年度 */
  readonly year: number;
  readonly rows: readonly EstimateRow[];
}

function scopeName(cityCodes: readonly string[]): string {
  if (cityCodes.length === JIANGSU_CITIES.length) {
    return '全省';
  }
  const [only] = cityCodes;
  if (cityCodes.length === 1 && only !== undefined) {
    return JIANGSU_CITIES.find(city => city.code === only)?.name ?? only;
  }
  return `${cityCodes.length} 个市`;
}

/** 编排时的即时预估：所选范围在某一年度的值，不传或不在条件里时是最新年度；年度、范围、指标有一项没选时为 null */
export function estimate(
  calculator: Calculator,
  conditions: SimulationConditions,
  params: SimulationParams,
  wanted?: number
): Estimate | null {
  const { years, cityCodes, indicatorIds } = conditions;
  if (years.length === 0 || cityCodes.length === 0 || indicatorIds.length === 0) {
    return null;
  }
  const year = wanted !== undefined && years.includes(wanted) ? wanted : Math.max(...years);
  const current = calculator.computeYear(conditions, params, year).indicators;
  // 模拟情景的指标再按标准口径算一遍，目标值不变
  const scenarioIds = indicatorIds.filter(id => isScenario(params, id));
  const standard =
    scenarioIds.length === 0
      ? {}
      : calculator.computeYear({ ...conditions, indicatorIds: scenarioIds }, { ...defaultParams(), targets: params.targets }, year)
          .indicators;
  const rows = indicatorIds.map((id): EstimateRow => {
    const data = indicatorResult(current, id);
    const pass: EstimatePass =
      data.total === 1
        ? { kind: 'single', state: passState(data.value, data.target) }
        : { kind: 'cities', count: data.passCount, total: data.total };
    return {
      indicator: simulationIndicator(id),
      value: data.value,
      standard: scenarioIds.includes(id) ? indicatorResult(standard, id).value : null,
      target: data.target,
      pass
    };
  });
  return { scope: scopeName(cityCodes), year, rows };
}
