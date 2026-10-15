/** 一组 Tab 面板的界面状态（ADR 0053 第 4 节）：已打开的功能按 Tab 的固定顺序，当前显示的一个，最近显示过的排在前面 */
export interface PanelGroupState<Id extends string = string> {
  readonly open: readonly Id[];
  readonly current: Id | null;
  /** 和 open 是同一组功能，按最近显示的先后排列，关掉当前的时切到它的第一个 */
  readonly recent: readonly Id[];
}

export function emptyPanelGroup<Id extends string>(): PanelGroupState<Id> {
  return { open: [], current: null, recent: [] };
}

/** 打开并切到这个功能；已经在显示时原样返回 */
export function showPanel<Id extends string>(
  state: PanelGroupState<Id>,
  id: Id,
  order: readonly Id[]
): PanelGroupState<Id> {
  if (state.current === id) {
    return state;
  }
  const open = state.open.includes(id) ? state.open : order.filter(item => item === id || state.open.includes(item));
  return { open, current: id, recent: [id, ...state.recent.filter(item => item !== id)] };
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

/** 入口的点击：没打开时打开并切到它，打开了但没在显示时切到它，正在显示时关闭 */
export function togglePanel<Id extends string>(
  state: PanelGroupState<Id>,
  id: Id,
  order: readonly Id[]
): PanelGroupState<Id> {
  return state.current === id ? closePanel(state, id) : showPanel(state, id, order);
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
