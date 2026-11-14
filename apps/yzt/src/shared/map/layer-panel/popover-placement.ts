// 当前图层浮层的位置（ADR 0157）：在面板右边，箭头对着选中的行；都是视口坐标，纯函数

/** 视口里的一个矩形 */
export interface ViewportBox {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

export interface PopoverPlacementInput {
  /** 资源图层面板：浮层贴在它右边 */
  readonly panel: ViewportBox;
  /** 选中的行；所在的组收起时是组的标题 */
  readonly anchor: ViewportBox;
  /** 当前图层的滚动区：行滚出去时箭头停在它的边上 */
  readonly list: ViewportBox;
  readonly viewport: { readonly width: number; readonly height: number };
  /** 浮层内容本来的高度 */
  readonly height: number;
}

export interface PopoverPlacement {
  readonly left: number;
  readonly top: number;
  /** 浮层的最大高度，超出时内容滚动 */
  readonly maxHeight: number;
  /** 箭头中心到浮层顶边的距离 */
  readonly arrowTop: number;
}

/** 浮层离面板右边的距离 */
export const POPOVER_GAP = 10;
// 离视口上下边至少留的距离，最高不超过这么多
const MARGIN = 16;
const MAX_HEIGHT = 560;
// 箭头平时离浮层顶边的距离（对着标题行），离上下边至少这么多（不出圆角）
const ARROW_DEFAULT = 22;
const ARROW_EDGE = 14;
// 行滚出滚动区时，箭头离滚动区边上的距离
const LIST_INSET = 10;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

/**
 * 浮层的位置：左边离面板右边 10；箭头平时对着标题行，整体上移让箭头对准选中行的中线，放不下时贴着视口的上下边、箭头跟着行走；
 * 行滚出当前图层的滚动区时，箭头停在滚动区边上
 */
export function layerPopoverPlacement(input: PopoverPlacementInput): PopoverPlacement {
  const { panel, anchor, list, viewport, height } = input;
  const maxHeight = Math.max(0, Math.min(MAX_HEIGHT, viewport.height - 2 * MARGIN));
  const shown = Math.min(height, maxHeight);
  const center = clamp((anchor.top + anchor.bottom) / 2, list.top + LIST_INSET, list.bottom - LIST_INSET);
  const top = clamp(center - ARROW_DEFAULT, MARGIN, viewport.height - MARGIN - shown);
  return {
    left: panel.right + POPOVER_GAP,
    top,
    maxHeight,
    arrowTop: clamp(center - top, ARROW_EDGE, shown - ARROW_EDGE)
  };
}
