import { CITIES, DASHBOARD_YEARS, INDICATORS } from '../catalog';
import type { DashboardData, DashboardRecord, Indicator } from '../model';
import { createProfileValue } from './indicator-profiles';

const indicatorsById = new Map(INDICATORS.map(indicator => [indicator.id, indicator]));
const aggregateParts: Readonly<Record<string, readonly string[]>> = {
  'A-16': ['D02-3-1', 'D02-3-2'],
  'G01-6': ['G01-6-1', 'G01-6-2']
};

/** 内部目录缺项属于配置错误，在创建数据时暴露，不从 computed 抛出 */
function requireIndicator(id: string): Indicator {
  const indicator = indicatorsById.get(id);
  if (!indicator) {
    throw new Error(`模拟指标目录缺少 ${id}`);
  }
  return indicator;
}

/** 保留建筑合计与分项、生活圈并集与交集的约束 */
function createValue(cityCode: string, indicator: Indicator, year: number): number {
  const parts = aggregateParts[indicator.id];
  if (parts) {
    return parts.reduce((sum, id) => sum + createProfileValue(cityCode, requireIndicator(id), year), 0);
  }
  const value = createProfileValue(cityCode, indicator, year);
  return indicator.id === 'A09-2'
    ? Math.max(value, createProfileValue(cityCode, requireIndicator('A-30'), year))
    : value;
}

/** 进入驾驶舱时创建固定模拟记录，年份由调用方提供以便复核跨年稳定性 */
export function createMockData(currentYear: number): DashboardData & { readonly records: readonly DashboardRecord[] } {
  if (!Number.isInteger(currentYear) || currentYear < 1) {
    throw new Error('模拟数据需要有效的当前年份');
  }
  const latestYear = Math.max(currentYear, ...DASHBOARD_YEARS);
  const years = Array.from({ length: 10 }, (_, index) => latestYear - index);
  const records: DashboardRecord[] = years.flatMap(year => INDICATORS.flatMap(indicator => CITIES.map(city => ({
    year,
    cityCode: city.code,
    indicatorCode: indicator.id,
    value: createValue(city.code, indicator, year),
    unit: indicator.unit,
    dataSource: 'mock' as const,
    status: 'available' as const
  }))));
  const index = new Map(records.map(record => [
    `${record.year}:${record.cityCode}:${record.indicatorCode}`, record.value
  ]));
  return {
    years,
    records,
    value: (year, cityCode, indicatorCode) => index.get(`${year}:${cityCode}:${indicatorCode}`) ?? null
  };
}
