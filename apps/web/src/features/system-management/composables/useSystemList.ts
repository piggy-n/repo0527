import { hashKey } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import type { SystemFilters, SystemPageRequest, SystemRow, SystemSection } from '../api';
import { useSystemPageQuery } from '../queries';

const emptyFilters = (): SystemFilters => ({ name: '', status: 'all', taskStatus: 'all' });

/** 每类列表独立持有筛选和分页，接口记录仍由查询缓存持有 */
export function useSystemList(section: SystemSection) {
  const form = reactive(emptyFilters());
  const applied = ref(emptyFilters());
  const pageNum = ref(1);
  const pageSize = ref(20);
  const request = computed<SystemPageRequest>(() => ({
    ...applied.value,
    section,
    pageNum: pageNum.value,
    pageSize: pageSize.value
  }));
  const requestKey = computed(() => hashKey([request.value]));
  const conditionKey = computed(() => hashKey([{ ...request.value, pageNum: undefined }]));
  const query = useSystemPageQuery(request);
  const knownTotals = reactive(new Map<string, number>());
  const manualRefreshing = ref(false);
  const rows = computed<SystemRow[]>(() => query.data.value?.page.list ?? []);
  const total = computed(() => knownTotals.get(conditionKey.value) ?? query.data.value?.page.total ?? 0);
  const refreshing = computed(() => !query.isLoading.value &&
    (manualRefreshing.value || query.isPlaceholderData.value));

  // 失败及占位结果不修正页码，防止分页器因暂时没有数据跳回第一页
  watch(
    [query.data, query.isPlaceholderData, query.isFetching, query.isSuccess],
    ([result, placeholder, fetching, ok]) => {
      if (!result || placeholder || result.requestKey !== requestKey.value) {
        return;
      }
      const { page } = result;
      if (fetching || !ok) {
        if (!knownTotals.has(conditionKey.value)) {
          knownTotals.set(conditionKey.value, page.total);
        }
        return;
      }
      knownTotals.set(conditionKey.value, page.total);
      pageNum.value = Math.min(pageNum.value, Math.max(1, page.pages));
    },
    { immediate: true }
  );

  async function refresh() {
    manualRefreshing.value = true;
    await query.refetch();
    manualRefreshing.value = false;
  }

  function search() {
    const previous = requestKey.value;
    applied.value = { ...form, name: form.name.trim() };
    pageNum.value = 1;
    if (requestKey.value === previous) {
      void refresh();
    }
  }

  function reset() {
    Object.assign(form, emptyFilters());
    search();
  }

  function changePageSize(size: number) {
    pageSize.value = size;
    pageNum.value = 1;
  }

  return {
    form, rows, total, pageNum, pageSize,
    initialLoading: query.isLoading,
    refreshing,
    isError: query.isError,
    refresh, search, reset, changePageSize
  };
}
