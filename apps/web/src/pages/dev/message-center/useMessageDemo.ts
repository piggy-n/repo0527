import { ElMessage } from 'element-plus';
import { computed, ref, shallowRef } from 'vue';
import { type MessageAction, type Role } from './message-display';
import { type MessageCategory, MESSAGE_SAMPLES, type MessageSample } from './samples';

export type DetailStyle = 'inline' | 'drill';
export type UnavailableAction = 'disabled' | 'hidden';
export type ListScene = 'normal' | 'loading' | 'error' | 'empty';
export type ReadScene = 'success' | 'error' | 'slow';
export type ReadFilter = 'all' | 'unread';
export type CategoryFilter = MessageCategory | 'all';

// 一次显示 20 条，滚到底再接着显示
const PAGE = 20;

// 演示用的"现在"，和固定数据的时间对应
export const DEMO_NOW = new Date(2026, 9, 28, 12, 0, 0);

const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

/** 消息弹框原型的演示数据：已读只在内存里改，失败和慢由演示选项决定 */
export function useMessageDemo() {
  const role = ref<Role>('admin');
  const detailStyle = ref<DetailStyle>('inline');
  const unavailableAction = ref<UnavailableAction>('disabled');
  const countReports = ref(true);
  const listScene = ref<ListScene>('normal');
  const readScene = ref<ReadScene>('success');

  const messages = shallowRef<MessageSample[]>(structuredClone(MESSAGE_SAMPLES));
  const readFilter = ref<ReadFilter>('all');
  const category = ref<CategoryFilter>('all');
  const visibleCount = ref(PAGE);
  const selectedId = ref<string | null>(null);
  const pendingIds = ref<ReadonlySet<string>>(new Set());
  const readingAll = ref(false);
  const lastNavigation = ref('');

  // 普通用户没有审批提醒
  const ownMessages = computed(() =>
    listScene.value === 'empty' || listScene.value === 'error' || listScene.value === 'loading'
      ? []
      : messages.value.filter(message => role.value === 'admin' || message.category !== 'approval')
  );

  const filtered = computed(() =>
    ownMessages.value.filter(message => {
      if (readFilter.value === 'unread' && message.read) {
        return false;
      }
      return category.value === 'all' || message.category === category.value;
    })
  );
  const visible = computed(() => filtered.value.slice(0, visibleCount.value));
  const hasMore = computed(() => visibleCount.value < filtered.value.length);
  // 角标是否计入报表通知由演示选项决定
  const countsInBadge = (message: MessageSample) => countReports.value || message.category !== 'table';
  const unreadCount = computed(() => ownMessages.value.filter(message => !message.read && countsInBadge(message)).length);
  const anyUnread = computed(() => ownMessages.value.some(message => !message.read));
  const selected = computed(() => messages.value.find(message => message.id === selectedId.value));

  function setFilter(read: ReadFilter, nextCategory: CategoryFilter) {
    readFilter.value = read;
    category.value = nextCategory;
    visibleCount.value = PAGE;
  }

  function loadMore() {
    if (hasMore.value) {
      visibleCount.value += PAGE;
    }
  }

  function replace(ids: ReadonlySet<string>) {
    messages.value = messages.value.map(message => (ids.has(message.id) ? { ...message, read: true } : message));
  }

  async function request() {
    await wait(readScene.value === 'slow' ? 2000 : 300);
    if (readScene.value === 'error') {
      throw new Error('演示：标记已读失败');
    }
  }

  /** 标记一条已读；成功后才去掉红点，失败时保留未读 */
  async function markRead(message: MessageSample) {
    if (message.read || pendingIds.value.has(message.id) || readingAll.value) {
      return;
    }
    pendingIds.value = new Set([...pendingIds.value, message.id]);
    try {
      await request();
      replace(new Set([message.id]));
    } catch {
      ElMessage.error('标记已读失败，请重试');
    } finally {
      const next = new Set(pendingIds.value);
      next.delete(message.id);
      pendingIds.value = next;
    }
  }

  /** 全部已读：只改提交时看到的未读，之后到达的新消息保持未读 */
  async function markAllRead() {
    if (readingAll.value) {
      return;
    }
    const ids = new Set(ownMessages.value.filter(message => !message.read).map(message => message.id));
    readingAll.value = true;
    try {
      await request();
      replace(ids);
    } catch {
      ElMessage.error('全部已读失败，请重试');
    } finally {
      readingAll.value = false;
    }
  }

  function select(message: MessageSample) {
    selectedId.value = message.id;
    void markRead(message);
  }

  function back() {
    selectedId.value = null;
  }

  function navigate(message: MessageSample, action: MessageAction) {
    void markRead(message);
    lastNavigation.value = action.path;
    selectedId.value = null;
  }

  // 模拟下一次轮询带回一条新的审批提醒
  let incoming = 0;
  function receive() {
    incoming += 1;
    const message: MessageSample = {
      id: `msg-incoming-${incoming}`,
      category: 'approval',
      title: '数据申请待审核',
      content: `赵强于2026年10月28日11时5${incoming % 10}分提交的资源申请需要您审批，请及时查看并处理相关申请。`,
      createdAt: `2026-10-28 11:5${incoming % 10}:00`,
      read: false,
      applyId: 'apply-002'
    };
    messages.value = [message, ...messages.value];
  }

  return {
    role,
    detailStyle,
    unavailableAction,
    countReports,
    listScene,
    readScene,
    readFilter,
    category,
    visible,
    filteredCount: computed(() => filtered.value.length),
    hasMore,
    unreadCount,
    anyUnread,
    selected,
    pendingIds,
    readingAll,
    lastNavigation,
    setFilter,
    loadMore,
    markRead,
    markAllRead,
    select,
    back,
    navigate,
    receive
  };
}

export type MessageDemo = ReturnType<typeof useMessageDemo>;
