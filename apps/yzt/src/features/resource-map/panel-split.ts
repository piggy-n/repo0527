/** 目录和"已选择图层"两区的高度 */
export interface ListSplit {
  readonly tree: number;
  readonly checked: number;
  /** 拖动分割线能不能改变两区：都放得下、或目录已经全部显示且不能再矮时不能 */
  readonly adjustable: boolean;
}

export interface ListSplitInput {
  /** 两区最多能用的高度：面板所在列的高度减去头部、搜索行和分割线，和内容无关 */
  readonly available: number;
  /** 目录的内容本来的高度 */
  readonly tree: number;
  /** "已选择图层"的内容本来的高度（标题、列表和下边距） */
  readonly checked: number;
  /** 分割线的位置："已选择图层"占可用高度的比例（0～1） */
  readonly ratio: number;
  /** 收起时只保留展开入口，目录可以使用其余高度 */
  readonly collapsed?: boolean;
}

// 放不下时两边的最小高度：目录至少 3 行，"已选择图层"至少放得下标题和 2 行
const MIN_TREE_HEIGHT = 3 * 32;
const MIN_CHECKED_HEIGHT = 40 + 2 * 36;

// 可用高度放不下两边的最小高度时只按比例，两边都可以到 0
const tooShort = (available: number) => available < MIN_TREE_HEIGHT + MIN_CHECKED_HEIGHT;

/**
 * 两区的高度（ADR 0060）：都放得下时按内容，面板跟着变矮、没有滚动条；放不下时"已选择图层"的高度由分割线决定，
 * 限制在两边的最小高度以内，内容不够时下面留白，分割线照常能拖；目录的内容用不了分到的高度时（比如收起了），
 * 多出的给"已选择图层"，目录全部显示。
 * 输入都和算出的高度无关：面板的高度不再反过来影响分法，不会来回重算（2026-10-16 用户发现收起目录后一直闪）
 */
export function splitLists({ available, tree, checked, ratio, collapsed = false }: ListSplitInput): ListSplit {
  if (collapsed) {
    return { tree: Math.min(tree, Math.max(0, available - checked)), checked, adjustable: false };
  }
  if (tree + checked <= available) {
    return { tree, checked, adjustable: false };
  }
  const wanted = tooShort(available)
    ? available * ratio
    : Math.min(available - MIN_TREE_HEIGHT, Math.max(MIN_CHECKED_HEIGHT, available * ratio));
  // 目录全部显示时，往下拖不动；目录比最小高度高时还能往上拖，让目录滚动、"已选择图层"变高
  const adjustable = tree > (tooShort(available) ? 0 : MIN_TREE_HEIGHT);
  if (tree < available - wanted) {
    return { tree, checked: available - tree, adjustable };
  }
  return { tree: available - wanted, checked: wanted, adjustable: true };
}

/** 拖动分割线时想要的"已选择图层"高度换成比例：先按两边的最小高度限制；还量不到可用高度时为 null */
export function ratioForCheckedHeight(available: number, height: number): number | null {
  if (available <= 0) {
    return null;
  }
  const limited = tooShort(available)
    ? height
    : Math.min(available - MIN_TREE_HEIGHT, Math.max(MIN_CHECKED_HEIGHT, height));
  return Math.min(1, Math.max(0, limited / available));
}
