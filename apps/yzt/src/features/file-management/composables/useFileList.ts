import { hashKey } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import type { FilePageParams } from '../api';
import { DEFAULT_CATEGORY_ID } from '../categories';
import { useFilePageQuery } from '../queries';

/** 筛选表单的值，空字符串表示不按这一项筛选 */
export interface FileFilters {
  name: string;
  year: string;
  tag: string;
}

const emptyFilters = (): FileFilters => ({ name: '', year: '', tag: '' });

/** 文件列表的界面状态：当前分类、筛选、分页，以及它们之间的联动；不渲染、不弹提示 */
export function useFileList() {
  const categoryId = ref(DEFAULT_CATEGORY_ID);
  const pageNo = ref(1);
  const pageSize = ref(20);
  // 表单里正在编辑的条件，点"查询"后才生效
  const filterForm = reactive(emptyFilters());
  const appliedFilters = ref(emptyFilters());

  const params = computed<FilePageParams>(() => ({
    categoryId: categoryId.value,
    pageNo: pageNo.value,
    pageSize: pageSize.value,
    // 空字符串表示不筛选，不传给后端；后端不去掉首尾空格
    name: appliedFilters.value.name.trim() || undefined,
    year: appliedFilters.value.year || undefined,
    tag: appliedFilters.value.tag || undefined
  }));

  const query = useFilePageQuery(params);
  // 页码以外的条件（分类、筛选、每页条数），作为下面记录总数的键；undefined 的字段序列化时被忽略
  const conditionKey = computed(() => hashKey([{ ...params.value, pageNo: undefined }]));
  // 每组条件的总数，交给分页器时优先用它：翻页请求失败时没有数据，跳回缓存过的页时先显示的是旧缓存（总数可能偏小），
  // 这两种情况下分页器都会把页码压回去。请求成功时更新；还没有时先用缓存初始化（例如重新进入列表）
  const knownTotals = reactive(new Map<string, number>());

  const files = computed(() => query.data.value?.content ?? []);
  // 换条件时先显示上一组条件的数据占位，总数也暂用它的；都没有时为 0
  const total = computed(() => knownTotals.get(conditionKey.value) ?? query.data.value?.totalElements ?? 0);

  // 主动刷新中；连续点击时 Vue Query 取消前一次请求，前一次的 refetch 会等最新的请求完成才结束
  const manualRefreshing = ref(false);
  // 没有可显示的数据且正在请求（Vue Query 的 isLoading）：首次加载、切到没看过的分类、失败后重试
  const initialLoading = query.isLoading;
  // 显示着旧数据、正在等新数据：翻页或换条件时上一次的数据占位，或者主动刷新。
  // 后台重新请求当前条件的缓存（切回看过的分类、删除后刷新）不算，数据到了直接替换
  const refreshing = computed(() => !initialLoading.value && (query.isPlaceholderData.value || manualRefreshing.value));

  // 当前条件的请求成功时：记下总数；页码越界时改到最后一页（后端对越界的页码返回最后一页的数据，
  // 但不修正页码，例如删掉了最后一页的最后一条）。占位数据属于上一组条件，不处理；
  // 其他时候显示的是缓存（请求还没结束，或者请求失败后 Vue Query 保留的旧数据），总页数可能已经过时，
  // 只在这组条件还没有总数时用来初始化，不修正页码。
  // 请求成功时数据可能和缓存一样（Vue Query 复用原对象，data 不变），所以同时看请求状态
  watch(
    [query.data, query.isPlaceholderData, query.isFetching, query.isSuccess],
    ([page, isPlaceholder, isFetching, isSuccess]) => {
      if (!page || isPlaceholder) {
        return;
      }
      if (isFetching || !isSuccess) {
        if (!knownTotals.has(conditionKey.value)) {
          knownTotals.set(conditionKey.value, page.totalElements);
        }
        return;
      }
      knownTotals.set(conditionKey.value, page.totalElements);
      // 没有数据时 totalPages 是 0，仍停在第 1 页
      const lastPage = Math.max(page.totalPages, 1);
      if (pageNo.value > lastPage) {
        pageNo.value = lastPage;
      }
    },
    { immediate: true }
  );

  function selectCategory(id: string) {
    categoryId.value = id;
    pageNo.value = 1;
  }

  /** 重新请求当前条件，请求期间 refreshing 为 true */
  async function refresh() {
    manualRefreshing.value = true;
    await query.refetch();
    manualRefreshing.value = false;
  }

  function search() {
    const previous = hashKey([params.value]);
    appliedFilters.value = { ...filterForm };
    pageNo.value = 1;
    // 条件没变时查询键也不变，Vue Query 不会重新请求；用户点"查询"是想看最新的数据
    if (hashKey([params.value]) === previous) {
      void refresh();
    }
  }

  function resetFilters() {
    Object.assign(filterForm, emptyFilters());
    search();
  }

  function changePageSize(size: number) {
    pageSize.value = size;
    pageNo.value = 1;
  }

  return {
    categoryId,
    pageNo,
    pageSize,
    filterForm,
    files,
    total,
    // 两种加载状态的界面表现见 docs/modules/table.md
    initialLoading,
    refreshing,
    isError: query.isError,
    refresh,
    selectCategory,
    search,
    resetFilters,
    changePageSize
  };
}
