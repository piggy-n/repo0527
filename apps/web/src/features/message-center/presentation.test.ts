// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Message } from './api';
import { actionLabel, messageTarget, messageTone } from './presentation';
import { messageFixture } from './testing';

const message: Message = { ...messageFixture, category: 'resource', isRead: false };

describe('消息展示与业务意图', () => {
  it('报表通知进入报表列表，不把 taskId 当成申请 ID', () => {
    expect(messageTarget({ ...message, category: 'table' })).toEqual({ kind: 'reports' });
    expect(actionLabel({ ...message, category: 'table' })).toBe('查看统计报表');
  });

  it('申请有 ID 时进入详情，缺少关联 ID 时明确进入列表', () => {
    expect(messageTarget(message)).toEqual({ kind: 'application', id: 'application-1' });
    expect(actionLabel(message)).toBe('查看相关申请');
    expect(messageTarget({ ...message, taskId: null })).toEqual({ kind: 'application', id: null });
    expect(actionLabel({ ...message, taskId: null })).toBe('查看资源审核列表');
  });

  it('审核状态决定图标，未知任务状态只作为信息，不伪装审核结果', () => {
    expect(messageTone(message)).toBe('success');
    expect(messageTone({ ...message, taskStatus: 'rejected' })).toBe('danger');
    expect(messageTone({ ...message, taskStatus: 'pending' })).toBe('warning');
    expect(messageTone({ ...message, taskStatus: null })).toBe('info');
    expect(messageTone({ ...message, taskStatus: 'processing' })).toBe('info');
  });
});
