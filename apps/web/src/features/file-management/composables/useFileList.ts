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
  const files = computed(() => query.data.value?.content ?? []);
  const total = computed(() => query.data.value?.totalElements ?? 0);

  // 页码越界时后端返回最后一页的数据但不修正页码（例如删掉了最后一页的最后一条），这里改到最后一页
  // 只看拿到的数据：出错时 data 会变成 undefined，那时不应改动页码
  watch(query.data, page => {
    if (!page) {
      return;
    }
    // 没有数据时 totalPages 是 0，仍停在第 1 页
    const lastPage = Math.max(page.totalPages, 1);
    if (pageNo.value > lastPage) {
      pageNo.value = lastPage;
    }
  });

  function selectCategory(id: string) {
    categoryId.value = id;
    pageNo.value = 1;
  }

  function search() {
    appliedFilters.value = { ...filterForm };
    pageNo.value = 1;
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
    // 首次加载和后台刷新都算，界面用它显示加载状态（用 useDelayedFlag 延迟显示）
    loading: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
    selectCategory,
    search,
    resetFilters,
    changePageSize
  };
}
