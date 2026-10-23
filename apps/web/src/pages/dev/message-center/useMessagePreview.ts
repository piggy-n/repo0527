import { computed, ref, watch } from 'vue';
import type { Message, MessageCategory } from '@/features/message-center/api';
import type { MessageViewModel } from '@/features/message-center/components/MessageCenterView';
import type { ReadFilter } from '@/features/message-center/composables/useMessageCenter';
import { createPreviewMessages } from './preview-data';

export type MessageScene = 'normal' | 'empty' | 'loading' | 'error';

function createMessages(): Message[] {
  return createPreviewMessages().map(message => ({
    msgId: String(message.id),
    title: message.title,
    content: message.content,
    createTime: message.time,
    isRead: message.read,
    category: message.category,
    taskId: `preview-${message.id}`,
    taskStatus: message.status === 'info' ? null : message.status
  }));
}

/** 固定数据驱动正式组件，不读取接口或改动登录会话 */
export function useMessagePreview() {
  const scene = ref<MessageScene>('normal');
  const records = ref(createMessages());
  const open = ref(false);
  const readFilter = ref<ReadFilter>('all');
  const category = ref<MessageCategory | 'all'>('all');
  const selectedId = ref<string>();
  const limit = ref(20);
  const messages = computed(() => scene.value === 'empty' ? [] : records.value);
  const unreadCount = computed(() => messages.value.filter(message => !message.isRead).length);
  const filtered = computed(() => messages.value.filter(message => {
    const matchesRead = readFilter.value === 'all' || message.isRead === (readFilter.value === 'read');
    return matchesRead && (category.value === 'all' || message.category === category.value);
  }));
  const selected = computed(() => messages.value.find(message => message.msgId === selectedId.value));
  watch([readFilter, category, scene], () => {
    limit.value = 20;
    selectedId.value = undefined;
  });
  watch(open, value => {
    if (!value) {
      selectedId.value = undefined;
    }
  });

  async function read(id: string) {
    const message = records.value.find(item => item.msgId === id);
    if (message) {
      message.isRead = true;
    }
  }

  function reset() {
    records.value = createMessages();
    scene.value = 'normal';
    readFilter.value = 'all';
    category.value = 'all';
    selectedId.value = undefined;
    limit.value = 20;
  }

  const model: MessageViewModel = {
    open, readFilter, category, selectedId, selected, limit, messages, unreadCount, filtered,
    visible: computed(() => filtered.value.slice(0, limit.value)),
    readingAll: ref(false),
    allError: ref(''),
    selectedError: computed(() => ''),
    canReadAll: computed(() => unreadCount.value > 0 && scene.value === 'normal'),
    loading: computed(() => scene.value === 'loading'),
    refreshing: computed(() => scene.value === 'loading'),
    failed: computed(() => scene.value === 'error'),
    isReading: () => false,
    refresh: async () => {
      scene.value = 'normal';
    },
    read,
    select: id => {
      selectedId.value = id;
      void read(id);
    },
    readAll: async () => {
      for (const message of records.value) {
        message.isRead = true;
      }
    }
  };
  return { scene, model, reset };
}
