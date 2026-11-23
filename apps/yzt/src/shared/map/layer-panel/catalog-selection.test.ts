// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  actionTargets,
  type CatalogSelection,
  clearedAt,
  clearedSelection,
  EMPTY_CATALOG_SELECTION,
  focusKey,
  isBatch,
  movedTo,
  prunedSelection,
  rovingKey,
  selectKey
} from './catalog-selection';

const VISIBLE = ['a', 'b', 'c', 'd', 'e'];

const keysOf = (selection: CatalogSelection) => [...selection.keys];

describe('selectKey', () => {
  it('默认只选这一个，起点和焦点移到它', () => {
    const first = selectKey(EMPTY_CATALOG_SELECTION, 'b', VISIBLE);
    const second = selectKey(first, 'd', VISIBLE);

    expect(keysOf(second)).toStrictEqual(['d']);
    expect(second.anchor).toBe('d');
    expect(second.focus).toBe('d');
  });

  it('加选：没选的加上，选了的取消，其他的保留', () => {
    let selection = selectKey(EMPTY_CATALOG_SELECTION, 'a', VISIBLE);
    selection = selectKey(selection, 'c', VISIBLE, { toggle: true });
    expect(keysOf(selection)).toStrictEqual(['a', 'c']);

    selection = selectKey(selection, 'a', VISIBLE, { toggle: true });
    expect(keysOf(selection)).toStrictEqual(['c']);
    expect(selection.anchor).toBe('a');
  });

  it('连选：从起点到这一个，按显示的先后，两个方向都行；起点不变', () => {
    const start = selectKey(EMPTY_CATALOG_SELECTION, 'b', VISIBLE);

    const down = selectKey(start, 'd', VISIBLE, { range: true });
    expect(keysOf(down)).toStrictEqual(['b', 'c', 'd']);
    expect(down.anchor).toBe('b');
    expect(down.focus).toBe('d');

    const up = selectKey(down, 'a', VISIBLE, { range: true });
    expect(keysOf(up)).toStrictEqual(['a', 'b']);
  });

  it('连选时没有起点、起点不再显示：按单选', () => {
    expect(keysOf(selectKey(EMPTY_CATALOG_SELECTION, 'c', VISIBLE, { range: true }))).toStrictEqual(['c']);
    const hidden = selectKey(EMPTY_CATALOG_SELECTION, 'x', ['x', ...VISIBLE]);
    expect(keysOf(selectKey(hidden, 'c', VISIBLE, { range: true }))).toStrictEqual(['c']);
  });
});

describe('prunedSelection、focusKey、rovingKey', () => {
  it('只留还在的节点；都在时返回原来的对象', () => {
    let selection = selectKey(EMPTY_CATALOG_SELECTION, 'a', VISIBLE);
    selection = selectKey(selection, 'c', VISIBLE, { toggle: true });

    expect(prunedSelection(selection, new Set(VISIBLE))).toBe(selection);
    const pruned = prunedSelection(selection, new Set(['a', 'b']));
    expect(keysOf(pruned)).toStrictEqual(['a']);
    expect(pruned.anchor).toBeNull();
    expect(pruned.focus).toBeNull();
  });

  it('焦点只移动焦点；同一个时返回原来的对象', () => {
    const selection = selectKey(EMPTY_CATALOG_SELECTION, 'a', VISIBLE);

    expect(focusKey(selection, 'a')).toBe(selection);
    expect(focusKey(selection, 'c')).toStrictEqual({ keys: new Set(['a']), anchor: 'a', focus: 'c' });
  });

  it('能用 Tab 进入的是显示着的焦点，否则是第一个；没有节点时为 null', () => {
    expect(rovingKey(selectKey(EMPTY_CATALOG_SELECTION, 'c', VISIBLE), VISIBLE)).toBe('c');
    expect(rovingKey(selectKey(EMPTY_CATALOG_SELECTION, 'x', ['x']), VISIBLE)).toBe('a');
    expect(rovingKey(EMPTY_CATALOG_SELECTION, [])).toBeNull();
  });
});

describe('单击切换以后的选中（用户 2026-11-22：单击是添加、移除，选中只用于批量）', () => {
  const batch = selectKey(selectKey(EMPTY_CATALOG_SELECTION, 'b', VISIBLE), 'd', VISIBLE, { toggle: true });

  it('单击切换：清空选中，起点和焦点移到这一项；已经是这样时返回原来的对象', () => {
    const cleared = clearedAt(batch, 'c');
    expect(keysOf(cleared)).toStrictEqual([]);
    expect(cleared).toMatchObject({ anchor: 'c', focus: 'c' });
    expect(clearedAt(cleared, 'c')).toBe(cleared);
    expect(keysOf(selectKey(cleared, 'e', VISIBLE, { range: true }))).toStrictEqual(['c', 'd', 'e']);
  });

  it('方向键移到项上：焦点和起点移过来，选中不变；Esc 清空选中，起点和焦点不变', () => {
    const moved = movedTo(batch, 'a');
    expect(keysOf(moved)).toStrictEqual(['b', 'd']);
    expect(moved).toMatchObject({ anchor: 'a', focus: 'a' });
    expect(movedTo(moved, 'a')).toBe(moved);

    const escaped = clearedSelection(batch);
    expect(keysOf(escaped)).toStrictEqual([]);
    expect(escaped).toMatchObject({ anchor: 'd', focus: 'd' });
    expect(clearedSelection(escaped)).toBe(escaped);
  });

  it('两项以上才算多选；右键菜单、Insert、Delete 在多选里的项上作用于整个选中，否则只作用于这一项', () => {
    const single = selectKey(EMPTY_CATALOG_SELECTION, 'b', VISIBLE);
    expect(isBatch(single)).toBe(false);
    expect(isBatch(batch)).toBe(true);
    expect([...actionTargets(batch, 'b')]).toStrictEqual(['b', 'd']);
    expect([...actionTargets(batch, 'c')]).toStrictEqual(['c']);
    expect([...actionTargets(single, 'b')]).toStrictEqual(['b']);
  });
});
