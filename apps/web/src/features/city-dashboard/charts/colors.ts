import type { ChartType } from '../model';

const barColors = [
  '#174B9A',
  '#3288F5',
  '#63C6EB',
  '#0F766E',
  '#AF70C1',
  '#C45F43',
  '#64748B',
  '#DB9435',
  '#7954B2',
  '#20A59B'
];
const lineColors = [
  '#7454C9',
  '#078F85',
  '#BD6240',
  '#B74B83',
  '#77732D',
  '#955738',
  '#477E65',
  '#A85CAF',
  '#766457',
  '#C18317'
];
export const AVERAGE_COLOR = '#D94262';

/** 年份颜色固定，不随比较集合的顺序和数量变化 */
export function yearColor(year: number, type: ChartType): string {
  const palette = type === 'line' ? lineColors : barColors;
  return palette[((year - 2024) % palette.length + palette.length) % palette.length];
}
