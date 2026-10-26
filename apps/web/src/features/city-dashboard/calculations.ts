import type { City, Comparison, DashboardData, Indicator } from './model';

/** 只接受有限数字，缺失值与 NaN 不参与统计 */
export function isValue(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** 去掉浮点运算的尾差（如 0.1 + 0.2），只保留 14 位有效数字 */
export function trimFloat(value: number): number {
  return Number(value.toPrecision(14));
}

/** 不小于 value 的 1、2、5 × 10ⁿ 中最小的一个，作为整齐的刻度或分档步长 */
export function niceStep(value: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const factor = [1, 2, 5, 10].find(item => item * magnitude >= value) ?? 10;
  return trimFloat(factor * magnitude);
}

/** 数值写成十进制时的小数位数；按 String 的写法计算，科学计数法（如 1e-7）也算对 */
export function decimalPlaces(value: number): number {
  const [coefficient, exponent = '0'] = String(value).split('e');
  const [, fraction = ''] = coefficient.split('.');
  return Math.max(0, fraction.length - Number(exponent));
}

/** 每年独立计算所选城市的算术平均，空集不返回零 */
export function compareIndicator(
  data: DashboardData,
  indicator: Indicator,
  years: readonly number[],
  cities: readonly City[]
): Comparison[] {
  // 均值至少保留一位小数，整数指标的均值也能看出差别
  const averagePrecision = Math.max(1, indicator.precision);
  return [...new Set(years)]
    .toSorted((a, b) => a - b)
    .map(year => {
      const values = cities.map(city => {
        const value = data.value(year, city.code, indicator.id);
        return isValue(value) ? value : null;
      });
      const valid = values.filter(isValue);
      if (valid.length === 0) {
        return { year, values, average: null };
      }
      const sum = valid.reduce((total, value) => total + value, 0);
      return { year, values, average: Number((sum / valid.length).toFixed(averagePrecision)) };
    });
}

const formats = new Map<number, Intl.NumberFormat>();

/** 数量、覆盖率与职住比共用精度规则；1:X 的数值表示 X */
export function formatValue(
  value: number | null | undefined,
  indicator: Pick<Indicator, 'unit' | 'precision'>,
  withUnit = true,
  precision = indicator.precision
): string {
  if (!isValue(value)) {
    return '—';
  }
  let format = formats.get(precision);
  if (!format) {
    format = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: precision });
    formats.set(precision, format);
  }
  const number = format.format(value);
  if (!withUnit) {
    return number;
  }
  return indicator.unit === '1:X' ? `1:${number}` : `${number}${indicator.unit}`;
}
