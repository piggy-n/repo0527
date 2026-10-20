/** 一组 Tab 面板的界面状态：入口唤起的功能前置，直接切换 Tab 保持顺序（ADR 0066） */
export interface PanelGroupState<Id extends string = string> {
  readonly open: readonly Id[];
  readonly current: Id | null;
  /** 和 open 是同一组功能，按最近显示的先后排列，关掉当前的时切到它的第一个 */
  readonly recent: readonly Id[];
}

export function emptyPanelGroup<Id extends string>(): PanelGroupState<Id> {
  return { open: [], current: null, recent: [] };
}

/** 打开并前置这个功能；已经在最前显示时原样返回 */
export function showPanel<Id extends string>(
  state: PanelGroupState<Id>,
  id: Id,
  order: readonly Id[]
): PanelGroupState<Id> {
  if (state.current === id && state.open[0] === id) {
    return state;
  }
  const open = [id, ...state.open.filter(item => item !== id && order.includes(item))];
  return { open, current: id, recent: [id, ...state.recent.filter(item => item !== id)] };
}

/** 点击已打开的 Tab 只切换内容，不移动标签和关闭按钮的位置 */
export function selectPanel<Id extends string>(state: PanelGroupState<Id>, id: Id): PanelGroupState<Id> {
  if (!state.open.includes(id) || state.current === id) {
    return state;
  }
  return { ...state, current: id, recent: [id, ...state.recent.filter(item => item !== id)] };
}

/** 关闭这个功能；关的是当前的时切到最近显示过的另一个，都关了时没有当前；没打开时原样返回 */
export function closePanel<Id extends string>(state: PanelGroupState<Id>, id: Id): PanelGroupState<Id> {
  if (!state.open.includes(id)) {
    return state;
  }
  const recent = state.recent.filter(item => item !== id);
  return {
    open: state.open.filter(item => item !== id),
    current: state.current === id ? (recent[0] ?? null) : state.current,
    recent
  };
}

/**
 * 入口的点击：按实际的显示决定。没打开、打开了但没在显示、整组被隐藏（窄屏时让给了另一边）时打开并切到它，
 * 正在显示时才关闭（2026-10-16 评审发现：只看当前的 Tab 时，让出去的面板被误关，输入丢失）
 */
export function togglePanel<Id extends string>(
  state: PanelGroupState<Id>,
  id: Id,
  order: readonly Id[],
  groupShown: boolean
): PanelGroupState<Id> {
  return groupShown && state.current === id ? closePanel(state, id) : showPanel(state, id, order);
}

/** 一段横向的范围（屏幕坐标） */
export interface HorizontalSpan {
  readonly left: number;
  readonly right: number;
}

/**
 * 横向滚动的 Tab 区要滚到哪里，让这个 Tab 完整可见：已经可见时不动，超出左边时贴左边，超出右边时贴右边；
 * 比可见范围还宽时贴左边，名称在前面
 */
export function revealScrollLeft(scrollLeft: number, view: HorizontalSpan, item: HorizontalSpan): number {
  if (item.left < view.left || item.right - item.left > view.right - view.left) {
    return scrollLeft - (view.left - item.left);
  }
  if (item.right > view.right) {
    return scrollLeft + (item.right - view.right);
  }
  return scrollLeft;
}

export type MapSide = 'left' | 'right';

export interface SideInput {
  /** 画布小于全应用的窄屏断点 */
  readonly narrow: boolean;
  /** 左边的资源面板按自己的状态是展开的 */
  readonly leftExpanded: boolean;
  /** 右边有打开着的面板 */
  readonly rightOpen: boolean;
  /** 最后操作的一边 */
  readonly lastSide: MapSide;
}

/** 窄屏时左右只显示一边（ADR 0053 第 8 节）：两边都有东西要显示时，最后操作的一边显示；只推导显示，不改各自的状态 */
export function visibleSides({ narrow, leftExpanded, rightOpen, lastSide }: SideInput): Record<MapSide, boolean> {
  const conflict = narrow && leftExpanded && rightOpen;
  return {
    left: leftExpanded && !(conflict && lastSide === 'right'),
    right: rightOpen && !(conflict && lastSide === 'left')
  };
}
