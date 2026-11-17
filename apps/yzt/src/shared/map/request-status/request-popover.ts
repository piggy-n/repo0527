import type { ViewportBox } from '../layer-panel/popover-placement';

// "数据加载"浮层的位置（ADR 0158，用户 2026-11-16）：贴着资源图层面板的右边，底边在状态栏上方，不跟着状态栏里的条目走；
// 都是视口坐标，纯函数

/** 浮层的宽度、最大高度 */
export const REQUEST_POPOVER_WIDTH = 340;
export const REQUEST_POPOVER_MAX_HEIGHT = 420;
/** 离面板右边、离状态栏的距离 */
export const REQUEST_POPOVER_GAP = 8;

export interface RequestPopoverInput {
  /** 资源图层面板所在的一列（展开的面板或收起后的竖条）；量不到时贴着区域的左边 */
  readonly panel: ViewportBox | null;
  /** 浮层能放的区域：地图上四周留白以内，浮层不超出它的左右和上边 */
  readonly area: ViewportBox;
  /** 状态栏的上边：浮层的底边在它上面 */
  readonly barTop: number;
  readonly viewport: { readonly height: number };
}

export interface RequestPopoverPlacement {
  readonly left: number;
  /** 底边离视口底边的距离：浮层按内容长高，底边不动 */
  readonly bottom: number;
  readonly width: number;
  /** 超出时列表滚动 */
  readonly maxHeight: number;
}

/**
 * 浮层的位置：左边离面板右边 8，面板宽度变了、收起成竖条时跟着走；右边放不下（手机宽度展开着面板）时向左移、盖住面板，
 * 区域比浮层还窄时和区域同宽。底边离状态栏的上边 8，最高 420，区域上边放不下时变矮
 */
export function requestPopoverPlacement(input: RequestPopoverInput): RequestPopoverPlacement {
  const { panel, area, barTop, viewport } = input;
  const width = Math.max(0, Math.min(REQUEST_POPOVER_WIDTH, area.right - area.left));
  const beside = panel === null ? area.left : panel.right + REQUEST_POPOVER_GAP;
  const left = Math.max(area.left, Math.min(beside, area.right - width));
  const bottomEdge = barTop - REQUEST_POPOVER_GAP;
  return {
    left,
    bottom: viewport.height - bottomEdge,
    width,
    maxHeight: Math.max(0, Math.min(REQUEST_POPOVER_MAX_HEIGHT, bottomEdge - area.top))
  };
}
