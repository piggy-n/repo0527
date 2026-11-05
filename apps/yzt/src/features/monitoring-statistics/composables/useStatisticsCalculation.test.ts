// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectScope, type EffectScope } from 'vue';
import type { SessionGuard } from '@/shared/auth/session-guard';
import { ApiError } from '@/shared/http/errors';
import { required } from '@/shared/testing/required';
import type { StatisticsApi } from '../api';
import type { ReportCriteria, ReportStatus } from '../report';
import type { CreateTaskPayload } from '../statistics';
import type { StatisticsReport, SubmissionTracking } from './useStatisticsReport';
import { type CalculationEntry, type StatisticsCalculation, useStatisticsCalculation } from './useStatisticsCalculation';

const status = (change: Partial<ReportStatus['counts']>, progress: number | null): ReportStatus => ({
  rows: [],
  counts: { total: 0, completed: 0, failed: 0, processing: 0, notStarted: 0, ...change },
  progress,
  statusText: null,
  tables: [],
  levels: []
});

// 省级处理完有失败，市级在处理，区级没有任务，县级查询失败
const REPORTS: Record<string, ReportStatus | Error> = {
  province: status({ total: 51, completed: 50, failed: 1 }, 100),
  city: status({ total: 637, completed: 100, processing: 1, notStarted: 536 }, 15.7),
  district: status({}, null),
  county: new Error('查询失败')
};

function setup({
  createTasks = () => Promise.resolve(),
  tracking = () => false,
  guard
}: {
  createTasks?: StatisticsApi['createTasks'];
  tracking?: (target: ReportCriteria) => boolean;
  guard?: SessionGuard;
} = {}) {
  const create = vi.fn<StatisticsApi['createTasks']>(createTasks);
  const api: StatisticsApi = {
    fetchOverview: () => Promise.resolve(new Map()),
    fetchReport: ({ level }) => {
      const report = REPORTS[level];
      return report instanceof Error || report === undefined ? Promise.reject(report) : Promise.resolve(report);
    },
    createTasks: create
  };
  const submission: SubmissionTracking = {
    accept: vi.fn<SubmissionTracking['accept']>(),
    reject: vi.fn<SubmissionTracking['reject']>()
  };
  const trackSubmission = vi.fn<StatisticsReport['trackSubmission']>(() => submission);
  const refresh = vi.fn<() => void>();
  const scope = effectScope();
  scopes.push(scope);
  const calculation = required(
    scope.run(() =>
      useStatisticsCalculation({
        api,
        report: { trackSubmission, isTracking: tracking },
        overview: { refresh },
        sessionGuard: guard ?? { capture: () => 'session', isCurrent: () => true, assertCurrent: () => undefined }
      })
    ),
    '计算的拥有者'
  );
  return { calculation, create, submission, trackSubmission, refresh, scope };
}

const scopes: EffectScope[] = [];
afterEach(() => {
  scopes.splice(0).forEach(scope => scope.stop());
});

const selectBaseLevels = (calculation: StatisticsCalculation) => calculation.toggleTable('baseTable', true);

describe('useStatisticsCalculation', () => {
  it('勾选：按报表全选、全部全选，半选时显示不确定；不支持的等级勾不上', () => {
    const { calculation } = setup();
    expect(calculation.canStart.value).toBe(false);

    calculation.toggle({ table: 'summaryTable', level: 'province' }, true);
    expect(calculation.tableState('summaryTable')).toEqual({ checked: false, indeterminate: true });
    expect(calculation.allState.value).toEqual({ checked: false, indeterminate: true });
    calculation.toggle({ table: 'summaryTable', level: 'county' }, true);
    calculation.toggle({ table: 'baseWaterTable', level: 'county' }, true);
    expect([...calculation.selected.value]).toEqual(['summaryTable:province']);
    calculation.toggleTable('changeWaterTable', true);
    expect(calculation.tableState('changeWaterTable')).toEqual({ checked: true, indeterminate: false });
    expect(calculation.selected.value.has('changeWaterTable:district')).toBe(true);

    calculation.toggleAll(true);
    expect(calculation.allState.value).toEqual({ checked: true, indeterminate: false });
    calculation.toggleTable('baseTable', false);
    expect(calculation.tableState('baseTable')).toEqual({ checked: false, indeterminate: false });
    expect(calculation.canStart.value).toBe(true);
  });

  it('两个本底年度默认是监测年度的上一年，可以各自改成更早的年份；换监测年度时回到上一年', () => {
    const { calculation } = setup();
    calculation.setYear('2025');
    expect(calculation.baseYears.value).toEqual({ change: '2024', water: '2024' });
    calculation.setBaseYear('water', '2022');
    expect(calculation.baseYears.value).toEqual({ change: '2024', water: '2022' });
    expect(() => calculation.setBaseYear('change', '2025')).toThrow(RangeError);
    calculation.setYear('2026');
    expect(calculation.baseYears.value).toEqual({ change: '2025', water: '2025' });
  });

  it('变化类报表按各自的本底年度检查和提交，提交后按提交时的本底年度跟踪', async () => {
    const { calculation, create, trackSubmission } = setup();
    calculation.setYear('2025');
    calculation.setBaseYear('change', '2023');
    calculation.toggle({ table: 'entityChangeTable', level: 'district' }, true);
    calculation.toggle({ table: 'changeWaterTable', level: 'district' }, true);
    let entries: readonly CalculationEntry[] = [];

    await calculation.submit(received => {
      entries = received;
      // 确认期间改了本底年度：这次提交仍用提交时的
      calculation.setBaseYear('water', '2020');
      return Promise.resolve(true);
    });

    expect(entries.map(({ table, baseYear }) => [table, baseYear])).toEqual([
      ['changeWaterTable', '2024'],
      ['entityChangeTable', '2023']
    ]);
    expect(trackSubmission.mock.calls[0]?.[1]).toEqual({ change: '2023', water: '2024' });
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      changeWaterTableParam: { bdYear: '2024', isDistrict: true, isCounty: false },
      entityChangeTableParam: { bdYear: '2023', isDistrict: true, isCounty: false }
    });
  });

  it('提交前查各组合的状态交给确认：有结果、在处理的算已有任务，查不到的、正在跟踪的按未确认', async () => {
    const { calculation, create, trackSubmission, submission, refresh } = setup({
      tracking: target => target.table === 'summaryTable'
    });
    calculation.setYear('2025');
    selectBaseLevels(calculation);
    calculation.toggle({ table: 'summaryTable', level: 'city' }, true);
    let entries: readonly CalculationEntry[] = [];

    const outcome = await calculation.submit(received => {
      entries = received;
      return Promise.resolve(true);
    });

    expect(entries.map(({ table, level, status: kind, statusText }) => [table, level, kind, statusText])).toEqual([
      ['baseTable', 'province', 'failed', '已有统计任务'],
      ['baseTable', 'city', 'processing', '已有统计任务'],
      ['baseTable', 'district', 'notStarted', '未处理'],
      ['baseTable', 'county', 'unknown', '状态未确认'],
      ['summaryTable', 'city', 'unknown', '已有提交尚未结束，继续可能重复统计']
    ]);
    expect(trackSubmission).toHaveBeenCalledWith('2025', { change: '2024', water: '2024' }, [
      expect.objectContaining({ recompute: true }),
      expect.objectContaining({ recompute: true }),
      expect.objectContaining({ recompute: false }),
      expect.objectContaining({ recompute: true }),
      expect.objectContaining({ recompute: true })
    ]);
    expect(create.mock.calls[0]?.[0]).toEqual({
      year: '2025',
      baseTableParam: { year: '2025', isProvince: true, isCity: true, isDistrict: true, isCounty: true },
      summaryTableParam: { year: '2025', isProvince: false, isCity: true, isDistrict: false, isCounty: false }
    } satisfies CreateTaskPayload);
    expect(outcome).toEqual({ kind: 'accepted' });
    expect(submission.accept).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(calculation.submitting.value).toBe(false);
  });

  it('取消确认不提交、不跟踪', async () => {
    const { calculation, create, trackSubmission } = setup();
    selectBaseLevels(calculation);
    await expect(calculation.submit(() => Promise.resolve(false))).resolves.toEqual({ kind: 'canceled' });
    expect(trackSubmission).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('后端明确拒绝时提交失败；网络错误、5xx 不能证明没有创建，按未确认继续跟踪', async () => {
    const rejected = setup({
      createTasks: () => Promise.reject(new ApiError({ kind: 'business', message: '已有统计任务在执行' }))
    });
    selectBaseLevels(rejected.calculation);
    await expect(rejected.calculation.submit(() => Promise.resolve(true))).resolves.toEqual({
      kind: 'rejected',
      message: '已有统计任务在执行'
    });
    expect(rejected.submission.reject).toHaveBeenCalledWith('已有统计任务在执行', false);

    const uncertain = setup({
      createTasks: () => Promise.reject(new ApiError({ kind: 'http', status: 502, message: '服务暂不可用' }))
    });
    selectBaseLevels(uncertain.calculation);
    await expect(uncertain.calculation.submit(() => Promise.resolve(true))).resolves.toEqual({
      kind: 'uncertain',
      message: '服务暂不可用'
    });
    expect(uncertain.submission.reject).toHaveBeenCalledWith('服务暂不可用', true);
    expect(uncertain.refresh).not.toHaveBeenCalled();
  });

  it('确认期间换了会话不提交', async () => {
    let token = 'session-1';
    const guard: SessionGuard = {
      capture: () => token,
      isCurrent: value => value === token,
      assertCurrent: value => {
        if (value !== token) {
          throw new Error('会话已变更');
        }
      }
    };
    const { calculation, create, trackSubmission } = setup({ guard });
    selectBaseLevels(calculation);

    await calculation.submit(() => {
      token = 'session-2';
      return Promise.resolve(true);
    });

    expect(trackSubmission).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('提交期间不能再提交；作用域销毁后不再提交', async () => {
    const { calculation, scope, trackSubmission } = setup();
    selectBaseLevels(calculation);
    const answers: ((value: boolean) => void)[] = [];
    const first = calculation.submit(() => new Promise(resolve => answers.push(resolve)));
    await vi.waitFor(() => expect(calculation.submitting.value).toBe(true));
    await expect(calculation.submit(() => Promise.resolve(true))).resolves.toEqual({ kind: 'canceled' });

    scope.stop();
    required(answers[0], '打开的确认')(true);
    await expect(first).resolves.toEqual({ kind: 'canceled' });
    expect(trackSubmission).not.toHaveBeenCalled();
  });
});
