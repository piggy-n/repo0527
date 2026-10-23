import { computed, onScopeDispose, reactive, ref, watch } from 'vue';
import { useSessionGuard } from '@/shared/auth/session-guard';
import { useSessionStore } from '@/shared/auth/session-store';
import { ApiError } from '@/shared/http/errors';
import type { MessageCategory } from '../api';
import { useMessageReadMutation, useMessagesQuery } from '../queries';

export type ReadFilter = 'all' | 'unread' | 'read';

/** 消息列表和详情共用查询结果，已读成功后才移除红点 */
export function useMessageCenter() {
  const session = useSessionStore();
  const guard = useSessionGuard();
  const query = useMessagesQuery();
  const mutation = useMessageReadMutation();
  const open = ref(false);
  const selectedId = ref<string>();
  const readFilter = ref<ReadFilter>('all');
  const category = ref<MessageCategory | 'all'>('all');
  const limit = ref(20);
  const reading = reactive(new Set<string>());
  const readErrors = reactive(new Map<string, string>());
  const readingAll = ref(false);
  const allError = ref('');
  let disposed = false;
  // 查询 key 切换后的下一轮才更新 data，同步隐藏上一账号的结果
  const messages = computed(() => {
    const result = query.data.value;
    return session.token && result && result.account === session.user?.loginName ? result.messages : [];
  });
  const unreadCount = computed(() => messages.value.filter(message => !message.isRead).length);
  const selected = computed(() => messages.value.find(message => message.msgId === selectedId.value));
  const filtered = computed(() => messages.value.filter(message => {
    const matchesRead = readFilter.value === 'all' || message.isRead === (readFilter.value === 'read');
    return matchesRead && (category.value === 'all' || message.category === category.value);
  }));
  const visible = computed(() => filtered.value.slice(0, limit.value));
  const selectedError = computed(() => selectedId.value ? readErrors.get(selectedId.value) ?? '' : '');
  const canReadAll = computed(() => unreadCount.value > 0 && !readingAll.value && reading.size === 0);

  watch([readFilter, category], () => {
    limit.value = 20;
  });
  watch(open, value => {
    if (value) {
      if (!query.isFetching.value) {
        void query.refetch();
      }
    } else {
      selectedId.value = undefined;
      readErrors.clear();
      allError.value = '';
    }
  });
  watch(() => session.token, () => {
    open.value = false;
    selectedId.value = undefined;
    readFilter.value = 'all';
    category.value = 'all';
    limit.value = 20;
  }, { flush: 'sync' });
  onScopeDispose(() => {
    disposed = true;
  });

  async function read(id: string) {
    const message = messages.value.find(item => item.msgId === id);
    if (disposed || !message || message.isRead || reading.has(id) || readingAll.value) {
      return;
    }
    const token = guard.capture();
    const account = session.user!.loginName;
    reading.add(id);
    readErrors.delete(id);
    try {
      await mutation.mutateAsync({ id, ids: [id], account, token });
    } catch (error) {
      if (!disposed && open.value && guard.isCurrent(token) &&
        !(error instanceof ApiError && error.kind === 'canceled')) {
        readErrors.set(id, '标记已读失败，请重试');
      }
    } finally {
      reading.delete(id);
    }
  }

  function select(id: string) {
    selectedId.value = id;
    void read(id);
  }

  async function readAll() {
    if (disposed || !canReadAll.value) {
      return;
    }
    const token = guard.capture();
    const account = session.user!.loginName;
    const ids = messages.value.filter(message => !message.isRead).map(message => message.msgId);
    readingAll.value = true;
    allError.value = '';
    try {
      await mutation.mutateAsync({ ids, account, token });
    } catch (error) {
      if (!disposed && open.value && guard.isCurrent(token) &&
        !(error instanceof ApiError && error.kind === 'canceled')) {
        allError.value = '全部标记已读失败，请重试';
      }
    } finally {
      readingAll.value = false;
    }
  }

  return {
    open, readFilter, category, limit, selectedId, selected, messages, filtered, visible, unreadCount,
    readingAll, canReadAll, allError, selectedError,
    loading: query.isLoading,
    refreshing: query.isFetching,
    failed: query.isError,
    isReading: (id: string) => reading.has(id),
    refresh: () => query.refetch(),
    read, select, readAll
  };
}

export type MessageCenterModel = ReturnType<typeof useMessageCenter>;
