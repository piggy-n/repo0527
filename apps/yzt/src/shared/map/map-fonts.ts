/**
 * 地图文字的 text-font（ADR 0160）：样式不写 glyphs，MapLibre 按 text-font 的名字当 CSS 字体、用页面已经加载的普惠体在本地画，
 * 不下载任何字体或字形。字重从第一个名字猜：中粗写成"SemiBold"猜出 600，再带上实际的字体名，只写第一个会落到系统黑体（实测）
 */
export const MAP_FONT_STACKS = {
  regular: ['Alibaba PuHuiTi'],
  semibold: ['Alibaba PuHuiTi SemiBold', 'Alibaba PuHuiTi']
} as const satisfies Readonly<Record<string, readonly string[]>>;
