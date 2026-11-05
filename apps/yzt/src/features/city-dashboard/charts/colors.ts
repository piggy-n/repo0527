import { CATEGORIES, DASHBOARD_YEARS } from '../catalog';

// 海蓝、青碧、紫藤三组，每组 6 色对应开放的 6 年、从新到旧，柱图和折线共用（选色依据见 docs/modules/city-dashboard.md）
const PALETTES: readonly (readonly string[])[] = [
  ['#1849A9', '#3288F5', '#007397', '#855AD2', '#743A71', '#249374'],
  ['#006C4A', '#0B99A3', '#7A9600', '#00628C', '#8A7318', '#3A8FD0'],
  ['#7236B4', '#9E78E2', '#A8359A', '#4369D5', '#77356C', '#B76AAF']
];
export const AVERAGE_COLOR = '#D94262';

// 卡片在所属分类里的序号：列表连续，同屏相邻的三张一定取到不同的组
const CARD_INDEX: ReadonlyMap<string, number> = new Map(
  CATEGORIES.flatMap(({ indicators }) => indicators.map(({ id }, index) => [id, index] as const))
);

/** 颜色只由指标和年份决定：详情、提示和导出与卡片同色，不随比较集合的顺序和数量变化 */
export function yearColor(year: number, indicatorId: string): string {
  const palette = PALETTES[(CARD_INDEX.get(indicatorId) ?? 0) % PALETTES.length];
  const slot = DASHBOARD_YEARS[0] - year;
  return palette[(slot % palette.length + palette.length) % palette.length];
}
