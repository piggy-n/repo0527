// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { formatDateTime } from './date-time';

describe('formatDateTime', () => {
  it('按本地时间写成 YYYY-MM-DD HH:mm:ss，个位数补零', () => {
    expect(formatDateTime(new Date(2026, 0, 2, 3, 4, 5))).toBe('2026-01-02 03:04:05');
    expect(formatDateTime(new Date(2026, 11, 31, 23, 59, 59))).toBe('2026-12-31 23:59:59');
  });
});
