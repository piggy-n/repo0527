// 当前图层列表的纯函数（ADR 0157）：工具栏的移动、移出后选中哪一行、上下方向键跨组换行

/** 工具栏、右键菜单里的移动 */
export type MoveAction = 'move-up' | 'move-down' | 'move-top' | 'move-bottom';

/** 在本组里移动到的位置；已经到头、不在组里时为 null */
export function moveIndex(keys: readonly string[], key: string, action: MoveAction): number | null {
  const index = keys.indexOf(key);
  if (index === -1) {
    return null;
  }
  const to = { 'move-up': index - 1, 'move-down': index + 1, 'move-top': 0, 'move-bottom': keys.length - 1 }[action];
  return to < 0 || to >= keys.length || to === index ? null : to;
}

/**
 * 移出一些行以后选中哪一行（用户 2026-11-13：选中相邻的）：选中的没被移出时不变；被移出时选中原来在它后面的第一行，
 * 后面没有了选前面的；都移出了为 null。keys 是移出前全部的行，各组按显示的先后接在一起
 */
export function selectionAfterRemoval(
  keys: readonly string[],
  removed: ReadonlySet<string>,
  selected: string | null
): string | null {
  if (selected === null || !removed.has(selected)) {
    return selected;
  }
  const index = keys.indexOf(selected);
  const after = keys.slice(index + 1).find(key => !removed.has(key));
  return after ?? keys.slice(0, Math.max(0, index)).findLast(key => !removed.has(key)) ?? null;
}

/** 上下方向键换到的行：各组按显示的先后接在一起，到头时不动 */
export function steppedKey(keys: readonly string[], key: string, delta: number): string {
  const index = keys.indexOf(key);
  return keys[Math.min(keys.length - 1, Math.max(0, index + delta))] ?? key;
}
