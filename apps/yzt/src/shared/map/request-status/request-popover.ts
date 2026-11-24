import type { ViewportBox } from '../layer-panel/popover-placement';

// "数据加载"浮层的位置（ADR 0158，用户 2026-11-16、2026-11-23）：底边都在状态栏上方；资源图层面板下面放得下时在面板下方、
// 和面板左对齐，否则贴着面板的右边；不跟着状态栏里的条目走。都是视口坐标，纯函数

/** 浮层的宽度：和资源图层面板展开时同宽（LayerPanelShell.module.scss 的 .panel），面板收起成竖条时用它 */
export const REQUEST_POPOVER_WIDTH = 320;
/** 浮层的最大高度 */
export const REQUEST_POPOVER_MAX_HEIGHT = 420;
/** 离面板、离状态栏的距离 */
export const REQUEST_POPOVER_GAP = 8;

export interface RequestPopoverInput {
  /** 资源图层面板（按内容定高；收起后是竖条）；量不到时贴着区域的左边 */
  readonly panel: ViewportBox | null;
  /** 面板收起成了竖条：浮层用面板展开时的宽度 */
  readonly collapsed: boolean;
  /** 浮层能放的区域：地图上四周留白以内，浮层不超出它的左右和上边 */
  readonly area: ViewportBox;
  /** 状态栏的上边：浮层的底边在它上面 */
  readonly barTop: number;
  readonly viewport: { readonly height: number };
}

export interface RequestPopoverPlacement {
  /** below：面板下方，和面板左对齐；beside：面板右边 */
  readonly side: 'below' | 'beside';
  readonly left: number;
  /** 底边离视口底边的距离：浮层按内容向上长，底边不动 */
  readonly bottom: number;
  readonly width: number;
  /** 超出时列表滚动 */
  readonly maxHeight: number;
}

/**
 * 浮层的位置：宽度同资源图层面板，区域比它窄时和区域同宽；底边离状态栏 8，最高 420，区域上边放不下时变矮。
 * 面板下面到状态栏上方放得下最高的浮层（离面板也是 8）时在面板下方、和面板左对齐（用户 2026-11-23：贴着状态栏，
 * 不紧挨面板）；放不下时左边离面板右边 8，右边放不下（手机宽度展开着面板）时向左移、盖住面板。按最高的浮层判断，
 * 内容多了少了不会换位置
 */
export function requestPopoverPlacement(input: RequestPopoverInput): RequestPopoverPlacement {
  const { panel, collapsed, area, barTop, viewport } = input;
  const panelWidth = panel === null || collapsed ? REQUEST_POPOVER_WIDTH : panel.right - panel.left;
  const width = Math.max(0, Math.min(panelWidth, area.right - area.left));
  const bottomEdge = barTop - REQUEST_POPOVER_GAP;
  const below = panel !== null && bottomEdge - (panel.bottom + REQUEST_POPOVER_GAP) >= REQUEST_POPOVER_MAX_HEIGHT;
  let wanted = area.left;
  if (panel !== null) {
    wanted = below ? panel.left : panel.right + REQUEST_POPOVER_GAP;
  }
  return {
    side: below ? 'below' : 'beside',
    left: Math.max(area.left, Math.min(wanted, area.right - width)),
    bottom: viewport.height - bottomEdge,
    width,
    maxHeight: Math.max(0, Math.min(REQUEST_POPOVER_MAX_HEIGHT, bottomEdge - area.top))
  };
}
