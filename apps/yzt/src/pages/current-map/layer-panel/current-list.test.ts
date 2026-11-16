// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  layerInsertIndex,
  layersAboveModels,
  mergedOrder,
  moveIndex,
  movedOrder,
  selectionAfterRemoval,
  steppedKey
} from './current-list';

const KEYS = ['a', 'b', 'c', 'd'];

// 资源和模型的键：同 resourceKey、modelKey
const r = (code: string) => `resource:${code}`;
const m = (id: string) => `model:${id}`;

describe('moveIndex', () => {
  it('上移、下移一位，置顶、置底；到头、不在列表里时为 null', () => {
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

describe('mergedOrder', () => {
  it('第一次：没有模型时就是资源的先后；模型都在最上面，资源在它们下面', () => {
    expect(mergedOrder([], [r('a'), r('b')], [])).toStrictEqual([r('a'), r('b')]);
    // 资源放在最上面那个模型的下面
    expect(mergedOrder([], [r('a'), r('b')], [m('x'), m('y')])).toStrictEqual([m('x'), r('a'), r('b'), m('y')]);
  });

  it('按上次的穿插，资源、模型各自的先后按拥有者', () => {
    const previous = [r('a'), m('x'), r('b'), m('y'), r('c')];
    // 资源的拥有者里 c 挪到了最前，模型的拥有者里 y 挪到了 x 前面：位置不变，内容按拥有者
    expect(mergedOrder(previous, [r('c'), r('a'), r('b')], [m('y'), m('x')])).toStrictEqual([
      r('c'),
      m('y'),
      r('a'),
      m('x'),
      r('b')
    ]);
  });

  it('新的模型放在最上面；新的资源放在最上面那个模型的下面，和拥有者里插入的位置一致', () => {
    const previous = [r('a'), m('x'), r('b')];
    expect(mergedOrder(previous, [r('a'), r('b')], [m('y'), m('x')])).toStrictEqual([
      m('y'),
      r('a'),
      m('x'),
      r('b')
    ]);
    // 资源的拥有者把新的 c 插在第 1 位（模型上面有 1 个资源）
    expect(mergedOrder(previous, [r('a'), r('c'), r('b')], [m('x')])).toStrictEqual([
      r('a'),
      m('x'),
      r('c'),
      r('b')
    ]);
  });

  it('去掉了的行不再出现；和上次一样时返回上次的数组', () => {
    const previous = [r('a'), m('x'), r('b')];
    expect(mergedOrder(previous, [r('b')], [m('x')])).toStrictEqual([m('x'), r('b')]);
    expect(mergedOrder(previous, [r('a'), r('b')], [m('x')])).toBe(previous);
  });
});

describe('layersAboveModels、layerInsertIndex', () => {
  it('最上面那个模型上面的资源；没有模型时没有，新资源插在第 0 位', () => {
    expect(layersAboveModels([r('a'), r('b'), m('x'), r('c'), m('y')])).toStrictEqual([r('a'), r('b')]);
    expect(layersAboveModels([m('x'), r('a')])).toStrictEqual([]);
    expect(layersAboveModels([r('a'), r('b')])).toStrictEqual([]);
    expect(layerInsertIndex([r('a'), r('b'), m('x'), r('c')])).toBe(2);
    expect(layerInsertIndex([r('a'), r('b')])).toBe(0);
  });
});

describe('movedOrder', () => {
  it('没有筛选：同列表里的移动', () => {
    expect(movedOrder(KEYS, KEYS, 'c', 0)).toStrictEqual(['c', 'a', 'b', 'd']);
    expect(movedOrder(KEYS, KEYS, 'a', 2)).toStrictEqual(['b', 'c', 'a', 'd']);
    expect(movedOrder(KEYS, KEYS, 'a', 3)).toStrictEqual(['b', 'c', 'd', 'a']);
    expect(movedOrder(KEYS, KEYS, 'b', 1)).toBeNull();
  });

  it('筛选时按看得见的行：往上放到越过的那一行正上方，往下放到越过的那一行正下方，看不见的行不动', () => {
    const keys = [r('a'), m('x'), r('b'), m('y'), r('c')];
    const visible = [r('a'), r('b'), r('c')];
    // c 上移一行：放到 b 的正上方，y 不动
    expect(movedOrder(keys, visible, r('c'), 1)).toStrictEqual([r('a'), m('x'), r('c'), r('b'), m('y')]);
    // a 下移一行：放到 b 的正下方，x 不动（a 越过了模型 x）
    expect(movedOrder(keys, visible, r('a'), 1)).toStrictEqual([m('x'), r('b'), r('a'), m('y'), r('c')]);
    // 置顶：放到看得见的第一行正上方；置底：最后一行正下方
    expect(movedOrder(keys, visible, r('b'), 0)).toStrictEqual([r('b'), r('a'), m('x'), m('y'), r('c')]);
    expect(movedOrder(keys, visible, r('a'), 2)).toStrictEqual([m('x'), r('b'), m('y'), r('c'), r('a')]);
  });

  it('看不见的行、越界的位置抛错', () => {
    expect(() => movedOrder(KEYS, ['a', 'b'], 'c', 0)).toThrow('看得见的行里没有 c');
    expect(() => movedOrder(KEYS, KEYS, 'a', 4)).toThrow(RangeError);
  });
});
