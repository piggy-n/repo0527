import { computed } from 'vue';
import { usePagedList } from '@/shared/table/usePagedList';
import type { ApplicationFilters } from '../api';
import { useApplicationPageQuery } from '../queries';

const emptyFilters = (): ApplicationFilters => ({ name: '', status: '', prepare: '' });

/** 申请列表的界面状态：筛选、分页以及它们之间的联动（shared/table 的 usePagedList），名称去掉首尾空格 */
export function useApplicationList() {
  const list = usePagedList({
    emptyFilters,
    normalize: filters => ({ ...filters, name: filters.name.trim() }),
    useQuery: useApplicationPageQuery
  });
  const applications = computed(() => list.page.value?.list ?? []);
  return { ...list, applications };
}
