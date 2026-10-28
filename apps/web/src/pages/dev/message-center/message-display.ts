import type { MessageCategory, MessageSample } from './samples';

export type Role = 'admin' | 'user';

/** 消息指向的业务；正式代码里由消息 feature 给出，app 按角色换成路由 */
export type MessageTarget = { kind: 'application'; applyId: string; audit: boolean } | { kind: 'reports' };

export interface MessageAction {
  label: string;
  target: MessageTarget;
  // 原型里用来显示跳转的地址
  path: string;
  // 普通用户的"数据下载"还没有迁移
  available: boolean;
}

const ACTION_LABELS: Record<MessageCategory, string> = {
  approval: '去审核',
  resource: '查看申请',
  table: '查看报表'
};

function targetOf(message: MessageSample): MessageTarget | null {
  if (message.category === 'table') {
    return { kind: 'reports' };
  }
  if (!message.applyId) {
    return null;
  }
  return { kind: 'application', applyId: message.applyId, audit: message.category === 'approval' };
}

function pathOf(target: MessageTarget, role: Role): string {
  const base = role === 'admin' ? '/system-management' : '/resource-application';
  return target.kind === 'reports' ? `${base}/statistical-report` : `${base}?apply=${target.applyId}`;
}

/** 消息的业务按钮；没有关联的业务时为 null */
export function messageAction(message: MessageSample, role: Role): MessageAction | null {
  const target = targetOf(message);
  if (!target) {
    return null;
  }
  return {
    label: ACTION_LABELS[message.category],
    target,
    path: pathOf(target, role),
    available: role === 'admin'
  };
}

/** 列表里的时间：今天只写时分，今年写月日，更早写日期 */
export function messageTime(createdAt: string, now: Date): string {
  const date = createdAt.slice(0, 10);
  const time = createdAt.slice(11, 16);
  const today = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map((part, index) => (index === 0 ? String(part) : String(part).padStart(2, '0')))
    .join('-');
  if (date === today) {
    return `今天 ${time}`;
  }
  if (date.startsWith(String(now.getFullYear()))) {
    return `${date.slice(5)} ${time}`;
  }
  return date;
}
