// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  hasReportResult,
  isReportSettled,
  levelOptionsFor,
  type ReportCounts,
  type ReportCriteria,
  type ReportStatus,
  resolveCriteria,
  settledRatio
} from './report';

const LEVELS = [
  { value: 'province', label: '省级' },
  { value: 'city', label: '市级' },
  { value: 'district', label: '区级' },
  { value: 'county', label: '县级' }
] as const;

const counts = (change: Partial<ReportCounts> = {}): ReportCounts => ({
  total: 51,
  completed: 0,
  failed: 1,
  processing: 1,
  notStarted: 50,
  ...change
});

const status = (change: Partial<ReportStatus> = {}): ReportStatus => ({
  rows: [],
  counts: counts(),
  progress: 1.96,
  statusText: null,
  tables: [
    { value: 'baseTable', label: '基本统计报表' },
    { value: 'summaryTable', label: '汇总统计报表' }
  ],
  levels: LEVELS,
  ...change
});

describe('报表状态', () => {
  it('处理到头的几种情况：整体状态、百分比到 100、成功加失败到总数、什么都没有', () => {
    expect(isReportSettled(status())).toBe(false);
    expect(isReportSettled(status({ statusText: '处理完成' }))).toBe(true);
    expect(isReportSettled(status({ progress: 100 }))).toBe(true);
    expect(isReportSettled(status({ counts: counts({ completed: 50, failed: 1, notStarted: 0, processing: 0 }) }))).toBe(
      true
    );
    expect(
      isReportSettled(
        status({ counts: { total: 0, completed: 0, failed: 0, processing: 0, notStarted: 0 }, progress: null })
      )
    ).toBe(true);
  });

  it('已处理的比例算上失败；没有任务时为 null', () => {
    expect(settledRatio(counts({ completed: 49, failed: 2 }))).toBe(1);
    expect(settledRatio(counts({ total: 4, completed: 1, failed: 1 }))).toBe(0.5);
    expect(settledRatio(counts({ total: 0 }))).toBeNull();
    expect(hasReportResult(status())).toBe(true);
    expect(hasReportResult(status({ counts: counts({ total: 0 }) }))).toBe(false);
  });

  it('汇总统计只能选后端给的等级里的省、市级', () => {
    expect(levelOptionsFor('summaryTable', LEVELS).map(option => option.value)).toEqual(['province', 'city']);
    expect(levelOptionsFor('baseTable', [LEVELS[0], LEVELS[3]]).map(option => option.value)).toEqual([
      'province',
      'county'
    ]);
  });
});

describe('查看条件', () => {
  const criteria: ReportCriteria = { year: '2025', table: 'summaryTable', level: 'county' };

  it('条件在选项里时原样返回，不在时换成第一个可选的', () => {
    const valid: ReportCriteria = { year: '2025', table: 'baseTable', level: 'county' };
    expect(resolveCriteria(valid, status())).toBe(valid);
    expect(resolveCriteria(criteria, status())).toEqual({ year: '2025', table: 'summaryTable', level: 'province' });
    expect(
      resolveCriteria(valid, status({ tables: [{ value: 'baseTable', label: '基本统计报表' }], levels: [LEVELS[0]] }))
    ).toEqual({ year: '2025', table: 'baseTable', level: 'province' });
  });

  it('这一年什么都没有时保持不变', () => {
    expect(resolveCriteria(criteria, status({ tables: [], levels: [] }))).toBe(criteria);
  });
});
