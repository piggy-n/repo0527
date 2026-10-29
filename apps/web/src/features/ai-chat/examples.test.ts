// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { nextExampleCount, pickExamples, QUICK_EXAMPLES } from './examples';

// 依次返回给定的值
const sequence = (...values: number[]) => () => values.shift() ?? 0;

describe('pickExamples', () => {
  it('挑出指定条数，不重复', () => {
    const picked = pickExamples(5);

    expect(picked).toHaveLength(5);
    expect(new Set(picked).size).toBe(5);
    expect(picked.every(example => QUICK_EXAMPLES.includes(example))).toBe(true);
  });

  it('按随机数交换：第一个位置换成最后一条', () => {
    const picked = pickExamples(2, sequence(0.999, 0));

    expect(picked).toEqual([QUICK_EXAMPLES.at(-1), QUICK_EXAMPLES[1]]);
  });
});

describe('nextExampleCount', () => {
  it('3～5 条', () => {
    expect(nextExampleCount(() => 0)).toBe(3);
    expect(nextExampleCount(() => 0.999)).toBe(5);
  });
});
