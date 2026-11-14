// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  type CatalogSelection,
  EMPTY_CATALOG_SELECTION,
  focusKey,
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
