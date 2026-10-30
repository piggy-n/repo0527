import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { required } from '@/shared/testing/required';
import type { StatisticsApi } from '../api';
import type { ReportCriteria, ReportRow, ReportStatus } from '../report';
import { overviewMatrix, TABLES } from '../statistics';
import { NEW_TASK_WAIT } from '../tracking';
import { REPORT_POLL_INTERVAL, type StatisticsReport, useStatisticsReport } from './useStatisticsReport';

const row = (name: string, status: ReportRow['status'], statusText: string): ReportRow => ({
  year: '2025',
  regionName: '江苏省',
  name,
  status,
  statusText,
  completeTime: null,
  cause: null
});

const OPTIONS = {
  tables: [
    { value: 'baseTable', label: '基本统计报表' },
    { value: 'summaryTable', label: '汇总统计报表' }
  ],
  levels: [
    { value: 'province', label: '省级' },
    { value: 'city', label: '市级' },
    { value: 'district', label: '区级' },
    { value: 'county', label: '县级' }
  ]
} as const satisfies Pick<ReportStatus, 'tables' | 'levels'>;

const BASE_YEARS = { change: '2024', water: '2024' };

const settled = (change: Partial<ReportStatus> = {}): ReportStatus => ({
  rows: [row('江苏省城基1-1表', 'completed', '处理成功'), row('江苏省城基1-2表', 'failed', '处理失败')],
  counts: { total: 2, completed: 1, failed: 1, processing: 0, notStarted: 0 },
  progress: 100,
  statusText: null,
  ...OPTIONS,
  ...change
});

const running = (): ReportStatus =>
  settled({
    rows: [row('江苏省城基1-1表', 'completed', '处理成功'), row('江苏省城基1-2表', 'processing', '正在处理')],
    counts: { total: 2, completed: 1, failed: 0, processing: 1, notStarted: 0 },
    progress: 50
  });

const empty = (): ReportStatus =>
  settled({ rows: [], counts: { total: 0, completed: 0, failed: 0, processing: 0, notStarted: 0 }, progress: null });

function host(fetchReport: StatisticsApi['fetchReport']) {
  const fetch = vi.fn<StatisticsApi['fetchReport']>(fetchReport);
  const api: StatisticsApi = {
    fetchOverview: () => Promise.resolve(new Map()),
    fetchReport: fetch,
    createTasks: () => Promise.resolve()
  };
  let owner: StatisticsReport | undefined;
  const Host = defineComponent({
    setup() {
      owner = useStatisticsReport({ api });
      return () => null;
    }
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mount(Host, { global: { plugins: [[VueQueryPlugin, { queryClient }]] } });
  return { report: required(owner, '报表的拥有者'), fetch };
}

const criteriaOf = (calls: readonly (readonly [ReportCriteria, AbortSignal?])[]) =>
  calls.map(([criteria]) => `${criteria.year}/${criteria.table}/${criteria.level}`);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 28, 9, 0, 0));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useStatisticsReport', () => {
  it('默认查上一年的基本统计省级；条件不在后端给的选项里时换成第一个可选的，选项随查询更新', async () => {
    const { report, fetch } = host(({ year }) =>
      Promise.resolve(
        year === '2026'
          ? { ...empty(), tables: [OPTIONS.tables[0]], levels: [OPTIONS.levels[3]] }
          : settled()
      )
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(report.status.value?.counts.total).toBe(2);
    expect(report.tableOptions.value.map(option => option.value)).toEqual(['baseTable', 'summaryTable']);

    report.setTable('summaryTable');
    expect(report.levelOptions.value.map(option => option.value)).toEqual(['province', 'city']);

    report.setYear('2026');
    await vi.advanceTimersByTimeAsync(0);
    expect(report.criteria.value).toEqual({ year: '2026', table: 'baseTable', level: 'county', baseYear: null });
    // 同一轮里先换报表再换年份，中间的 2025 年汇总统计不会请求
    expect(criteriaOf(fetch.mock.calls)).toEqual([
      '2025/baseTable/province',
      '2026/summaryTable/province',
      '2026/baseTable/county'
    ]);
    expect(report.levelOptions.value.map(option => option.value)).toEqual(['county']);
  });

  it('没处理完时每 5 秒查一次，处理完就停；查询中、等下一次时显示在查询', async () => {
    let round = 0;
    const { report, fetch } = host(() => Promise.resolve(++round < 3 ? running() : settled()));
    await vi.advanceTimersByTimeAsync(0);
    expect(report.polling.value).toBe(true);
    expect(report.activity.value).toBe('processing');

    await vi.advanceTimersByTimeAsync(REPORT_POLL_INTERVAL * 2);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(report.status.value?.progress).toBe(100);
    expect(report.polling.value).toBe(false);

    await vi.advanceTimersByTimeAsync(REPORT_POLL_INTERVAL * 3);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('查询失败时提示原因，按 5、10 秒重试，连续 3 次停下；重新查询后恢复', async () => {
    let fails = true;
    const { report, fetch } = host(() => (fails ? Promise.reject(new Error('查询失败')) : Promise.resolve(settled())));
    await vi.advanceTimersByTimeAsync(0);
    expect(report.notice.value).toEqual({ type: 'error', text: '查询失败', retry: true });

    await vi.advanceTimersByTimeAsync(REPORT_POLL_INTERVAL);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(REPORT_POLL_INTERVAL * 2);
    expect(fetch).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(REPORT_POLL_INTERVAL * 10);
    expect(fetch).toHaveBeenCalledTimes(3);

    fails = false;
    report.retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(report.notice.value).toBeNull();
    expect(report.status.value?.counts.total).toBe(2);
  });

  it('提交后切到第一项、提示等待；查到在处理时不再提示，处理完后跟踪结束、停止查询', async () => {
    let stage: 'before' | 'empty' | 'running' | 'done' = 'before';
    const { report } = host(({ level }) => {
      if (level !== 'city' || stage === 'before') {
        return Promise.resolve(settled());
      }
      return Promise.resolve({ empty: empty(), running: running(), done: settled() }[stage]);
    });
    await vi.advanceTimersByTimeAsync(0);

    const tracking = report.trackSubmission('2025', BASE_YEARS, [
      { target: { table: 'baseTable', level: 'city' }, recompute: false },
      { target: { table: 'summaryTable', level: 'city' }, recompute: false }
    ]);
    expect(report.criteria.value).toEqual({ year: '2025', table: 'baseTable', level: 'city', baseYear: null });
    expect(report.run.value).toBe(1);
    expect(report.activity.value).toBe('submitting');
    expect(report.isTracking({ year: '2025', table: 'summaryTable', level: 'city', baseYear: null })).toBe(true);

    stage = 'empty';
    tracking.accept();
    await vi.advanceTimersByTimeAsync(0);
    expect(report.notice.value?.text).toBe(
      '已提交 2 项统计分析请求，当前查看（基本统计报表 / 市级 / 2025年），正在等待任务生成，请稍候...'
    );
    expect(report.hasActiveTracking('2025')).toBe(true);

    stage = 'running';
    await vi.advanceTimersByTimeAsync(REPORT_POLL_INTERVAL);
    expect(report.notice.value).toBeNull();
    expect(report.activity.value).toBe('processing');

    stage = 'done';
    await vi.advanceTimersByTimeAsync(REPORT_POLL_INTERVAL);
    expect(report.isTracking({ year: '2025', table: 'baseTable', level: 'city', baseYear: null })).toBe(false);
    expect(report.polling.value).toBe(false);
  });

  it('新统计等到截止还没查到任务就超时，提示后可以重新查询', async () => {
    const { report } = host(({ level }) => Promise.resolve(level === 'county' ? empty() : settled()));
    await vi.advanceTimersByTimeAsync(0);
    report
      .trackSubmission('2025', BASE_YEARS, [{ target: { table: 'baseTable', level: 'county' }, recompute: false }])
      .accept();
    await vi.advanceTimersByTimeAsync(NEW_TASK_WAIT + REPORT_POLL_INTERVAL);

    expect(report.notice.value).toMatchObject({ type: 'warning', retry: true });
    expect(report.polling.value).toBe(false);
    report.retry();
    expect(report.notice.value).toBeNull();
  });

  it('创建被拒绝时提示原因；没有明确结果时提示继续跟踪', async () => {
    const { report } = host(() => Promise.resolve(empty()));
    await vi.advanceTimersByTimeAsync(0);
    report
      .trackSubmission('2025', BASE_YEARS, [{ target: { table: 'baseTable', level: 'province' }, recompute: false }])
      .reject('已有统计任务在执行', false);
    expect(report.notice.value).toEqual({ type: 'error', text: '已有统计任务在执行', retry: true });

    report
      .trackSubmission('2025', BASE_YEARS, [{ target: { table: 'baseTable', level: 'province' }, recompute: false }])
      .reject('网络异常', true);
    expect(report.notice.value?.type).toBe('warning');
    expect(report.activity.value).toBe('confirming');
  });

  it('变化类报表按自己的本底年份查：换报表时跟着报表取，换监测年份时回到上一年；本底年份要早于监测年份', async () => {
    const tables = TABLES.map(table => ({ value: table.type, label: table.name }));
    const { report, fetch } = host(() => Promise.resolve(settled({ tables })));
    await vi.advanceTimersByTimeAsync(0);

    report.setTable('baseChangeTable');
    expect(report.criteria.value).toEqual({
      year: '2025',
      table: 'baseChangeTable',
      level: 'province',
      baseYear: '2024'
    });
    report.setBaseYear('2022');
    report.setTable('entityChangeTable');
    expect(report.criteria.value.baseYear).toBe('2022');
    report.setTable('changeWaterTable');
    expect(report.criteria.value.baseYear).toBe('2024');
    report.setTable('baseTable');
    expect(report.criteria.value.baseYear).toBeNull();
    expect(() => report.setBaseYear('2023')).toThrow('基本统计报表没有本底年份');

    report.setTable('baseChangeTable');
    expect(() => report.setBaseYear('2025')).toThrow(RangeError);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch.mock.calls.at(-1)?.[0]).toEqual({
      year: '2025',
      table: 'baseChangeTable',
      level: 'province',
      baseYear: '2022'
    });

    report.setYear('2027');
    expect(report.baseYears.value).toEqual({ change: '2026', water: '2026' });
    expect(report.criteria.value.baseYear).toBe('2026');
  });

  it('提交后查看的本底年份换成提交的，各项按自己的本底年份跟踪', async () => {
    const { report } = host(() => Promise.resolve(empty()));
    await vi.advanceTimersByTimeAsync(0);

    report.trackSubmission('2025', { change: '2022', water: '2023' }, [
      { target: { table: 'changeWaterTable', level: 'district' }, recompute: false },
      { target: { table: 'baseChangeTable', level: 'city' }, recompute: false }
    ]);
    expect(report.baseYears.value).toEqual({ change: '2022', water: '2023' });
    expect(report.criteria.value).toEqual({
      year: '2025',
      table: 'changeWaterTable',
      level: 'district',
      baseYear: '2023'
    });
    expect(report.isTracking({ year: '2025', table: 'baseChangeTable', level: 'city', baseYear: '2022' })).toBe(true);
    expect(report.isTracking({ year: '2025', table: 'baseChangeTable', level: 'city', baseYear: '2024' })).toBe(false);
  });

  it('状态筛选可以多选，换条件后回到全部', async () => {
    const { report } = host(() => Promise.resolve(settled()));
    await vi.advanceTimersByTimeAsync(0);

    report.toggleStatus('failed');
    expect(report.rows.value.map(item => item.name)).toEqual(['江苏省城基1-2表']);
    report.toggleStatus('completed');
    expect(report.rows.value).toHaveLength(2);
    report.toggleStatus(null);
    expect(report.statusFilter.value.size).toBe(0);

    report.toggleStatus('failed');
    report.setLevel('city');
    expect(report.statusFilter.value.size).toBe(0);
  });

  it('初次进入时当前组合没有结果就落到总览里第一个有结果的；用户先动过条件就不再落', async () => {
    const matrix = overviewMatrix(new Map([['summaryTable:province', '处理失败']]));
    const first = host(() => Promise.resolve(settled()));
    await vi.advanceTimersByTimeAsync(0);
    first.report.focusFirstResult(matrix);
    expect(first.report.criteria.value).toMatchObject({ table: 'summaryTable', level: 'province' });

    const second = host(() => Promise.resolve(settled()));
    await vi.advanceTimersByTimeAsync(0);
    second.report.setLevel('city');
    await vi.advanceTimersByTimeAsync(0);
    second.report.focusFirstResult(matrix);
    expect(second.report.criteria.value).toMatchObject({ table: 'baseTable', level: 'city' });
  });
});
