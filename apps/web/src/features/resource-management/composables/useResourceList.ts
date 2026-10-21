import { hashKey } from '@tanstack/vue-query';
import { computed, nextTick, onScopeDispose, reactive, readonly, ref, shallowRef, watch } from 'vue';
import {
  type ResourcePageRequest,
  useResourceDirectoryQuery,
  useResourcePageQuery,
  useResourceYearsQuery
} from '../queries';

/** 编辑中的筛选草稿，提交查询后才进入 query key */
export interface ResourceFilters {
  name: string;
  year: string;
}

const emptyFilters = (): ResourceFilters => ({ name: '', year: '' });

/** 目录、筛选与分页的联动；接口记录只保存在 Query 缓存，不渲染、不跳转、不弹提示 */
export function useResourceList() {
  const directoryQuery = useResourceDirectoryQuery();
  const yearsQuery = useResourceYearsQuery();
  const directoryId = ref<string | null>(null);
  const pageNum = ref(1);
  const pageSize = ref(20);
  const filterForm = reactive(emptyFilters());
  const appliedFilters = ref(emptyFilters());
  // 只允许选择第二级；children=null 的顶层仍是分组，不当作资源目录查询
  const directories = computed(() => directoryQuery.data.value?.flatMap(group => group.children ?? []) ?? []);
  const selectedDirectory = computed(() => directories.value.find(node => node.id === directoryId.value) ?? null);

  watch(directories, nodes => {
    if (!nodes.some(node => node.id === directoryId.value)) {
      directoryId.value = nodes[0]?.id ?? null;
    }
  }, { immediate: true, flush: 'sync' });

  // 同一 ID 被重命名时也重置；无关目录变化不打断当前筛选和翻页
  watch(() => [selectedDirectory.value?.id, selectedDirectory.value?.name] as const, (current, previous) => {
    if (current[0] !== previous[0] || current[1] !== previous[1]) {
      Object.assign(filterForm, emptyFilters());
      appliedFilters.value = emptyFilters();
      pageNum.value = 1;
    }
  }, { flush: 'sync' });

  const request = computed<ResourcePageRequest | null>(() => {
    const directory = selectedDirectory.value;
    return directory ? {
      directoryId: directory.id,
      params: {
        resource: directory.name,
        pageNum: pageNum.value,
        pageSize: pageSize.value,
        layerName: appliedFilters.value.name.trim() || undefined,
        year: appliedFilters.value.year || undefined
      }
    } : null;
  });
  const requestKey = computed(() => hashKey([request.value]));
  const conditionKey = computed(() => hashKey([request.value && {
    ...request.value,
    params: { ...request.value.params, pageNum: undefined }
  }]));
  const query = useResourcePageQuery(request);
  // Vue Query 更新前也不把上一目录的数据显示到新目录；同目录内允许分页/筛选占位
  const displayedPage = computed(() => {
    const entry = query.data.value;
    return request.value && entry?.request?.directoryId === request.value.directoryId &&
      entry.request.params.resource === request.value.params.resource ? entry.page : undefined;
  });
  const resources = computed(() => displayedPage.value?.list ?? []);
  const knownTotals = reactive(new Map<string, number>());
  const total = computed(() => request.value
    ? knownTotals.get(conditionKey.value) ?? displayedPage.value?.total ?? 0 : 0);

  watch([query.data, query.isPlaceholderData, query.isFetching, query.isSuccess],
    ([entry, placeholder, fetching, success]) => {
      if (!request.value || !entry || placeholder || hashKey([entry.request]) !== requestKey.value) {
        return;
      }
      if (fetching || !success) {
        // 首次进入已有缓存的条件时先记总数；失败或后台刷新中的旧缓存不能改页码
        if (!knownTotals.has(conditionKey.value)) {
          knownTotals.set(conditionKey.value, entry.page.total);
        }
        return;
      }
      knownTotals.set(conditionKey.value, entry.page.total);
      // 接口已把越界页修正到最后一页；空列表仍显示第 1 页
      const returnedPage = Math.min(entry.page.pageNum, Math.max(entry.page.pages, 1));
      if (returnedPage !== pageNum.value) {
        query.rememberPage({
          ...request.value,
          params: { ...request.value.params, pageNum: returnedPage }
        }, entry.page);
        pageNum.value = returnedPage;
      }
    }, { immediate: true });

  // 仅标记主动刷新；身份按 Promise 区分，前一次的结束不能清除后一次的标记
  const manualRefresh = shallowRef<{ key: string; pending: Promise<unknown> } | null>(null);
  watch(requestKey, () => { manualRefresh.value = null; }, { flush: 'sync' });
  const initialLoading = computed(() => request.value !== null && query.isLoading.value);
  const refreshing = computed(() => displayedPage.value !== undefined && !initialLoading.value &&
    (query.isPlaceholderData.value || manualRefresh.value?.key === requestKey.value));
  let disposed = false;
  onScopeDispose(() => {
    disposed = true;
    manualRefresh.value = null;
  });

  /** 等待 Query 应用当前 key 后再刷新，避免切目录后同一轮调用 refresh 发出旧请求 */
  async function refresh() {
    const key = requestKey.value;
    await nextTick();
    if (disposed || !request.value || requestKey.value !== key) {
      return;
    }
    const pending = query.refetch();
    manualRefresh.value = { key, pending };
    try {
      await pending;
    } finally {
      if (!disposed && manualRefresh.value?.pending === pending) {
        manualRefresh.value = null;
      }
    }
  }

  function selectDirectory(id: string) {
    if (directories.value.some(node => node.id === id)) {
      directoryId.value = id;
    }
  }

  function search() {
    const previous = requestKey.value;
    appliedFilters.value = { ...filterForm };
    pageNum.value = 1;
    if (requestKey.value === previous) {
      void refresh();
    }
  }

  function resetFilters() {
    Object.assign(filterForm, emptyFilters());
    search();
  }

  function changePageSize(size: number) {
    pageSize.value = size;
    pageNum.value = 1;
  }

  return {
    directoryQuery,
    yearsQuery,
    directoryId: readonly(directoryId),
    selectedDirectory,
    filterForm,
    pageNum,
    pageSize,
    resources,
    total,
    initialLoading,
    refreshing,
    isError: query.isError,
    error: query.error,
    refresh,
    selectDirectory,
    search,
    resetFilters,
    changePageSize
  };
}
