import { computed } from 'vue';
import { usePagedList } from '@/shared/table/usePagedList';
import type { ReportFilters } from '../api';
import { useReportPageQuery } from '../queries';

const emptyFilters = (): ReportFilters => ({ name: '' });

/** 统计报表列表的界面状态：按名称筛选、分页（shared/table 的 usePagedList），名称去掉首尾空格 */
export function useReportList() {
  const list = usePagedList({
    emptyFilters,
    normalize: filters => ({ name: filters.name.trim() }),
    useQuery: useReportPageQuery
  });
  const reports = computed(() => list.page.value?.list ?? []);
  return { ...list, reports };
}
