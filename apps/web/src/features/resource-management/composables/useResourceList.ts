import { hashKey } from '@tanstack/vue-query';
import { computed, nextTick, onScopeDispose, reactive, readonly, ref, shallowRef, watch } from 'vue';
import {
  type ResourcePageRequest,
  useResourceDirectoryQuery,
  useResourcePageQuery,
  useResourceYearsQuery
} from '../queries';

/** 筛选表单的值，空字符串表示不按这一项筛选；点"查询"后才进入请求 */
export interface ResourceFilters {
  name: string;
  year: string;
}

const emptyFilters = (): ResourceFilters => ({ name: '', year: '' });

/**
 * 资源列表的界面状态：当前目录、筛选、分页，以及它们之间的联动；接口数据只在查询缓存里。不渲染、不跳转、不提示。
 * 和文件管理的 useFileList 同一套做法，多了两件事：目录来自接口（会被新增、改名、删除），后端会修正越界的页码
 */
export function useResourceList() {
  const directoryQuery = useResourceDirectoryQuery();
  const yearsQuery = useResourceYearsQuery();
  const directoryId = ref<string | null>(null);
  const pageNum = ref(1);
  const pageSize = ref(20);
  const filterForm = reactive(emptyFilters());
  const appliedFilters = ref(emptyFilters());
  // 只能选二级目录；一级分组的 children 为 null 时（如"三区三线"）没有可选的目录
  const directories = computed(() => directoryQuery.data.value?.flatMap(group => group.children ?? []) ?? []);
  const selectedDirectory = computed(() => directories.value.find(node => node.id === directoryId.value) ?? null);

  // 首次加载、当前目录被删除时选第一个二级目录；没有时为 null，列表不请求
  watch(
    directories,
    nodes => {
      if (!nodes.some(node => node.id === directoryId.value)) {
        directoryId.value = nodes[0]?.id ?? null;
      }
    },
    { immediate: true, flush: 'sync' }
  );

  // 换目录或当前目录改了名（接口按名称查询）时清空筛选、回到第一页；别的目录变化不打断当前的筛选和翻页
  watch(
    () => [selectedDirectory.value?.id, selectedDirectory.value?.name] as const,
    ([id, name], [previousId, previousName]) => {
      if (id !== previousId || name !== previousName) {
        Object.assign(filterForm, emptyFilters());
        appliedFilters.value = emptyFilters();
        pageNum.value = 1;
      }
    },
    { flush: 'sync' }
  );

  const request = computed<ResourcePageRequest | null>(() => {
    const directory = selectedDirectory.value;
    if (!directory) {
      return null;
    }
    return {
      directoryId: directory.id,
      params: {
        resource: directory.name,
        pageNum: pageNum.value,
        pageSize: pageSize.value,
        // 空字符串表示不筛选，不传给后端；后端不去掉首尾空格
        layerName: appliedFilters.value.name.trim() || undefined,
        year: appliedFilters.value.year || undefined
      }
    };
  });
  const requestKey = computed(() => hashKey([request.value]));
  // 页码以外的条件（目录、筛选、每页条数），作为下面记录总数的键
  const conditionKey = computed(() => {
    const current = request.value;
    return hashKey([current && { ...current, params: { ...current.params, pageNum: undefined } }]);
  });
  const query = useResourcePageQuery(request);

  // 查询换 key 的当轮 data 还是上一个目录的结果：只显示同一目录的数据（同一目录内翻页、筛选时的占位照常显示）
  const displayedPage = computed(() => {
    const entry = query.data.value;
    const current = request.value;
    const sameDirectory =
      current !== null &&
      entry?.request?.directoryId === current.directoryId &&
      entry.request.params.resource === current.params.resource;
    return sameDirectory ? entry.page : undefined;
  });
  const resources = computed(() => displayedPage.value?.list ?? []);
  // 每组条件的总数，交给分页器时优先用它；理由同 useFileList：翻页失败或先显示旧缓存时，分页器会把页码压回去
  const knownTotals = reactive(new Map<string, number>());
  const total = computed(() => {
    if (!request.value) {
      return 0;
    }
    return knownTotals.get(conditionKey.value) ?? displayedPage.value?.total ?? 0;
  });

  // 当前条件的请求成功时：记下总数；后端把越界的页码修正成了最后一页时，页码跟过去。
  // 占位数据、上一组条件的结果不处理；请求还没结束或失败后保留的旧缓存只用来初始化总数，不修正页码
  watch(
    [query.data, query.isPlaceholderData, query.isFetching, query.isSuccess],
    ([entry, isPlaceholder, isFetching, isSuccess]) => {
      const current = request.value;
      if (!current || !entry || isPlaceholder || hashKey([entry.request]) !== requestKey.value) {
        return;
      }
      if (isFetching || !isSuccess) {
        if (!knownTotals.has(conditionKey.value)) {
          knownTotals.set(conditionKey.value, entry.page.total);
        }
        return;
      }
      knownTotals.set(conditionKey.value, entry.page.total);
      // 没有数据时 pages 是 0，仍停在第 1 页
      const returnedPage = Math.min(entry.page.pageNum, Math.max(entry.page.pages, 1));
      if (returnedPage !== pageNum.value) {
        query.rememberPage({ ...current, params: { ...current.params, pageNum: returnedPage } }, entry.page);
        pageNum.value = returnedPage;
      }
    },
    { immediate: true }
  );

  // 主动刷新中；只认这组条件、这一次刷新：前一次刷新结束时不能清掉后一次的标记
  const manualRefresh = shallowRef<{ key: string; pending: Promise<unknown> } | null>(null);
  watch(
    requestKey,
    () => {
      manualRefresh.value = null;
    },
    { flush: 'sync' }
  );
  // 两种加载状态的界面表现见 docs/modules/table.md
  const initialLoading = computed(() => request.value !== null && query.isLoading.value);
  const refreshing = computed(() => {
    if (displayedPage.value === undefined || initialLoading.value) {
      return false;
    }
    return query.isPlaceholderData.value || manualRefresh.value?.key === requestKey.value;
  });
  let disposed = false;
  onScopeDispose(() => {
    disposed = true;
    manualRefresh.value = null;
  });

  /** 重新请求当前条件，期间 refreshing 为 true；先等查询换上当前的 key：切目录的同一轮里调用时不能刷新旧目录 */
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
    // 条件没变时 key 也不变，查询不会重新请求；用户点"查询"是想看最新的数据
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
