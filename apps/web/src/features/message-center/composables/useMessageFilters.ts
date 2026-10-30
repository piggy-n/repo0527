import { computed, type MaybeRefOrGetter, ref, toValue } from 'vue';
import type { Message, MessageCategory } from '../api';

export type ReadFilter = 'all' | 'unread';
export type CategoryFilter = MessageCategory | 'all';

/** 列表一次显示多少条，滚到底再接着显示 */
export const MESSAGE_BATCH = 20;

/** 消息列表在前端的筛选（全部 / 未读、类型）和分批显示；数据从哪里来由调用方决定（接口或组件样例的固定数据） */
export function useMessageFilters(messages: MaybeRefOrGetter<readonly Message[]>) {
  const readFilter = ref<ReadFilter>('all');
  const category = ref<CategoryFilter>('all');
  const visibleCount = ref(MESSAGE_BATCH);

  const filtered = computed(() =>
    toValue(messages).filter(
      message =>
        (readFilter.value === 'all' || !message.read) &&
        (category.value === 'all' || message.category === category.value)
    )
  );

  // 换了筛选条件从头显示
  function setReadFilter(value: ReadFilter) {
    readFilter.value = value;
    visibleCount.value = MESSAGE_BATCH;
  }

  function setCategory(value: CategoryFilter) {
    category.value = value;
    visibleCount.value = MESSAGE_BATCH;
  }

  // 由列表在还有更多时调用（hasMore）
  function loadMore() {
    visibleCount.value += MESSAGE_BATCH;
  }

  return {
    readFilter: computed(() => readFilter.value),
    category: computed(() => category.value),
    setReadFilter,
    setCategory,
    visible: computed(() => filtered.value.slice(0, visibleCount.value)),
    /** 筛选后的总条数 */
    filteredCount: computed(() => filtered.value.length),
    hasMore: computed(() => visibleCount.value < filtered.value.length),
    loadMore
  };
}
