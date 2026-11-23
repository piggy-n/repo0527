// 资源目录的多选（ADR 0157；2026-11-22 起只用于批量，单击是添加、移除）：选中哪些节点、连选的起点、键盘焦点，
// 都是纯函数；节点用字符串键，和业务无关

/** 目录的选中状态 */
export interface CatalogSelection {
  /** 选中的节点 */
  readonly keys: ReadonlySet<string>;
  /** Shift 连选的起点：最后一次单击、加选，或方向键移到的项 */
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

/** 方向键移到项上：焦点和连选的起点都移过来，选中不变（之后的 Shift 加方向键从这一项连选）；已经是这样时返回原来的对象 */
export function movedTo(selection: CatalogSelection, key: string): CatalogSelection {
  return selection.focus === key && selection.anchor === key ? selection : { ...selection, anchor: key, focus: key };
}

/** 单击切换了 key 以后：不再有选中，起点和焦点移到 key（之后的 Shift 连选从它开始）；已经是这样时返回原来的对象 */
export function clearedAt(selection: CatalogSelection, key: string): CatalogSelection {
  if (selection.keys.size === 0 && selection.anchor === key && selection.focus === key) {
    return selection;
  }
  return { keys: new Set(), anchor: key, focus: key };
}

/** 清空选中（Esc），起点和焦点不变；本来就没有选中时返回原来的对象 */
export function clearedSelection(selection: CatalogSelection): CatalogSelection {
  return selection.keys.size === 0 ? selection : { ...selection, keys: new Set() };
}

/** 选中这么多项才算多选：标题的批量添加、移除只在多选时出现（用户 2026-11-22） */
export const BATCH_MIN = 2;

/** 是不是多选 */
export function isBatch(selection: CatalogSelection): boolean {
  return selection.keys.size >= BATCH_MIN;
}

/** 右键菜单、Insert、Delete 作用的节点：key 在多选里时是整个选中，否则只是它 */
export function actionTargets(selection: CatalogSelection, key: string): ReadonlySet<string> {
  return isBatch(selection) && selection.keys.has(key) ? selection.keys : new Set([key]);
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
