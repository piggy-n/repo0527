/** 地图提示短暂停留后显示，移出立即关闭，避免关闭延迟与淡出动画造成重影 */
export const MAP_TOOLTIP_PROPS = {
  showAfter: 200,
  hideAfter: 0,
  enterable: false,
  persistent: false,
  transition: 'none'
} as const;
