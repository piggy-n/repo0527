// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { prewarmMapRuntime, workerCountFor } from './map-runtime';

describe('workerCountFor', () => {
  it('核数的一半，至少 1 个、最多 4 个', () => {
    expect([0, 1, 2, 3, 4, 6, 8, 9, 16, 32].map(workerCountFor)).toStrictEqual([1, 1, 1, 1, 2, 3, 4, 4, 4, 4]);
  });
});

describe('prewarmMapRuntime', () => {
  it('设置运行时之前调用时抛错：否则 Worker 的地址和数量不生效', () => {
    expect(() => prewarmMapRuntime()).toThrow('prewarmMapRuntime 要在 setupMapRuntime 之后调用');
  });
});
