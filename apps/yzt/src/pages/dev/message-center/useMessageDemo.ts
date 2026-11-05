import { computed, reactive, ref, shallowRef } from 'vue';
import type { Message } from '@/features/message-center/api';
import type { MessageCenter } from '@/features/message-center/composables/useMessageCenter';
import { useMessageFilters } from '@/features/message-center/composables/useMessageFilters';
import { MESSAGE_SAMPLES } from './samples';

export type ListScene = 'normal' | 'loading' | 'error' | 'empty';
export type ReadScene = 'success' | 'error' | 'slow';

export interface MessageDemoOptions {
  // 已读失败时的提示；正式页面由全局提示显示接口给的原因
  onReadError: (reason: string) => void;
}

const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));
const asRead = (message: Message): Message => ({ ...message, read: true });

/**
 * 消息组件样例的拥有者：和 useMessageCenter 的形状相同，交给正式的 MessagePanel；筛选和分批用同一个 useMessageFilters，
 * 数据是固定的，已读只在内存里改，列表状态和已读的结果由演示选项决定，不请求接口
 */
export function useMessageDemo({ onReadError }: MessageDemoOptions) {
  const listScene = ref<ListScene>('normal');
  const readScene = ref<ReadScene>('success');
  const messages = shallowRef<Message[]>(structuredClone(MESSAGE_SAMPLES));
  const reading = reactive(new Set<string>());
  const readingAll = ref(false);

  const shown = computed(() => (listScene.value === 'normal' ? messages.value : []));
  const filters = useMessageFilters(shown);
  const unreadIds = computed(() => shown.value.filter(message => !message.read).map(message => message.id));

  function settle(ids: ReadonlySet<string>) {
    messages.value = messages.value.map(message => (ids.has(message.id) ? asRead(message) : message));
  }

  async function request() {
    await wait(readScene.value === 'slow' ? 2000 : 300);
    if (readScene.value === 'error') {
      throw new Error('消息不存在');
    }
  }

  async function markRead(message: Message): Promise<boolean> {
    if (message.read || reading.has(message.id) || readingAll.value) {
      return false;
    }
    reading.add(message.id);
    try {
      await request();
      settle(new Set([message.id]));
      return true;
    } catch {
      onReadError('消息不存在');
      return false;
    } finally {
      reading.delete(message.id);
    }
  }

  async function markAllRead(): Promise<boolean> {
    const ids = unreadIds.value;
    if (ids.length === 0 || readingAll.value || reading.size > 0) {
      return false;
    }
    readingAll.value = true;
    try {
      await request();
      settle(new Set(ids));
      return true;
    } catch {
      onReadError('服务异常');
      return false;
    } finally {
      readingAll.value = false;
    }
  }

  const center: MessageCenter = {
    // 角标不受列表状态影响：正式页面里它来自单独的未读查询
    unreadCount: computed(() => messages.value.filter(message => !message.read).length),
    ...filters,
    initialLoading: computed(() => listScene.value === 'loading'),
    loadFailed: computed(() => listScene.value === 'error'),
    retry: () => {
      listScene.value = 'normal';
    },
    isReading: (id: string) => reading.has(id),
    readingAll: computed(() => readingAll.value),
    canReadAll: computed(() => unreadIds.value.length > 0 && !readingAll.value && reading.size === 0),
    markRead,
    markAllRead
  };

  // 模拟下一次刷新带回一条新的审批提醒
  let incoming = 0;
  function receive() {
    incoming += 1;
    const message: Message = {
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

  return { center, listScene, readScene, receive };
}
