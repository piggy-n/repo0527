import type { SimulationIndicator } from './model/indicators';

type Unit = Pick<SimulationIndicator, 'unit'>;

const digitsOf = (indicator: Unit): number => (indicator.unit === '%' ? 1 : 2);
// 预估的精度：百分比取整，人均值多在 1～15，取整后看不出变化，保留一位（用户 2026-10-29 定）
const estimateDigitsOf = (indicator: Unit): number => (indicator.unit === '%' ? 0 : 1);

const withUnitText = (text: string, indicator: Unit) =>
  indicator.unit === '%' ? `${text}%` : `${text} ${indicator.unit}`;
const deltaText = (text: string, indicator: Unit) =>
  indicator.unit === '%' ? `${text} 个百分点` : `${text} ${indicator.unit}`;

/** 指标值：百分比一位小数，其余两位小数加单位，如"64.6%""12.35 平方米/人" */
export function formatValue(value: number, indicator: Unit, withUnit = true): string {
  const text = value.toFixed(digitsOf(indicator));
  return withUnit ? withUnitText(text, indicator) : text;
}

/** 变化量：带正负号，百分比写成"个百分点" */
export function formatDelta(delta: number, indicator: Unit): string {
  return deltaText(`${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(digitsOf(indicator))}`, indicator);
}

/** 按预估的精度取整：变化量用取整后的值相减，和显示的数对得上 */
export function roundEstimate(value: number, indicator: Unit): number {
  const scale = 10 ** estimateDigitsOf(indicator);
  // 加 0 把 -0 变成 0
  return Math.round(value * scale) / scale + 0;
}

/** 预估值：按预估的精度，前面加"≈"，如"≈85%""≈1.2 平方米/人"；目标这类定值传 approx 为 false，不加 */
export function formatEstimate(value: number, indicator: Unit, approx = true): string {
  const text = withUnitText(roundEstimate(value, indicator).toFixed(estimateDigitsOf(indicator)), indicator);
  return approx ? `≈${text}` : text;
}

/** 预估的变化量：传入取整后的差，带正负号（没有变化时写 0），百分比写成"个百分点" */
export function formatEstimateDelta(delta: number, indicator: Unit): string {
  const rounded = roundEstimate(delta, indicator);
  const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : '';
  return deltaText(`${sign}${Math.abs(rounded).toFixed(estimateDigitsOf(indicator))}`, indicator);
}
