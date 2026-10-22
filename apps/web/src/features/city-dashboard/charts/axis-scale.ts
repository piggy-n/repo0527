import { isValue } from '../calculations';

export interface AxisScale {
  readonly min: number;
  readonly max: number;
  readonly interval: number;
  readonly precision: number;
}

interface ScaleOptions {
  includeZero?: boolean;
  integer?: boolean;
  lowerBound?: number;
  upperBound?: number;
}

function cleanTick(value: number): number {
  return Number(value.toPrecision(14));
}

/** 1 / 2 / 5 等距刻度保留距离与数值的线性关系 */
function niceInterval(value: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return cleanTick(([1, 2, 5, 10].find(factor => factor * magnitude >= value) ?? 10) * magnitude);
}

/** 柱图保留零基线，语义边界只约束留白，不裁掉异常数据 */
export function createValueAxisScale(
  values: readonly (number | null)[],
  { includeZero = false, integer = false, lowerBound, upperBound }: ScaleOptions = {}
): AxisScale {
  const samples = values.filter(isValue);
  if (!samples.length) {
    return { min: 0, max: integer ? 5 : 1, interval: integer ? 1 : 0.2, precision: integer ? 0 : 1 };
  }
  let min = Math.min(...samples);
  let max = Math.max(...samples);
  const lowerLimit = isValue(lowerBound) ? Math.min(lowerBound, min) : -Infinity;
  const upperLimit = isValue(upperBound) ? Math.max(upperBound, max) : Infinity;
  if (includeZero) {
    min = Math.min(0, min);
    max = Math.max(0, max);
  }
  if (min === max) {
    const padding = Math.abs(min) * 0.1 || (integer ? 5 : 1);
    if (!includeZero || min < 0) {
      min -= padding;
    }
    if (!includeZero || max >= 0) {
      max += padding;
    }
  }
  const padding = (max - min) * 0.08;
  const lower = Math.max(lowerLimit, includeZero && min === 0 ? 0 : min - padding);
  const upper = Math.min(upperLimit, includeZero && max === 0 ? 0 : max + padding);
  let interval = Math.max(integer ? 1 : 0, niceInterval((upper - lower) / 5));
  let axisMin = lower;
  let axisMax = upper;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) {
      interval = niceInterval(interval * 1.01);
    }
    axisMin = cleanTick(Math.floor(cleanTick(lower / interval)) * interval);
    axisMax = cleanTick(Math.ceil(cleanTick(upper / interval)) * interval);
    if (axisMax - axisMin <= interval * 6.000001) {
      break;
    }
  }
  if (Number.isFinite(lowerLimit) && Number.isInteger(cleanTick(lowerLimit / interval))) {
    axisMin = Math.max(axisMin, lowerLimit);
  }
  if (Number.isFinite(upperLimit) && Number.isInteger(cleanTick(upperLimit / interval))) {
    axisMax = Math.min(axisMax, upperLimit);
  }
  const [coefficient, exponent = '0'] = String(interval).split('e');
  const precision = Math.max(0, (coefficient.split('.')[1]?.length ?? 0) - Number(exponent));
  return { min: axisMin, max: axisMax, interval, precision };
}
