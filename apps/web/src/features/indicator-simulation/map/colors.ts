// 地图上的颜色是按数据画的，MapLibre 读不到 CSS 变量，用常量；取值来自确认的原型，和令牌同色系

/** 数值五档：浅蓝到深蓝（主色系） */
export const VALUE_COLORS = ['#dfe8ff', '#b4c8ff', '#7f9ff6', '#4f72e3', '#2c4bb5'] as const;
/** 计算中还没扫到的区县 */
export const PENDING_COLOR = '#c8d2e2';
/** 人口密度的底色（紫色系，取自原型） */
export const DENSITY_COLOR = '#9d8cff';
/** 设施与它的服务圈 */
export const FACILITY_COLOR = '#1f7a58';
export const FACILITY_RING_COLOR = '#2f9e74';
/** 推演范围以外的遮罩（--color-bg-page） */
export const MASK_COLOR = '#f3f5f9';
/** 区县之间的分隔线 */
export const DISTRICT_LINE_COLOR = '#ffffff';
/** 悬停的市的边界（--color-text-strong） */
export const HIGHLIGHT_COLOR = '#2f3a4f';

/** 按断点取数值的颜色：小于第一个断点是第一档 */
export function valueColor(value: number, breaks: readonly number[]): string {
  const index = breaks.findIndex(edge => value < edge);
  return VALUE_COLORS[index === -1 ? VALUE_COLORS.length - 1 : index] ?? VALUE_COLORS[0];
}
