import {
  type Indicator,
  INDICATOR_CATEGORIES,
  type IndicatorCategory,
  INDICATORS
} from '@/shared/city-indicators/catalog';
import { indicatorValueSource } from '@/shared/city-indicators/indicator-value';

/** 页面开放年份保持旧配置，独立于模拟记录的十年范围 */
export const DASHBOARD_YEARS: readonly number[] = [2026, 2025, 2024, 2023, 2022, 2021];

// 13 市的顺序与标签锚点两个驾驶舱共用，在 shared/dashboard
export { DASHBOARD_CITIES as CITIES } from '@/shared/dashboard/cities';

// 指标目录与四个分类在 shared/city-indicators，指标智能推演也用（ADR 0105）
export { INDICATORS };

export interface DashboardCategory extends IndicatorCategory {
  readonly indicators: readonly Indicator[];
}

// 最新开放年份有简报原数才算有真实数据：超高层的两个分项是折算，不算
const hasReportData = ({ id }: Indicator) => indicatorValueSource(id, DASHBOARD_YEARS[0]) === 'report';

// 有真实数据的指标排在前面，两部分内部保持目录顺序
function reportedFirst(indicators: readonly Indicator[]): readonly Indicator[] {
  return [...indicators.filter(hasReportData), ...indicators.filter(indicator => !hasReportData(indicator))];
}

/** 四类指标只持有目录引用，不复制或生成展示值；顺序只属于驾驶舱，目录和 AI 计算页不受影响 */
export const CATEGORIES: readonly DashboardCategory[] = INDICATOR_CATEGORIES.map(({ id, name }) => ({
  id,
  name,
  indicators: reportedFirst(INDICATORS.filter(indicator => indicator.categoryId === id))
}));
