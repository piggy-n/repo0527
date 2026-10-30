import { mockIndicatorValue } from '@/shared/city-indicators/mock-value';
import { CITIES, DASHBOARD_YEARS, INDICATORS } from '../catalog';
import type { DashboardData, DashboardRecord } from '../model';

const keyOf = (year: number, cityCode: string, indicatorCode: string) => `${year}:${cityCode}:${indicatorCode}`;

/** 进入驾驶舱时创建固定模拟记录，年份由调用方提供以便复核跨年稳定性 */
export function createMockData(currentYear: number): DashboardData & { readonly records: readonly DashboardRecord[] } {
  if (!Number.isInteger(currentYear) || currentYear < 1) {
    throw new Error('模拟数据需要有效的当前年份');
  }
  const latestYear = Math.max(currentYear, ...DASHBOARD_YEARS);
  const years = Array.from({ length: 10 }, (_, index) => latestYear - index);
  const records: DashboardRecord[] = [];
  for (const year of years) {
    for (const indicator of INDICATORS) {
      for (const city of CITIES) {
        records.push({
          year,
          cityCode: city.code,
          indicatorCode: indicator.id,
          value: mockIndicatorValue(city.code, indicator, year),
          unit: indicator.unit,
          dataSource: 'mock',
          status: 'available'
        });
      }
    }
  }
  const index = new Map(
    records.map(record => [keyOf(record.year, record.cityCode, record.indicatorCode), record.value])
  );
  return {
    years,
    records,
    value: (year, cityCode, indicatorCode) => index.get(keyOf(year, cityCode, indicatorCode)) ?? null
  };
}
