import { CancelledError } from '@tanstack/vue-query';
import { computed, type ComputedRef, getCurrentScope } from 'vue';
import type { StatisticsApi } from '../api';
import { useOverviewQuery } from '../queries';
import { hasProcessing, overviewMatrix, type OverviewRow } from '../statistics';

/** 有处理中的组合、或有刚提交还没结束的跟踪时，总览跟进的间隔（同旧页面） */
export const OVERVIEW_FOLLOW_INTERVAL = 30_000;
/** 连续失败几次后不再自动重试 */
export const OVERVIEW_MAX_FAILURES = 3;

export interface StatisticsOverview {
  /** 当前年份的矩阵；还没取到时各组合按未处理显示 */
  readonly rows: ComputedRef<readonly OverviewRow[]>;
  /** 取到的是当前年份的：初次进入时据此落到有结果的组合 */
  readonly ready: ComputedRef<boolean>;
  readonly loading: ComputedRef<boolean>;
  /** 最近一次请求失败的原因 */
  readonly error: ComputedRef<string | null>;
  /** 最近一次取到当前年份的时刻（HH:mm:ss） */
  readonly updatedAt: ComputedRef<string | null>;
  readonly refresh: () => void;
}

export interface StatisticsOverviewOptions {
  readonly api: StatisticsApi;
  /** 总览跟着查看条件的年份 */
  readonly year: () => string;
  /** 这一年有刚提交、还在跟踪的组合：后台可能还没显示处理中，也要跟进 */
  readonly following: () => boolean;
}

const timeOf = (timestamp: number) => new Date(timestamp).toLocaleTimeString('zh-CN', { hour12: false });

/** 报表统计计算总览的拥有者：一年里各报表、各等级的状态，由查询缓存持有 */
export function useStatisticsOverview({ api, year, following }: StatisticsOverviewOptions): StatisticsOverview {
  if (!getCurrentScope()) {
    throw new Error('useStatisticsOverview 只能在组件的 setup 或 effectScope 中调用');
  }
  let failures = 0;
  const fetchOverview = async (target: string, signal: AbortSignal) => {
    try {
      const statuses = await api.fetchOverview(target, signal);
      failures = 0;
      return statuses;
    } catch (error) {
      if (!signal.aborted && !(error instanceof CancelledError)) {
        failures++;
      }
      throw error;
    }
  };

  const query = useOverviewQuery(year, fetchOverview, state => {
    if (state.status === 'error') {
      // 失败后按 30、60 秒退避重试，连续 3 次停下（同旧页面）
      return failures < OVERVIEW_MAX_FAILURES ? OVERVIEW_FOLLOW_INTERVAL * failures : false;
    }
    const data = state.data;
    if (data === undefined) {
      return false;
    }
    return hasProcessing(overviewMatrix(data.statuses)) || following() ? OVERVIEW_FOLLOW_INTERVAL : false;
  });

  const current = computed(() => {
    const data = query.data.value;
    return data?.year === year() ? data : null;
  });

  return {
    rows: computed(() => overviewMatrix(current.value?.statuses ?? null)),
    ready: computed(() => current.value !== null),
    loading: computed(() => query.isFetching.value),
    error: computed(() =>
      query.isError.value ? query.error.value?.message || '报表计算总览获取失败，请稍后重试' : null
    ),
    updatedAt: computed(() => (current.value === null ? null : timeOf(query.dataUpdatedAt.value))),
    refresh: () => {
      failures = 0;
      void query.refetch();
    }
  };
}
