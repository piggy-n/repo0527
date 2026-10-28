import { computed, type MaybeRefOrGetter, onScopeDispose, reactive, ref } from 'vue';
import { useSessionGuard } from '@/shared/auth/session-guard';
import { ApiError } from '@/shared/http/errors';
import type { Message } from '../api';
import { useMarkAllReadMutation, useMarkReadMutation, useMessagesQuery, useUnreadCountQuery } from '../queries';
import { useMessageFilters } from './useMessageFilters';

/**
 * 消息弹框的状态：角标的未读数、全部消息的筛选和分批显示、已读与全部已读。
 * open 是弹框是否打开，打开时才取全部消息；不渲染、不提示、不跳转，已读失败的原因由全局提示显示
 */
export function useMessageCenter(open: MaybeRefOrGetter<boolean>) {
  const listQuery = useMessagesQuery(open);
  const unreadQuery = useUnreadCountQuery();
  const readMutation = useMarkReadMutation();
  const readAllMutation = useMarkAllReadMutation();
  const sessionGuard = useSessionGuard();

  // 按消息 ID 记录：A 未完成时点 B，A 的状态不会被覆盖
  const reading = reactive(new Set<string>());
  const readingAll = ref(false);
  let disposed = false;
  onScopeDispose(() => {
    disposed = true;
  });

  const messages = computed(() => listQuery.data.value ?? []);
  const filters = useMessageFilters(messages);
  // 全部已读只改弹框里看到的未读
  const unreadIds = computed(() => messages.value.filter(message => !message.read).map(message => message.id));

  /** 标记一条已读，返回是否成功；已读的、正在标记的、全部已读进行中时直接返回 false */
  async function markRead(message: Message): Promise<boolean> {
    if (message.read || reading.has(message.id) || readingAll.value) {
      return false;
    }
    const token = sessionGuard.capture();
    reading.add(message.id);
    try {
      await readMutation.mutateAsync({ id: message.id, token });
      // 已读已经生效；弹框已销毁或换了会话时不再报告成功
      return !disposed && sessionGuard.isCurrent(token);
    } catch (error) {
      if (error instanceof ApiError) {
        return false;
      }
      throw error;
    } finally {
      reading.delete(message.id);
    }
  }

  /** 全部已读，返回是否成功；和单条已读互斥，没有看到未读时不提交 */
  async function markAllRead(): Promise<boolean> {
    const ids = unreadIds.value;
    if (ids.length === 0 || readingAll.value || reading.size > 0) {
      return false;
    }
    const token = sessionGuard.capture();
    readingAll.value = true;
    try {
      await readAllMutation.mutateAsync({ ids, token });
      return !disposed && sessionGuard.isCurrent(token);
    } catch (error) {
      if (error instanceof ApiError) {
        return false;
      }
      throw error;
    } finally {
      readingAll.value = false;
    }
  }

  return {
    /** 角标和标题栏的未读数：未读列表的长度，还没取到时是 0 */
    unreadCount: computed(() => unreadQuery.data.value ?? 0),
    ...filters,
    /** 还没有任何数据、正在第一次请求；显示着缓存时后台刷新不算 */
    initialLoading: computed(() => listQuery.isLoading.value),
    /** 没有数据可显示且请求失败；显示着缓存时刷新失败照常显示缓存 */
    loadFailed: computed(() => listQuery.data.value === undefined && listQuery.isError.value),
    retry: () => {
      void listQuery.refetch();
    },
    isReading: (id: string) => reading.has(id),
    readingAll: computed(() => readingAll.value),
    canReadAll: computed(() => unreadIds.value.length > 0 && !readingAll.value && reading.size === 0),
    markRead,
    markAllRead
  };
}

export type MessageCenter = ReturnType<typeof useMessageCenter>;
