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

/**
 * 取色器的预设色（2026-10-16 用户要求，参考旧项目 SymbolColorPicker 的快捷色）：两行各 10 个，正好排满 Element 的预设区。
 * 列按色相从红到玫红，最后一列是黑白；上行是旧项目的快捷色，下行是同一列和白色 1 : 1 混合的浅色，适合面的填充
 */
export const COLOR_PRESETS: readonly string[] = [
  '#D9433F', '#E07B39', '#C79212', '#77A82E', '#2FA663', '#16B3B3', '#2278BE', '#7A4FC0', '#B03A6B', '#000000',
  '#ECA19F', '#F0BD9C', '#E3C989', '#BBD497', '#97D3B1', '#8BD9D9', '#91BCDF', '#BDA7E0', '#D89DB5', '#FFFFFF'
];

export function paletteColor(index: number): string {
  return RESOURCE_PALETTE[index % RESOURCE_PALETTE.length];
}
