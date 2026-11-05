import { type Indicator, requireIndicator } from './catalog';
import { createProfileValue } from './indicator-profiles';

// 合计类指标等于分项之和
const aggregateParts: Readonly<Record<string, readonly string[]>> = {
  'A-16': ['D02-3-1', 'D02-3-2'],
  'G01-6': ['G01-6-1', 'G01-6-2']
};

/**
 * 某市、某年、某指标的固定模拟值：同样的输入永远得到同样的数，跨自然年不漂移。
 * 保留建筑合计与分项、生活圈并集与交集的约束；不代表真实统计
 */
export function mockIndicatorValue(cityCode: string, indicator: Indicator, year: number): number {
  const parts = aggregateParts[indicator.id];
  if (parts) {
    return parts.reduce((sum, id) => sum + createProfileValue(cityCode, requireIndicator(id), year), 0);
  }
  const value = createProfileValue(cityCode, indicator, year);
  if (indicator.id === 'A09-2') {
    return Math.max(value, createProfileValue(cityCode, requireIndicator('A-30'), year));
  }
  return value;
}
