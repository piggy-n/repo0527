import { type Indicator, INDICATOR_CATEGORIES, type IndicatorCategory, INDICATORS } from '@/shared/city-indicators/catalog';
import type { City } from './model';

/** 页面开放年份保持旧配置，独立于模拟记录的十年范围 */
export const DASHBOARD_YEARS: readonly number[] = [2026, 2025, 2024, 2023, 2022, 2021];

/** 城市顺序与标签锚点沿用 master-demo */
export const CITIES: readonly City[] = [
  { code: '320100', name: '南京市', anchor: [118.90, 31.95] },
  { code: '320200', name: '无锡市', anchor: [120.13, 31.47] },
  { code: '320300', name: '徐州市', anchor: [117.48, 34.31] },
  { code: '320400', name: '常州市', anchor: [119.55, 31.70] },
  { code: '320500', name: '苏州市', anchor: [120.72, 31.35] },
  { code: '320600', name: '南通市', anchor: [121.05, 32.22] },
  { code: '320700', name: '连云港市', anchor: [119.13, 34.56] },
  { code: '320800', name: '淮安市', anchor: [119.02, 33.37] },
  { code: '320900', name: '盐城市', anchor: [120.09, 33.62] },
  { code: '321000', name: '扬州市', anchor: [119.44, 32.82] },
  { code: '321100', name: '镇江市', anchor: [119.39, 32.03] },
  { code: '321200', name: '泰州市', anchor: [120.04, 32.65] },
  { code: '321300', name: '宿迁市', anchor: [118.46, 33.96] }
];

// 指标目录与四个分类在 shared/city-indicators，指标智能推演也用（ADR 0102）
export { INDICATORS };

export interface DashboardCategory extends IndicatorCategory {
  readonly indicators: readonly Indicator[];
}

/** 四类指标只持有目录引用，不复制或生成展示值 */
export const CATEGORIES: readonly DashboardCategory[] = INDICATOR_CATEGORIES.map(({ id, name }) => ({
  id,
  name,
  indicators: INDICATORS.filter(indicator => indicator.categoryId === id)
}));
