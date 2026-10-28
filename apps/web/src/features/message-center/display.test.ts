// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Message } from './api';
import { messageLink, messageTime } from './display';

const message = (overrides: Partial<Message>): Message => ({
  id: 'msg-1',
  category: 'approval',
  title: '数据申请待审核',
  content: '',
  createdAt: '2026-10-28 11:29:36',
  read: false,
  applyId: 'apply-1',
  ...overrides
});

describe('messageLink', () => {
  it('审批提醒去审核，资源消息查看申请，都带上申请 ID', () => {
    expect(messageLink(message({}))).toEqual({
      label: '去审核',
      target: { kind: 'application', applyId: 'apply-1' }
    });
    expect(messageLink(message({ category: 'resource', applyId: 'apply-2' }))).toEqual({
      label: '查看申请',
      target: { kind: 'application', applyId: 'apply-2' }
    });
  });

  it('报表通知指向统计报表；没有申请 ID 的业务消息没有按钮', () => {
    expect(messageLink(message({ category: 'table', applyId: null }))).toEqual({
      label: '查看报表',
      target: { kind: 'reports' }
    });
    expect(messageLink(message({ category: 'resource', applyId: null }))).toBeNull();
  });
});

describe('messageTime', () => {
  // 北京时间 2026-10-28 08:30，太平洋时间还是 10-27
  const now = new Date('2026-10-28T00:30:00Z');

  it('今天、今年、更早', () => {
    expect(messageTime('2026-10-28 00:05:00', now)).toBe('今天 00:05');
    expect(messageTime('2026-10-27 23:59:59', now)).toBe('10-27 23:59');
    expect(messageTime('2025-12-31 09:00:00', now)).toBe('2025-12-31');
  });

  it('"今天"按北京时间判断，不按浏览器所在的时区', () => {
    // 北京时间 2026-01-01 07:00，UTC 还是上一年
    const newYear = new Date('2025-12-31T23:00:00Z');
    expect(messageTime('2026-01-01 06:00:00', newYear)).toBe('今天 06:00');
    expect(messageTime('2025-12-31 22:00:00', newYear)).toBe('2025-12-31');
  });
});
