// 指标与分类的类型随目录移到 shared/city-indicators（ADR 0102），驾驶舱各处仍从这里取
export type { CategoryId, Indicator } from '@/shared/city-indicators/catalog';

/** 图表类型与模拟记录保持独立，后续数据适配不依赖 ECharts */
export type ChartType = 'bar' | 'line';

export interface City {
  readonly code: string;
  readonly name: string;
  readonly anchor: readonly [number, number];
}

/** 缺失值明确为空，不能参与均值或被画成零 */
export type DashboardRecord = {
  readonly year: number;
  readonly cityCode: string;
  readonly indicatorCode: string;
  readonly unit: string;
  readonly dataSource: 'mock';
} & ({ readonly status: 'available'; readonly value: number }
  | { readonly status: 'missing'; readonly value: null });

/** 页面注入数据读接口；目前唯一实现是固定模拟数据，不声明虚构接口 */
export interface DashboardData {
  readonly years: readonly number[];

  value(year: number, cityCode: string, indicatorCode: string): number | null;
}

export interface Comparison {
  readonly year: number;
  readonly values: readonly (number | null)[];
  readonly average: number | null;
}

export interface ChartPreference {
  readonly type: ChartType;
  readonly showAverage: boolean;
  readonly legend: Readonly<Record<string, boolean>>;
}

/** 地图和图表共用的指标悬停目标 */
export interface ChartHover {
  readonly indicatorId: string;
  readonly cityCode: string;
}
