/** 地图区域窄于它时按手机宽度限制面板和区划条 */
export const PHONE_WIDTH = 768;

// 单列业务组增加行政区后高 323、基础组 241、底图卡及间距 68，加上三处 16 的留白
const SINGLE_COLUMN_HEIGHT = 680;

/** 现状底图页随地图区域尺寸变化的排法 */
export interface MapPageLayout {
  /** 手机宽度 */
  readonly phone: boolean;
  /** 业务组始终只显示图标，矮屏时分成两列 */
  readonly toolbarColumns: boolean;
}

/** 按地图区域的尺寸决定排法；还量不到尺寸（为 0，测试环境没有布局）时按常规 */
export function mapPageLayout(width: number, height: number): MapPageLayout {
  const phone = width > 0 && width < PHONE_WIDTH;
  return { phone, toolbarColumns: height > 0 && height < SINGLE_COLUMN_HEIGHT };
}
