import type { MessageTarget } from '@/features/message-center/display';
import { type Role, roleApplicationRoute, roleReportRoute } from '@/shared/auth/roles';

/** 消息指向的页面，按角色换成路由：申请用 ?apply= 打开，报表是统计报表栏目（ADR 0092、0093、0127） */
export function messageLocation(target: MessageTarget, role: Role) {
  if (target.kind === 'reports') {
    return { name: roleReportRoute(role) };
  }
  return { name: roleApplicationRoute(role), query: { apply: target.applyId } };
}
