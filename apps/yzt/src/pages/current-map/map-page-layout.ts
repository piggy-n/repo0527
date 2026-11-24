/** 地图区域窄于它时按手机宽度限制面板和区划条 */
export const PHONE_WIDTH = 768;

// 业务组的一个按钮 32 高，组和组之间一条 9 高的分隔线；其余留给基础组、底图卡和边缘留白
const TOOLBAR_BUTTON_HEIGHT = 32;
const TOOLBAR_SEPARATOR_HEIGHT = 9;
const RESERVED_HEIGHT = 368;

/** 现状底图页随地图区域尺寸变化的排法 */
export interface MapPageLayout {
  /** 手机宽度 */
  readonly phone: boolean;
  /** 业务组始终只显示图标，矮屏时分成两列 */
  readonly toolbarColumns: boolean;
}

// 业务组排成一列要多高的地图区域：现状底图 6 组 10 个按钮是 733（ADR 0174），三维原型少了打印是 692
function singleColumnHeight(toolbarGroups: readonly (readonly string[])[]): number {
  const buttons = toolbarGroups.reduce((sum, group) => sum + group.length, 0);
  const separators = Math.max(toolbarGroups.length - 1, 0);
  return RESERVED_HEIGHT + buttons * TOOLBAR_BUTTON_HEIGHT + separators * TOOLBAR_SEPARATOR_HEIGHT;
}

/** 按地图区域的尺寸和页面业务组的按钮决定排法；还量不到尺寸（为 0，测试环境没有布局）时按常规 */
export function mapPageLayout(
  width: number,
  height: number,
  toolbarGroups: readonly (readonly string[])[]
): MapPageLayout {
  const phone = width > 0 && width < PHONE_WIDTH;
  return { phone, toolbarColumns: height > 0 && height < singleColumnHeight(toolbarGroups) };
}
