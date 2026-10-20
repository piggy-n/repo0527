/** 右侧上下两块面板 */
export type StackedPanel = 'functions' | 'detail';

export interface PanelStackInput {
  readonly height: number;
  readonly functionsOpen: boolean;
  readonly detailOpen: boolean;
  readonly preferred: StackedPanel;
  readonly collapsed: Readonly<Record<StackedPanel, boolean>>;
}

/** 根据可用高度收起非当前面板；隐藏内容不等于关闭功能 */
export function panelStackLayout(input: PanelStackInput) {
  const { height, functionsOpen, detailOpen, preferred } = input;
  const collapsed = { ...input.collapsed };
  const both = functionsOpen && detailOpen;
  // 上方保留约 200、详情保留约 288，低于此高度改为一块内容加另一块标题
  if (both && height > 0 && height < 500 && !collapsed.functions && !collapsed.detail) {
    collapsed[preferred === 'functions' ? 'detail' : 'functions'] = true;
  }
  let functionsMaxHeight: number | undefined;
  if (height > 0) {
    functionsMaxHeight = height;
    if (both) {
      functionsMaxHeight = collapsed.detail ? Math.max(48, height - 48 - 12) : height * 0.4;
    }
  }
  if (collapsed.functions) {
    functionsMaxHeight = 48;
  }
  return { collapsed, functionsMaxHeight };
}

/** 底图浮层顶部以上留出 12 像素；只计算面板排布，不参与地图相机避让 */
export function panelStackHeight(height: number, top: number, popoverTop: number | null): number {
  return popoverTop === null ? height : Math.max(0, Math.min(height, popoverTop - top - 12));
}
