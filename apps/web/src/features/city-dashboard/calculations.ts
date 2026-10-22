import type { City, Comparison, DashboardData, Indicator } from './model';

/** 只接受有限数字，缺失值与 NaN 不参与统计 */
export function isValue(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** 每年独立计算所选城市的算术平均，空集不返回零 */
export function compareIndicator(
  data: DashboardData,
  indicator: Indicator,
  years: readonly number[],
  cities: readonly City[]
): Comparison[] {
  return [...new Set(years)].toSorted((a, b) => a - b).map(year => {
    const values = cities.map(city => data.value(
      year,
      city.code,
      indicator.id
    )).map(value => isValue(value) ? value : null);
    const valid = values.filter(isValue);
    const average = valid.length
      ? Number((valid.reduce((sum, value) => sum + value, 0) / valid.length).toFixed(Math.max(1, indicator.precision)))
      : null;
    return { year, values, average };
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
