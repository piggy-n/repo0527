import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, type MaybeRefOrGetter, toValue } from 'vue';
import { useSessionGuard } from '@/shared/auth/session-guard';
import { deleteAiSession, deleteAllAiSessions, fetchAiSessions } from './api';

/** AI 对话的 query key 只在这里拼 */
export const aiChatKeys = {
  all: ['ai-chat'] as const,
  sessions: () => [...aiChatKeys.all, 'sessions'] as const
};

/** 历史对话：打开历史时才请求，之后打开时显示缓存并在后台刷新 */
export function useAiSessionsQuery(enabled: MaybeRefOrGetter<boolean>) {
  return useQuery({
    queryKey: aiChatKeys.sessions(),
    queryFn: ({ signal }) => fetchAiSessions(signal),
    enabled: computed(() => toValue(enabled))
  });
}

/** 回答结束后让历史对话失效：新对话出现在列表里，消息数、时间随之更新 */
export function useInvalidateAiSessions() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: aiChatKeys.sessions() });
}

/** 写操作的参数都带上提交时的会话（useSessionGuard 的 capture） */
interface DeleteSubmission {
  /** 为 null 时删除全部 */
  sessionId: string | null;
  token: string | undefined;
}

/** 删除一个或全部历史对话；不传 signal，发出后不随组件卸载取消，旧会话的结果不刷新新会话的缓存 */
export function useDeleteAiSessionsMutation() {
  const queryClient = useQueryClient();
  const sessionGuard = useSessionGuard();
  return useMutation({
    mutationFn: ({ sessionId, token }: DeleteSubmission) => {
      sessionGuard.assertCurrent(token);
      return sessionId === null ? deleteAllAiSessions() : deleteAiSession(sessionId);
    },
    onSuccess: (_data, { token }) =>
      sessionGuard.isCurrent(token) ? queryClient.invalidateQueries({ queryKey: aiChatKeys.sessions() }) : undefined
  });
}
