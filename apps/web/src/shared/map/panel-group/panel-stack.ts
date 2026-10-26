/** 右侧上下两块面板 */
export type StackedPanel = 'functions' | 'detail';

export interface PanelStackInput {
  readonly height: number;
  readonly functionsOpen: boolean;
  readonly detailOpen: boolean;
  readonly preferred: StackedPanel;
  readonly collapsed: Readonly<Record<StackedPanel, boolean>>;
}

export interface PanelStackLayout {
  /** 用户收起的，加上空间不足时收起的非当前面板 */
  readonly collapsed: Readonly<Record<StackedPanel, boolean>>;
  /** 功能面板的最大高度；还量不到可用高度时不限制 */
  readonly functionsMaxHeight: number | undefined;
}

// 收起后只剩标题行的高度，两块面板之间的间隔
const HEADER_HEIGHT = 48;
const STACK_GAP = 12;
// 上方保留约 200、详情保留约 288，低于此高度改为一块内容加另一块标题
const MIN_STACK_HEIGHT = 500;
// 两块都展开时功能面板最多占的比例
const FUNCTIONS_SHARE = 0.4;

/** 根据可用高度收起非当前面板；隐藏内容不等于关闭功能 */
export function panelStackLayout(input: PanelStackInput): PanelStackLayout {
  const { height, functionsOpen, detailOpen, preferred } = input;
  const collapsed = { ...input.collapsed };
  const both = functionsOpen && detailOpen;
  if (both && height > 0 && height < MIN_STACK_HEIGHT && !collapsed.functions && !collapsed.detail) {
    collapsed[preferred === 'functions' ? 'detail' : 'functions'] = true;
  }
  let functionsMaxHeight: number | undefined;
  if (height > 0) {
    functionsMaxHeight = height;
    if (both) {
      functionsMaxHeight = collapsed.detail
        ? Math.max(HEADER_HEIGHT, height - HEADER_HEIGHT - STACK_GAP)
        : height * FUNCTIONS_SHARE;
    }
  }
  if (collapsed.functions) {
    functionsMaxHeight = HEADER_HEIGHT;
  }
  return { collapsed, functionsMaxHeight };
}

// 底图浮层顶部以上留出的间隔
const POPOVER_GAP = 12;

/** 底图浮层顶部以上留出 12 像素；只计算面板排布，不参与地图相机避让 */
export function panelStackHeight(height: number, top: number, popoverTop: number | null): number {
  return popoverTop === null ? height : Math.max(0, Math.min(height, popoverTop - top - POPOVER_GAP));
}
