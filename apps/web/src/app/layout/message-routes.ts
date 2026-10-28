import type { MessageTarget } from '@/features/message-center/display';
import { RouteName } from '@/shared/router/route-names';

/** 消息指向的页面：申请在系统管理里用 ?apply= 打开，报表是统计报表栏目（ADR 0092、0093） */
export function messageLocation(target: MessageTarget) {
  if (target.kind === 'reports') {
    return { name: RouteName.systemManagementReports };
  }
  return { name: RouteName.systemManagement, query: { apply: target.applyId } };
}

/** 角色去不了消息指向的页面时的说明：普通用户看申请的"数据下载"还没有迁移 */
export const MESSAGE_UNAVAILABLE = '数据下载页面迁移后可用';
