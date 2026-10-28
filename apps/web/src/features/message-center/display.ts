import { formatBeijingDateTime } from '@/shared/data-request/date-time';
import type { Message, MessageCategory } from './api';

export const CATEGORY_LABELS: Record<MessageCategory, string> = {
  approval: '审批提醒',
  resource: '资源消息',
  table: '统计报表'
};

/** 消息指向的业务；消息 feature 只给出目标，由 app 按角色换成路由（ADR 0093） */
export type MessageTarget = { kind: 'application'; applyId: string } | { kind: 'reports' };

/** 消息的业务按钮 */
export interface MessageLink {
  label: string;
  target: MessageTarget;
}

const LINK_LABELS: Record<MessageCategory, string> = {
  approval: '去审核',
  resource: '查看申请',
  table: '查看报表'
};

/** 报表通知指向统计报表，审批提醒、资源消息指向申请；业务消息没有申请 ID 时没有按钮 */
export function messageLink(message: Message): MessageLink | null {
  const label = LINK_LABELS[message.category];
  if (message.category === 'table') {
    return { label, target: { kind: 'reports' } };
  }
  if (message.applyId === null) {
    return null;
  }
  return { label, target: { kind: 'application', applyId: message.applyId } };
}

/** 列表里的时间：今天写"今天 时:分"，今年写"月-日 时:分"，更早只写日期；消息的时间是北京时间，"今天"也按北京时间判断 */
export function messageTime(createdAt: string, now: Date): string {
  const date = createdAt.slice(0, 10);
  const time = createdAt.slice(11, 16);
  const today = formatBeijingDateTime(now).slice(0, 10);
  if (date === today) {
    return `今天 ${time}`;
  }
  if (date.slice(0, 4) === today.slice(0, 4)) {
    return `${date.slice(5)} ${time}`;
  }
  return date;
}
