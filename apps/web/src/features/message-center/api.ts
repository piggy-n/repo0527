import { z } from 'zod';
import { http } from '@/shared/http/client';

// 2026-10-23 只读核对：data 为数组，isRead 为字符串，任务字段允许 null
const messageSchema = z.object({
  msgId: z.string().min(1),
  title: z.string(),
  content: z.string(),
  category: z.enum(['approval', 'resource', 'table']),
  isRead: z.enum(['false', 'true']).transform(value => value === 'true'),
  createTime: z.string(),
  taskId: z.string().nullable(),
  taskStatus: z.string().nullable()
});
const messagesSchema = z.array(messageSchema)
  .transform(messages => messages.toSorted((a, b) => b.createTime.localeCompare(a.createTime)));

export type Message = z.infer<typeof messageSchema>;
export type MessageCategory = Message['category'];

/** 接口返回全量记录，筛选和分批展示由前端负责 */
export function fetchMessages(signal: AbortSignal) {
  return http.post('/api/message/list', {}, { schema: messagesSchema, signal, silent: true });
}

/** 已读接口只消费统一业务码，不依赖未确认的 data 内容 */
export function markMessagesRead(id?: string) {
  const url = id === undefined ? '/api/message/read/all' : `/api/message/read/${encodeURIComponent(id)}`;
  return http.post(url, undefined, { schema: z.unknown().transform(() => undefined), silent: true });
}
