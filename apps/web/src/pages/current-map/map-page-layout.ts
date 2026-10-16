/** 地图区域窄于它时是手机宽度：图例卡、底图卡叠到工具栏一列（ADR 0053 第 8 节，设计稿 5D.8） */
export const PHONE_WIDTH = 768;

// 带文字的业务组（约 380）和基础组（约 209）上下都放得下的地图区域高度，加上三处 16 的间距（ADR 0053 第 8 节）
const FULL_TOOLBAR_HEIGHT = 640;
// 手机宽度时两张卡片叠在基础组上面：12 + 56 + 8 + 56
const CARD_STACK_HEIGHT = 132;

/** 现状底图页随地图区域尺寸变化的排法 */
export interface MapPageLayout {
  /** 手机宽度 */
  readonly phone: boolean;
  /** 业务组只显示图标：矮屏，或手机宽度时加上卡片放不下 */
  readonly compactToolbar: boolean;
}

/** 按地图区域的尺寸决定排法；还量不到尺寸（为 0，测试环境没有布局）时按常规 */
export function mapPageLayout(width: number, height: number): MapPageLayout {
  const phone = width > 0 && width < PHONE_WIDTH;
  const needed = FULL_TOOLBAR_HEIGHT + (phone ? CARD_STACK_HEIGHT : 0);
  return { phone, compactToolbar: height > 0 && height < needed };
}
