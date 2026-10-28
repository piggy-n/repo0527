import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, type MaybeRefOrGetter, toValue } from 'vue';
import { useSessionGuard } from '@/shared/auth/session-guard';
import { fetchMessages, markAllMessagesRead, markMessageRead, type Message } from './api';

/** 消息的 query key 只在这里拼，查询和失效共用 */
export const messageKeys = {
  all: ['message-center'] as const,
  list: () => [...messageKeys.all, 'list'] as const,
  unread: () => [...messageKeys.all, 'unread'] as const
};

/** 未读数每隔多久刷新一次（ADR 0092） */
export const UNREAD_REFRESH_INTERVAL = 60_000;

/**
 * 全部消息，只在弹框打开时请求：每次打开都重新取一次，先显示缓存。
 * 全量列表比未读列表新时，用它更新未读的缓存，角标和弹框里的未读数一致
 */
export function useMessagesQuery(enabled: MaybeRefOrGetter<boolean>) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: messageKeys.list(),
    queryFn: async ({ signal }) => {
      const messages = await fetchMessages(false, signal);
      queryClient.setQueryData(messageKeys.unread(), messages.filter(message => !message.read));
      return messages;
    },
    enabled: computed(() => toValue(enabled))
  });
}

/** 未读的条数：接口没有计数，取未读列表的长度；标签页可见时定时刷新，隐藏时不取（refetchIntervalInBackground 默认关） */
export function useUnreadCountQuery() {
  return useQuery({
    queryKey: messageKeys.unread(),
    queryFn: ({ signal }) => fetchMessages(true, signal),
    select: (messages: Message[]) => messages.length,
    refetchInterval: UNREAD_REFRESH_INTERVAL
  });
}

const asRead = (message: Message): Message => ({ ...message, read: true });

// 已读成功后先改缓存，红点和角标马上变；再让两个查询失效，按服务端的结果刷新
function settleRead(queryClient: QueryClient, ids: ReadonlySet<string>) {
  queryClient.setQueryData<Message[]>(messageKeys.list(), messages =>
    messages?.map(message => (ids.has(message.id) ? asRead(message) : message))
  );
  queryClient.setQueryData<Message[]>(messageKeys.unread(), messages =>
    messages?.filter(message => !ids.has(message.id))
  );
  // 不等刷新完成：已读的结果已经显示，全量列表较大，不让调用方等它
  void queryClient.invalidateQueries({ queryKey: messageKeys.all });
}

/** 写操作的参数都带上提交时的会话（useSessionGuard 的 capture） */
interface ReadSubmission {
  id: string;
  token: string | undefined;
}

/** 标记一条已读；请求发出后后端就会执行，不随组件卸载取消 */
export function useMarkReadMutation() {
  const queryClient = useQueryClient();
  const sessionGuard = useSessionGuard();
  return useMutation({
    mutationFn: ({ id, token }: ReadSubmission) => {
      // 从提交到真正发请求之间可能已换会话，不能用新会话的凭据改旧会话的消息
      sessionGuard.assertCurrent(token);
      return markMessageRead(id);
    },
    // 旧会话的结果不改新会话的缓存
    onSuccess: (_data, { id, token }) => {
      if (sessionGuard.isCurrent(token)) {
        settleRead(queryClient, new Set([id]));
      }
    }
  });
}

interface ReadAllSubmission {
  // 提交时看到的未读
  ids: readonly string[];
  token: string | undefined;
}

/**
 * 全部已读。接口没有参数，由后端决定改哪些；本地只先改提交时看到的未读，之后到达的新消息等刷新后按服务端的结果显示
 * （和 ADR 0092 的出入见 docs/modules/system-management.md 的"全部已读"）
 */
export function useMarkAllReadMutation() {
  const queryClient = useQueryClient();
  const sessionGuard = useSessionGuard();
  return useMutation({
    mutationFn: ({ token }: ReadAllSubmission) => {
      sessionGuard.assertCurrent(token);
      return markAllMessagesRead();
    },
    onSuccess: (_data, { ids, token }) => {
      if (sessionGuard.isCurrent(token)) {
        settleRead(queryClient, new Set(ids));
      }
    }
  });
}
