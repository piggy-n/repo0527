// 资源目录的多选（ADR 0157）：选中哪些节点、连选的起点、键盘焦点，都是纯函数；节点用字符串键，和业务无关

/** 目录的选中状态 */
export interface CatalogSelection {
  /** 选中的节点 */
  readonly keys: ReadonlySet<string>;
  /** Shift 连选的起点：最后一次单选或加选的节点 */
  readonly anchor: string | null;
  /** 键盘焦点所在的节点（roving tabindex） */
  readonly focus: string | null;
}

export const EMPTY_CATALOG_SELECTION: CatalogSelection = Object.freeze({
  keys: new Set<string>(),
  anchor: null,
  focus: null
});

/** 一次点击怎样改选中 */
export interface SelectMode {
  /** 加选或取消这一个，其他的保留 */
  readonly toggle?: boolean;
  /** 从起点连选到这一个 */
  readonly range?: boolean;
}

/**
 * 点了 key 以后的选中状态：默认只选它；toggle 加选或取消；range 从起点连选到它（按 visible 的先后，起点不在 visible 里时按单选）。
 * 起点和焦点都移到 key（连选时起点不变）
 */
export function selectKey(
  selection: CatalogSelection,
  key: string,
  visible: readonly string[],
  { toggle = false, range = false }: SelectMode = {}
): CatalogSelection {
  if (range && selection.anchor !== null) {
    const from = visible.indexOf(selection.anchor);
    const to = visible.indexOf(key);
    if (from !== -1 && to !== -1) {
      return {
        keys: new Set(visible.slice(Math.min(from, to), Math.max(from, to) + 1)),
        anchor: selection.anchor,
        focus: key
      };
    }
  }
  if (toggle) {
    const keys = new Set(selection.keys);
    if (!keys.delete(key)) {
      keys.add(key);
    }
    return { keys, anchor: key, focus: key };
  }
  return { keys: new Set([key]), anchor: key, focus: key };
}

/** 只移动键盘焦点，选中不变 */
export function focusKey(selection: CatalogSelection, key: string): CatalogSelection {
  return selection.focus === key ? selection : { ...selection, focus: key };
}

/**
 * 只留还在目录里的节点（搜索、目录刷新后）：起点、焦点不在了时为 null；都在时返回原来的对象
 */
export function prunedSelection(selection: CatalogSelection, existing: ReadonlySet<string>): CatalogSelection {
  const keys = [...selection.keys].filter(key => existing.has(key));
  const anchor = selection.anchor !== null && existing.has(selection.anchor) ? selection.anchor : null;
  const focus = selection.focus !== null && existing.has(selection.focus) ? selection.focus : null;
  if (keys.length === selection.keys.size && anchor === selection.anchor && focus === selection.focus) {
    return selection;
  }
  return { keys: new Set(keys), anchor, focus };
}

/** 能用 Tab 进入的节点：焦点在显示着的节点上时是它，否则是第一个；没有节点时为 null */
export function rovingKey(selection: CatalogSelection, visible: readonly string[]): string | null {
  return selection.focus !== null && visible.includes(selection.focus) ? selection.focus : (visible[0] ?? null);
}
