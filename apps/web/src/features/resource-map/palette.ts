// 地图样式里的颜色是数据，不走 CSS 令牌

/**
 * 默认配色板，按资源在目录里的顺序循环取（迁移自旧项目的 LAYER_COLOR_PALETTE）：
 * 浅色底图上都压得住，环形相邻的色相至少差 109°，相邻资源不会撞色
 */
export const RESOURCE_PALETTE: readonly string[] = [
  '#D9433F',
  '#16B3B3',
  '#C74F9B',
  '#77A82E',
  '#B03A6B',
  '#2278BE',
  '#C79212',
  '#7A4FC0',
  '#E07B39',
  '#2FA663'
];

export function paletteColor(index: number): string {
  return RESOURCE_PALETTE[index % RESOURCE_PALETTE.length];
}
