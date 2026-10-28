import { vi } from 'vitest';
import { computed, shallowRef } from 'vue';
import type { StatisticsReport } from '../composables/useStatisticsReport';
import type { ReportCriteria, ReportRow, ReportStatus } from '../report';
import type { TaskStatus } from '../statistics';
import type { ReportNotice } from '../tracking';

/** 组件测试用的报表拥有者：状态直接设，操作都是 vi.fn；只给面板读的那些值 */
export function fakeReport(initial: ReportStatus | null) {
  const status = shallowRef(initial);
  const notice = shallowRef<ReportNotice | null>(null);
  const filter = shallowRef<ReadonlySet<TaskStatus>>(new Set());
  const criteria = shallowRef<ReportCriteria>({ year: '2025', table: 'baseTable', level: 'province' });
  const report: StatisticsReport = {
    criteria,
    tableOptions: computed(() => status.value?.tables ?? []),
    levelOptions: computed(() => status.value?.levels ?? []),
    status: computed(() => status.value),
    loading: computed(() => false),
    polling: computed(() => false),
    activity: computed(() => 'querying'),
    updatedAt: computed(() => '09:00:00'),
    notice: computed(() => notice.value),
    statusFilter: filter,
    rows: computed((): ReportRow[] => [...(status.value?.rows ?? [])]),
    run: shallowRef(0),
    setYear: vi.fn<StatisticsReport['setYear']>(),
    setTable: vi.fn<StatisticsReport['setTable']>(),
    setLevel: vi.fn<StatisticsReport['setLevel']>(),
    select: vi.fn<StatisticsReport['select']>(),
    toggleStatus: vi.fn<StatisticsReport['toggleStatus']>(),
    retry: vi.fn<StatisticsReport['retry']>(),
    trackSubmission: vi.fn<StatisticsReport['trackSubmission']>(),
    isTracking: () => false,
    hasActiveTracking: () => false,
    focusFirstResult: vi.fn<StatisticsReport['focusFirstResult']>()
  };
  return { report, status, notice, filter };
}

export const reportRow = (name: string, status: TaskStatus, statusText: string, cause: string | null = null): ReportRow => ({
  year: '2025',
  regionName: '江苏省',
  name,
  status,
  statusText,
  completeTime: status === 'completed' ? '2026-10-17 10:20:19' : null,
  cause
});

export const reportStatus = (rows: readonly ReportRow[]): ReportStatus => ({
  rows,
  counts: {
    total: rows.length,
    completed: rows.filter(row => row.status === 'completed').length,
    failed: rows.filter(row => row.status === 'failed').length,
    processing: rows.filter(row => row.status === 'processing').length,
    notStarted: rows.filter(row => row.status === 'notStarted').length
  },
  progress: null,
  statusText: null,
  tables: [{ value: 'baseTable', label: '基本统计报表' }],
  levels: [{ value: 'province', label: '省级' }]
});
