/** 图表类型与模拟记录保持独立，后续数据适配不依赖 ECharts */
export type ChartType = 'bar' | 'line';
export type CategoryId = 'resilience' | 'innovation' | 'happiness' | 'coordination';

/** 目录保留旧来源字段，sampleValue 不代表某城市某年的统计结果 */
export interface Indicator {
  readonly id: string;
  readonly name: string;
  readonly unit: string;
  readonly scope: string;
  readonly categoryId: string;
  readonly sampleValue: number | null;
  readonly mockBase: number;
  readonly mapMax: number;
  readonly precision: number;
  readonly sourceFile: string;
  readonly sourceGroup: string;
}

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
