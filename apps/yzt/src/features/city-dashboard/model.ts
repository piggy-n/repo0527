import type { IndicatorValueSource } from '@/shared/city-indicators/indicator-value';

// 指标与分类的类型随目录移到 shared/city-indicators（ADR 0105），驾驶舱各处仍从这里取
export type { CategoryId, Indicator } from '@/shared/city-indicators/catalog';
// 两个驾驶舱共用的类型在 shared/dashboard，原驾驶舱各处仍从这里取
export type {
  CartesianChartType,
  ChartHover,
  ChartPreference,
  City,
  Comparison,
  DashboardData
} from '@/shared/dashboard/model';

/** 缺失值明确为空，不能参与均值或被画成零 */
export type DashboardRecord = {
  readonly year: number;
  readonly cityCode: string;
  readonly indicatorCode: string;
  readonly unit: string;
  readonly dataSource: IndicatorValueSource;
} & ({ readonly status: 'available'; readonly value: number }
  | { readonly status: 'missing'; readonly value: null });
