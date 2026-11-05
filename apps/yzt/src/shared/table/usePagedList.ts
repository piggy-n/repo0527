import { hashKey } from '@tanstack/vue-query';
import { computed, type ComputedRef, reactive, type Ref, ref, type ShallowRef, shallowRef, watch } from 'vue';

export interface PageParams {
  pageNum: number;
  pageSize: number;
}

/** PageHelper 分页结果里用得到的字段 */
export interface PagedResult {
  total: number;
  pageNum: number;
  pages: number;
}

/** 分页查询要提供的状态和操作，对应 Vue Query 的 useQuery 的返回值，再加上 rememberPage */
export interface PagedQuery<Params, Page extends PagedResult> {
  data: Readonly<Ref<Page | undefined>>;
  isPlaceholderData: Readonly<Ref<boolean>>;
  isFetching: Readonly<Ref<boolean>>;
  isSuccess: Readonly<Ref<boolean>>;
  isLoading: Readonly<Ref<boolean>>;
  isError: Readonly<Ref<boolean>>;
  refetch: () => Promise<unknown>;
  /** 把后端修正过页码的结果记到修正后的页上，页码跟过去时不再请求一次 */
  rememberPage: (params: Params, page: Page) => void;
}

export interface PagedListOptions<Filters extends object, Page extends PagedResult> {
  emptyFilters: () => Filters;
  /** 点"查询"时整理条件（如名称去掉首尾空格，后端不处理） */
  normalize: (filters: Filters) => Filters;
  /** 由 feature 的查询提供；参数里是生效的条件、页码和每页条数 */
  useQuery: (params: ComputedRef<Filters & PageParams>) => PagedQuery<Filters & PageParams, Page>;
}

/**
 * 后端是 PageHelper 的列表（系统管理的申请、统计报表）：筛选、分页以及它们之间的联动，接口数据只在查询缓存里。
 * 不渲染、不跳转、不提示。做法和文件管理的 useFileList 相同；页码越界时后端改成最后一页并返回那一页，
 * 没有数据时原样返回请求的页码、pages 是 0（2026-10-27 实测），页码跟着后端修正（同资源管理的 useResourceList）
 */
export function usePagedList<Filters extends object, Page extends PagedResult>(
  options: PagedListOptions<Filters, Page>
) {
  const pageNum = ref(1);
  const pageSize = ref(20);
  // 表单里正在编辑的条件，点"查询"后才生效。条件是普通的值（字符串），reactive 解包后的类型就是 Filters
  const filterForm = reactive(options.emptyFilters()) as Filters;
  const appliedFilters: ShallowRef<Filters> = shallowRef(options.emptyFilters());

  // 条件加上页码；泛型对象展开后的类型推不出来，写明
  const withPage = (filters: Filters, page: number): Filters & PageParams => ({
    ...filters,
    pageNum: page,
    pageSize: pageSize.value
  });
  const params = computed(() => withPage(appliedFilters.value, pageNum.value));

  const query = options.useQuery(params);
  // 页码以外的条件（筛选、每页条数），作为下面记录总数的键
  const conditionKey = computed(() => hashKey([{ ...params.value, pageNum: undefined }]));
  // 每组条件的总数，交给分页器时优先用它；理由同 useFileList：翻页失败或先显示旧缓存时，分页器会把页码压回去
  const knownTotals = reactive(new Map<string, number>());

  const page = computed(() => query.data.value);
  // 换条件时先显示上一组条件的数据占位，总数也暂用它的；都没有时为 0
  const total = computed(() => knownTotals.get(conditionKey.value) ?? query.data.value?.total ?? 0);

  // 主动刷新中；连续点击时 Vue Query 取消前一次请求，前一次的 refetch 会等最新的请求完成才结束
  const manualRefreshing = ref(false);
  // 两种加载状态的界面表现见 docs/modules/table.md
  const initialLoading = computed(() => query.isLoading.value);
  const refreshing = computed(() => !initialLoading.value && (query.isPlaceholderData.value || manualRefreshing.value));

  // 当前条件的请求成功时：记下总数，后端改了页码时跟过去（没有数据时回到第 1 页）。
  // 占位数据属于上一组条件，不处理；请求还没结束或失败后保留的旧缓存只用来初始化总数，不修正页码
  watch(
    [query.data, query.isPlaceholderData, query.isFetching, query.isSuccess],
    ([result, isPlaceholder, isFetching, isSuccess]) => {
      if (!result || isPlaceholder) {
        return;
      }
      if (isFetching || !isSuccess) {
        if (!knownTotals.has(conditionKey.value)) {
          knownTotals.set(conditionKey.value, result.total);
        }
        return;
      }
      knownTotals.set(conditionKey.value, result.total);
      const returnedPage = Math.min(result.pageNum, Math.max(result.pages, 1));
      if (returnedPage !== pageNum.value) {
        query.rememberPage(withPage(appliedFilters.value, returnedPage), result);
        pageNum.value = returnedPage;
      }
    },
    { immediate: true }
  );

  /** 重新请求当前条件，请求期间 refreshing 为 true */
  async function refresh() {
    manualRefreshing.value = true;
    await query.refetch();
    manualRefreshing.value = false;
  }

  function search() {
    const previous = hashKey([params.value]);
    appliedFilters.value = options.normalize({ ...filterForm });
    pageNum.value = 1;
    // 条件没变时查询键也不变，Vue Query 不会重新请求；用户点"查询"是想看最新的数据
    if (hashKey([params.value]) === previous) {
      void refresh();
    }
  }

  function resetFilters() {
    Object.assign(filterForm, options.emptyFilters());
    search();
  }

  function changePageSize(size: number) {
    pageSize.value = size;
    pageNum.value = 1;
  }

  return {
    filterForm,
    pageNum,
    pageSize,
    page,
    total,
    initialLoading,
    refreshing,
    isError: query.isError,
    refresh,
    search,
    resetFilters,
    changePageSize
  };
}
