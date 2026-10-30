import rawIndicators from './indicator-catalog.json';

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

export interface IndicatorCategory {
  readonly id: CategoryId;
  readonly name: string;
}

/** 城市体检的 96 项指标，来自旧项目的 data.json 与 data2.json（docs/modules/city-dashboard.md"数据口径"） */
export const INDICATORS: readonly Indicator[] = rawIndicators;

/** 四类指标，顺序沿用驾驶舱 */
export const INDICATOR_CATEGORIES: readonly IndicatorCategory[] = [
  { id: 'resilience', name: '安全韧性' },
  { id: 'innovation', name: '创新高效/开放繁荣' },
  { id: 'happiness', name: '共享幸福' },
  { id: 'coordination', name: '协调节约' }
];

const byId = new Map(INDICATORS.map(indicator => [indicator.id, indicator]));

/** 按编码取指标；目录缺项属于内部配置错误，在创建数据时暴露，调用方不要在 computed 里用 */
export function requireIndicator(id: string): Indicator {
  const indicator = byId.get(id);
  if (!indicator) {
    throw new Error(`指标目录缺少 ${id}`);
  }
  return indicator;
}
