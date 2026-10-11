// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { workerCountFor } from './map-runtime';

describe('workerCountFor', () => {
  it('核数的一半，至少 1 个、最多 4 个', () => {
    expect([0, 1, 2, 3, 4, 6, 8, 9, 16, 32].map(workerCountFor)).toStrictEqual([1, 1, 1, 1, 2, 3, 4, 4, 4, 4]);
  });
});
