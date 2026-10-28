import { type QueryState, useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import type { ReportCriteria, ReportStatus } from './report';
import type { OverviewStatuses } from './statistics';

/** 统计页的 query key 只在这里拼 */
export const statisticsKeys = {
  all: ['monitoring-statistics'] as const,
  overview: (year: string) => [...statisticsKeys.all, 'overview', year] as const,
  report: ({ year, table, level }: ReportCriteria) => [...statisticsKeys.all, 'report', year, table, level] as const
};

/** 一年的总览和它的年份：换年份后 data 要到下一轮调度才换成新的，用 year 判断是不是当前年份的 */
export interface OverviewData {
  readonly year: string;
  readonly statuses: OverviewStatuses;
}

/**
 * 总览矩阵的状态；请求和按间隔跟进由拥有者给出（处理中时 30 秒一次），标签页隐藏时不查（refetchIntervalInBackground 默认关）
 */
export function useOverviewQuery(
  year: () => string,
  fetchOverview: (year: string, signal: AbortSignal) => Promise<OverviewStatuses>,
  refetchInterval: (state: QueryState<OverviewData>) => number | false
) {
  return useQuery({
    queryKey: computed(() => statisticsKeys.overview(year())),
    queryFn: async ({ signal }): Promise<OverviewData> => {
      const current = year();
      return { year: current, statuses: await fetchOverview(current, signal) };
    },
    refetchInterval: query => refetchInterval(query.state)
  });
}

/** 一份报表的状态和它的查看条件 */
export interface ReportData {
  readonly criteria: ReportCriteria;
  readonly status: ReportStatus;
}

/** 当前报表的状态；请求和按间隔查都由拥有者给出（它要数连续失败的次数） */
export function useReportQuery(
  criteria: () => ReportCriteria,
  fetchReport: (criteria: ReportCriteria, signal: AbortSignal) => Promise<ReportStatus>,
  refetchInterval: (state: QueryState<ReportData>) => number | false
) {
  return useQuery({
    queryKey: computed(() => statisticsKeys.report(criteria())),
    queryFn: async ({ signal }): Promise<ReportData> => {
      const current = criteria();
      return { criteria: current, status: await fetchReport(current, signal) };
    },
    refetchInterval: query => refetchInterval(query.state)
  });
}
