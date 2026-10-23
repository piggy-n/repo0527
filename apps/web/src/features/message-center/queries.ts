import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed } from 'vue';
import { useSessionGuard } from '@/shared/auth/session-guard';
import { useSessionStore } from '@/shared/auth/session-store';
import { fetchMessages, markMessagesRead, type Message } from './api';

const listKey = (account: string) => ['message-center', 'list', account] as const;

/** 进入应用先读取未读数，弹框重新打开时由拥有者刷新，不启动全局轮询 */
export function useMessagesQuery() {
  const session = useSessionStore();
  const guard = useSessionGuard();
  return useQuery(computed(() => {
    const token = guard.capture();
    const account = session.user?.loginName ?? '';
    return {
      queryKey: listKey(account),
      enabled: token !== undefined,
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        guard.assertCurrent(token);
        const messages = await fetchMessages(signal);
        guard.assertCurrent(token);
        return messages;
      },
      select: (messages: Message[]) => ({ messages, account })
    };
  }));
}

interface ReadInput {
  id?: string;
  // 全部已读只更新提交时见到的记录，新到消息由下一次读取确认
  ids: readonly string[];
  account: string;
  token: string | undefined;
}

export function useMessageReadMutation() {
  const guard = useSessionGuard();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, token }: ReadInput) => {
      guard.assertCurrent(token);
      await markMessagesRead(id);
    },
    onSuccess: async (_result, { ids, account, token }) => {
      if (!guard.isCurrent(token)) {
        return;
      }
      const queryKey = listKey(account);
      // 取消较早的列表读取，防止它在写入成功后把红点恢复
      await client.cancelQueries({ queryKey, exact: true });
      if (!guard.isCurrent(token)) {
        return;
      }
      const readIds = new Set(ids);
      client.setQueryData<Message[]>(queryKey, previous => previous?.map(message =>
        readIds.has(message.msgId) ? { ...message, isRead: true } : message
      ));
    }
  });
}
