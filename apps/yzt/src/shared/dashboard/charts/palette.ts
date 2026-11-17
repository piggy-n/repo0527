// 海蓝、青碧、紫藤三组，每组 6 色对应 6 个年份、从新到旧，柱图和折线共用（选色依据见 docs/modules/city-dashboard.md）
const PALETTES: readonly (readonly string[])[] = [
  ['#1849A9', '#3288F5', '#007397', '#855AD2', '#743A71', '#249374'],
  ['#006C4A', '#0B99A3', '#7A9600', '#00628C', '#8A7318', '#3A8FD0'],
  ['#7236B4', '#9E78E2', '#A8359A', '#4369D5', '#77356C', '#B76AAF']
];
export const AVERAGE_COLOR = '#D94262';

/** 第 group 组里 year 的颜色：latestYear 取第一色，往前每年取下一色，6 年一循环 */
export function paletteColor(year: number, group: number, latestYear: number): string {
  const palette = PALETTES[group % PALETTES.length];
  const slot = latestYear - year;
  return palette[(slot % palette.length + palette.length) % palette.length];
}
