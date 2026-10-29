import type { SimulationIndicator } from './model/indicators';

const digitsOf = (indicator: Pick<SimulationIndicator, 'unit'>): number => (indicator.unit === '%' ? 1 : 2);

/** 指标值：百分比一位小数，其余两位小数加单位，如"64.6%""12.35 平方米/人" */
export function formatValue(value: number, indicator: Pick<SimulationIndicator, 'unit'>, withUnit = true): string {
  const text = value.toFixed(digitsOf(indicator));
  if (!withUnit) {
    return text;
  }
  return indicator.unit === '%' ? `${text}%` : `${text} ${indicator.unit}`;
}

/** 变化量：带正负号，百分比写成"个百分点" */
export function formatDelta(delta: number, indicator: Pick<SimulationIndicator, 'unit'>): string {
  const text = `${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(digitsOf(indicator))}`;
  return indicator.unit === '%' ? `${text} 个百分点` : `${text} ${indicator.unit}`;
}
