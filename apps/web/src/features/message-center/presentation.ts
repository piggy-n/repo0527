import type { Message, MessageCategory } from './api';

export const categoryLabels: Record<MessageCategory, string> = {
  approval: '审批提醒',
  resource: '资源消息',
  table: '统计报表'
};

export type MessageTarget = { kind: 'reports' } | { kind: 'application'; id: string | null };

/** 旧版报表消息进入列表；申请消息携带的 taskId 用于原申请详情接口 */
export function messageTarget(message: Message): MessageTarget {
  return message.category === 'table'
    ? { kind: 'reports' }
    : { kind: 'application', id: message.taskId || null };
}

export function actionLabel(message: Message): string {
  if (message.category === 'table') {
    return '查看统计报表';
  }
  return message.taskId ? '查看相关申请' : '查看资源审核列表';
}

/** 没有审核状态的通知使用信息图标，不把它解释成审核通过 */
export function messageTone(message: Message): 'info' | 'warning' | 'success' | 'danger' {
  switch (message.taskStatus) {
    case 'pending':
      return 'warning';
    case 'approved':
      return 'success';
    case 'rejected':
      return 'danger';
    case null:
    default:
      return 'info';
  }
}
