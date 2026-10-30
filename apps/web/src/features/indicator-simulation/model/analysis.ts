import type { Calculator, IndicatorResult } from './calculator';
import { simulationIndicator } from './indicators';
import { defaultParams, type SimulationConditions } from './params';

/** 达标、接近（差距在目标值的 5% 以内）、未达标 */
export type PassState = 'pass' | 'near' | 'fail';

export function passState(value: number, target: number): PassState {
  if (value >= target) {
    return 'pass';
  }
  return value >= target * 0.95 ? 'near' : 'fail';
}

/** 地图分级的断点：所选年度在标准口径下的区县值取五档分位数，年度、版本之间的颜色可比 */
export function valueBreaks(
  calculator: Calculator,
  conditions: SimulationConditions,
  indicatorId: string
): readonly number[] {
  const single = { ...conditions, indicatorIds: [indicatorId] };
  const values = conditions.years
    .flatMap(year => {
      const { indicators } = calculator.computeYear(single, defaultParams(), year);
      return indicatorResult(indicators, indicatorId).rows.map(row => row.value);
    })
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
