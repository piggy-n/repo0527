// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { moveIndex, selectionAfterRemoval, steppedKey } from './current-list';

const KEYS = ['a', 'b', 'c', 'd'];

describe('moveIndex', () => {
  it('上移、下移一位，置顶、置底；到头、不在组里时为 null', () => {
    expect(moveIndex(KEYS, 'b', 'move-up')).toBe(0);
    expect(moveIndex(KEYS, 'b', 'move-down')).toBe(2);
    expect(moveIndex(KEYS, 'c', 'move-top')).toBe(0);
    expect(moveIndex(KEYS, 'b', 'move-bottom')).toBe(3);
    expect(moveIndex(KEYS, 'a', 'move-up')).toBeNull();
    expect(moveIndex(KEYS, 'a', 'move-top')).toBeNull();
    expect(moveIndex(KEYS, 'd', 'move-down')).toBeNull();
    expect(moveIndex(KEYS, 'd', 'move-bottom')).toBeNull();
    expect(moveIndex(KEYS, 'x', 'move-up')).toBeNull();
  });
});

describe('selectionAfterRemoval', () => {
  it('选中的被移出：选后面的第一行，后面没有了选前面的，都移出了为 null', () => {
    expect(selectionAfterRemoval(KEYS, new Set(['b']), 'b')).toBe('c');
    expect(selectionAfterRemoval(KEYS, new Set(['b', 'c']), 'b')).toBe('d');
    expect(selectionAfterRemoval(KEYS, new Set(['d']), 'd')).toBe('c');
    expect(selectionAfterRemoval(KEYS, new Set(['c', 'd']), 'd')).toBe('b');
    expect(selectionAfterRemoval(KEYS, new Set(KEYS), 'a')).toBeNull();
  });

  it('选中的没被移出、没有选中：不变', () => {
    expect(selectionAfterRemoval(KEYS, new Set(['b']), 'a')).toBe('a');
    expect(selectionAfterRemoval(KEYS, new Set(['b']), null)).toBeNull();
  });
});

describe('steppedKey', () => {
  it('上下换行，到头时不动', () => {
    expect(steppedKey(KEYS, 'b', 1)).toBe('c');
    expect(steppedKey(KEYS, 'b', -1)).toBe('a');
    expect(steppedKey(KEYS, 'a', -1)).toBe('a');
    expect(steppedKey(KEYS, 'd', 1)).toBe('d');
  });
});
