import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, type MaybeRefOrGetter, toValue } from 'vue';
import { fetchReportPage, type ReportPage, type ReportPageParams } from './api';

/** 统计报表的 query key 只在这里拼 */
export const reportKeys = {
  all: ['statistics-report'] as const,
  pages: () => [...reportKeys.all, 'page'] as const,
  page: (params: ReportPageParams) => [...reportKeys.pages(), params] as const
};

/**
 * 统计报表的一页；换条件、翻页时保留上一次的数据，由表格显示遮罩（docs/modules/table.md）。
 * rememberPage 把后端修正过页码的结果记到修正后的页上，页码跟过去时不再请求一次
 */
export function useReportPageQuery(params: MaybeRefOrGetter<ReportPageParams>) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: computed(() => reportKeys.page(toValue(params))),
    // 参数从 key 里取，请求用的参数和缓存的 key 一定一致
    queryFn: ({ queryKey: [, , page], signal }) => fetchReportPage(page, signal),
    placeholderData: keepPreviousData
  });

  function rememberPage(pageParams: ReportPageParams, page: ReportPage) {
    queryClient.setQueryData(reportKeys.page(pageParams), page);
  }

  return { ...query, rememberPage };
}
