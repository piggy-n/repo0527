import { z } from 'zod';
import { http } from '@/shared/http/client';

// 字段按 2026-10-27 只读核对的真实返回（docs/migration.md）：每条记录都有同一组键，没有值的是 null；
// 发送人、处室、优先级等界面用不到的字段不声明，解析时丢弃

/** 消息的类型：审批提醒、资源消息、报表通知（实测 table 占了绝大多数） */
const messageCategorySchema = z.enum(['approval', 'resource', 'table']);

export type MessageCategory = z.infer<typeof messageCategorySchema>;

const messageSchema = z
  .object({
    msgId: z.string().min(1),
    category: messageCategorySchema,
    title: z.string(),
    content: z.string(),
    // 北京时间的字符串 YYYY-MM-DD HH:mm:ss，按时间倒序
    createTime: z.string(),
    // 字符串的 true / false
    isRead: z.enum(['true', 'false']),
    // 名字叫 taskId，实际是申请的 apply_id（实测用申请详情接口对上了）；报表通知是 null
    taskId: z.string().nullable()
  })
  .transform(row => ({
    id: row.msgId,
    category: row.category,
    title: row.title,
    content: row.content,
    createdAt: row.createTime,
    read: row.isRead === 'true',
    applyId: row.taskId
  }));

export type Message = z.infer<typeof messageSchema>;

/**
 * 当前账号的消息。接口不分页（pageNum、pageSize 被忽略），一次返回全部；unread 为 true 时只要未读的（isRead 过滤有效）。
 * 读取失败由弹框和角标自己处理，不弹全局提示
 */
export function fetchMessages(unread: boolean, signal?: AbortSignal) {
  const body = unread ? { isRead: 'false' } : {};
  return http.post('/api/message/list', body, { schema: z.array(messageSchema), signal, silent: true });
}

// 已读的成功返回没有实测（不对真实后端做写操作），只判断业务码、丢弃 data；失败由全局提示显示原因
const discardData = z.unknown().transform(() => undefined);

/** 标记一条已读：ID 在路径里，没有正文（旧页面的调用） */
export function markMessageRead(id: string) {
  return http.post(`/api/message/read/${encodeURIComponent(id)}`, undefined, { schema: discardData });
}

/** 当前账号的消息全部已读：没有正文，由后端决定是哪些（旧页面的调用） */
export function markAllMessagesRead() {
  return http.post('/api/message/read/all', undefined, { schema: discardData });
}
