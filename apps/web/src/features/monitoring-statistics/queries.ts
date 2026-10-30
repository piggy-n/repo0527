import { type QueryState, useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import type { ReportCriteria, ReportStatus } from './report';
import type { BaseYears, OverviewStatuses } from './statistics';

/** 统计页的 query key 只在这里拼 */
export const statisticsKeys = {
  all: ['monitoring-statistics'] as const,
  overview: (year: string, { change, water }: BaseYears) =>
    [...statisticsKeys.all, 'overview', year, change, water] as const,
  report: ({ year, table, level, baseYear }: ReportCriteria) =>
    [...statisticsKeys.all, 'report', year, table, level, baseYear] as const
};

/** 总览的查询条件：年份和两个本底年份 */
export interface OverviewCriteria {
  readonly year: string;
  readonly baseYears: BaseYears;
}

/** 一年的总览和它的条件：换条件后 data 要到下一轮调度才换成新的，用 criteria 判断是不是当前条件的 */
export interface OverviewData {
  readonly criteria: OverviewCriteria;
  readonly statuses: OverviewStatuses;
}

/**
 * 总览矩阵的状态；请求和按间隔跟进由拥有者给出（处理中时 30 秒一次），标签页隐藏时不查（refetchIntervalInBackground 默认关）
 */
export function useOverviewQuery(
  criteria: () => OverviewCriteria,
  fetchOverview: (criteria: OverviewCriteria, signal: AbortSignal) => Promise<OverviewStatuses>,
  refetchInterval: (state: QueryState<OverviewData>) => number | false
) {
  return useQuery({
    queryKey: computed(() => statisticsKeys.overview(criteria().year, criteria().baseYears)),
    queryFn: async ({ signal }): Promise<OverviewData> => {
      const current = criteria();
      return { criteria: current, statuses: await fetchOverview(current, signal) };
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
