// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { formatBeijingDateTime, formatDateTime } from './date-time';

describe('formatDateTime', () => {
  it('按本地时间写成 YYYY-MM-DD HH:mm:ss，个位数补零', () => {
    expect(formatDateTime(new Date(2026, 0, 2, 3, 4, 5))).toBe('2026-01-02 03:04:05');
    expect(formatDateTime(new Date(2026, 11, 31, 23, 59, 59))).toBe('2026-12-31 23:59:59');
  });
});

describe('formatBeijingDateTime', () => {
  it('不管运行环境在哪个时区，都按北京时间写，个位数补零、24 小时制', () => {
    for (const zone of ['America/Los_Angeles', 'Asia/Shanghai', 'UTC']) {
      vi.stubEnv('TZ', zone);
      expect(formatBeijingDateTime(new Date('2026-10-28T03:29:36.527+00:00'))).toBe('2026-10-28 11:29:36');
      expect(formatBeijingDateTime(new Date('2026-12-31T16:05:09Z'))).toBe('2027-01-01 00:05:09');
    }
  });
});
