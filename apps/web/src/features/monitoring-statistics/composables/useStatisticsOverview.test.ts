import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import { required } from '@/shared/testing/required';
import type { StatisticsApi } from '../api';
import type { OverviewStatuses } from '../statistics';
import { OVERVIEW_FOLLOW_INTERVAL, type StatisticsOverview, useStatisticsOverview } from './useStatisticsOverview';

const statuses = (entries: [string, string | null][]): OverviewStatuses => new Map(entries);

function host(fetchOverview: StatisticsApi['fetchOverview']) {
  const fetch = vi.fn<StatisticsApi['fetchOverview']>(fetchOverview);
  const following = ref(false);
  const year = ref('2025');
  let owner: StatisticsOverview | undefined;
  const Host = defineComponent({
    setup() {
      owner = useStatisticsOverview({
        api: { fetchOverview: fetch, fetchReport: () => Promise.reject(new Error('不用')), createTasks: () => Promise.resolve() },
        year: () => year.value,
        following: () => following.value
      });
      return () => null;
    }
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mount(Host, { global: { plugins: [[VueQueryPlugin, { queryClient }]] } });
  return { overview: required(owner, '总览的拥有者'), fetch, following, year };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useStatisticsOverview', () => {
  it('有处理中的组合时每 30 秒跟进，没有就停', async () => {
    let round = 0;
    const { overview, fetch } = host(() =>
      Promise.resolve(statuses([['baseTable:city', ++round < 2 ? '正在处理' : '处理成功']]))
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(overview.ready.value).toBe(true);
    expect(overview.rows.value[0]?.cells[1]).toMatchObject({ kind: 'processing' });

    await vi.advanceTimersByTimeAsync(OVERVIEW_FOLLOW_INTERVAL);
    expect(overview.rows.value[0]?.cells[1]).toMatchObject({ kind: 'completed', text: '处理成功' });
    await vi.advanceTimersByTimeAsync(OVERVIEW_FOLLOW_INTERVAL * 3);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('这一年有刚提交还在跟踪的组合时也跟进', async () => {
    const { fetch, following } = host(() => Promise.resolve(statuses([])));
    following.value = true;
    await vi.advanceTimersByTimeAsync(OVERVIEW_FOLLOW_INTERVAL * 2);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('换年份前先按未处理显示，不显示上一年的；失败时给出原因', async () => {
    const { overview, year } = host(target =>
      target === '2025' ? Promise.resolve(statuses([['baseTable:province', '处理成功']])) : Promise.reject(new Error('总览获取失败'))
    );
    await vi.advanceTimersByTimeAsync(0);
    year.value = '2026';
    expect(overview.ready.value).toBe(false);
    expect(overview.rows.value[0]?.cells[0]).toMatchObject({ kind: 'notStarted' });
    await vi.advanceTimersByTimeAsync(0);
    expect(overview.error.value).toBe('总览获取失败');
  });
});
