import { paletteColor } from '@/shared/dashboard/charts/palette';
import { CATEGORIES, DASHBOARD_YEARS } from '../catalog';

// 卡片在所属分类里的序号：列表连续，同屏相邻的三张一定取到不同的组
const CARD_INDEX: ReadonlyMap<string, number> = new Map(
  CATEGORIES.flatMap(({ indicators }) => indicators.map(({ id }, index) => [id, index] as const))
);

/** 颜色只由指标和年份决定：详情、提示和导出与卡片同色，不随比较集合的顺序和数量变化 */
export function yearColor(year: number, indicatorId: string): string {
  return paletteColor(year, CARD_INDEX.get(indicatorId) ?? 0, DASHBOARD_YEARS[0]);
}
