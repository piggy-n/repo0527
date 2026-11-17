/** 图表类型与数据记录保持独立，后续数据适配不依赖 ECharts */
export type CartesianChartType = 'bar' | 'line';
export type ChartType = CartesianChartType | 'radar';

/** 图表只读这四项；原驾驶舱的 Indicator 可以直接赋给它 */
export interface IndicatorMeta {
  readonly id: string;
  readonly name: string;
  readonly unit: string;
  readonly precision: number;
}

export interface City {
  readonly code: string;
  readonly name: string;
  readonly anchor: readonly [number, number];
}

/** 驾驶舱注入的数据读接口：按年份、城市、指标取值，缺失为 null */
export interface DashboardData {
  readonly years: readonly number[];

  value(year: number, cityCode: string, indicatorCode: string): number | null;
}

export interface Comparison {
  readonly year: number;
  readonly values: readonly (number | null)[];
  readonly average: number | null;
}

export interface ChartPreference<T extends ChartType = CartesianChartType> {
  readonly type: T;
  readonly showAverage: boolean;
  readonly legend: Readonly<Record<string, boolean>>;
}

/** 地图和图表共用的指标悬停目标 */
export interface ChartHover {
  readonly indicatorId: string;
  readonly cityCode: string;
}
