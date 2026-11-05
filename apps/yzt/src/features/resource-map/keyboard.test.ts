// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { arrowStep } from './keyboard';

describe('arrowStep', () => {
  it('往上是 -1，往下是 1，其他键为 0', () => {
    expect(arrowStep({ key: 'ArrowUp' })).toBe(-1);
    expect(arrowStep({ key: 'ArrowDown' })).toBe(1);
    expect(arrowStep({ key: 'ArrowLeft' })).toBe(0);
    expect(arrowStep({ key: 'Enter' })).toBe(0);
  });
});
