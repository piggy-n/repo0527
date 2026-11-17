import { paletteColor } from '@/shared/dashboard/charts/palette';
import type { ChartType } from '@/shared/dashboard/model';
import { LAND_SPACE_YEAR } from './data/land-space-data';

/** 右栏固定的三张卡：一级、二级、三级（含分项） */
export type LandSpaceCardId = 'domain' | 'sub' | 'indicator';

/** 从上到下的顺序 */
export const LAND_SPACE_CARDS: readonly LandSpaceCardId[] = ['domain', 'sub', 'indicator'];

/** 每张卡能切换的图表类型；二级多一个雷达 */
export const CARD_CHART_TYPES: Readonly<Record<LandSpaceCardId, readonly ChartType[]>> = {
  domain: ['bar', 'line'],
  sub: ['bar', 'line', 'radar'],
  indicator: ['bar', 'line']
};

// 三张卡各用一组配色，同一张卡的图表、详情、提示同色
const PALETTE_GROUPS: Readonly<Record<LandSpaceCardId, number>> = { domain: 0, sub: 1, indicator: 2 };

/** 卡片里年份系列的颜色；只有 2025 一年，取各组的第一色 */
export function cardColor(card: LandSpaceCardId): (year: number) => string {
  return year => paletteColor(year, PALETTE_GROUPS[card], LAND_SPACE_YEAR);
}
