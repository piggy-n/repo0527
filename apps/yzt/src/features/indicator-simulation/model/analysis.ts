import type { Calculator, IndicatorResult } from './calculator';
import { simulationIndicator } from './indicators';
import { defaultParams, type SimulationConditions, type SimulationParams } from './params';

/**
 * 地图分级的断点：所选年度的区县值取五档分位数，年度、版本之间的颜色可比。其余参数按标准口径，
 * 步行时长按设定的：时长不同的结果不在一个量级，否则改短后所有区县都落在最低一档（ADR 0125）
 */
export function valueBreaks(
  calculator: Calculator,
  conditions: SimulationConditions,
  indicatorId: string,
  { walkMinutes }: SimulationParams
): readonly number[] {
  const single = { ...conditions, indicatorIds: [indicatorId] };
  const params = { ...defaultParams(), walkMinutes };
  const values = conditions.years
    .flatMap(year => {
      const { indicators } = calculator.computeYear(single, params, year);
      return indicatorResult(indicators, indicatorId).rows.map(row => row.value);
    })
    .toSorted((a, b) => a - b);
  const quantiles = [0.2, 0.4, 0.6, 0.8].map(q => values[Math.floor(q * (values.length - 1))] ?? 0);
  return roundBreaks(quantiles, simulationIndicator(indicatorId).unit === '%' ? 0 : 1);
}

/** 断点取整：值都挤在一起时（如步行时长长、都接近 100%）多留小数，各档才分得开；最多多留两位 */
export function roundBreaks(values: readonly number[], digits: number): readonly number[] {
  const roundedTo = (places: number) => values.map(value => Number(value.toFixed(places)));
  for (const places of [digits, digits + 1]) {
    const edges = roundedTo(places);
    if (new Set(edges).size === edges.length) {
      return edges;
    }
  }
  return roundedTo(digits + 2);
}

/** 取一项指标的结果；条件里没有这项时抛错 */
export function indicatorResult(indicators: Readonly<Record<string, IndicatorResult>>, id: string): IndicatorResult {
  const result = indicators[id];
  if (!result) {
    throw new Error(`计算结果里没有指标 ${id}`);
  }
  return result;
}
