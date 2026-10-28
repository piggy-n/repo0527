import { computed, type ComputedRef, getCurrentScope, onScopeDispose, type Ref, shallowReadonly, shallowRef } from 'vue';
import { type SessionGuard, useSessionGuard } from '@/shared/auth/session-guard';
import { ApiError } from '@/shared/http/errors';
import type { StatisticsApi } from '../api';
import { hasReportResult, isReportSettled } from '../report';
import {
  CALCULABLE,
  createTaskPayload,
  defaultYear,
  type TableLevel,
  tableLevelKey,
  TABLES,
  type TableType,
  type TaskStatus
} from '../statistics';
import type { StatisticsOverview } from './useStatisticsOverview';
import type { StatisticsReport } from './useStatisticsReport';

/** 确认框里的一项：提交前查到的状态；unknown 是没能确认的，可能覆盖已有结果或重复统计 */
export interface CalculationEntry extends TableLevel {
  readonly status: TaskStatus | 'unknown';
  readonly statusText: string;
}

/** 一次提交的结果，界面据此提示 */
export type SubmitOutcome =
  | { readonly kind: 'canceled' }
  | { readonly kind: 'accepted' }
  /** 后端明确拒绝：没有创建 */
  | { readonly kind: 'rejected'; readonly message: string }
  /** 没有明确的结果：任务可能已在后台执行，继续跟踪 */
  | { readonly kind: 'uncertain'; readonly message: string };

/** 勾选框的状态 */
export interface CheckState {
  readonly checked: boolean;
  readonly indeterminate: boolean;
}

export interface StatisticsCalculation {
  /** 监测数据年度 */
  readonly year: Readonly<Ref<string>>;
  /** 变更本底、水路本底年度：监测年度的上一年 */
  readonly baseYear: ComputedRef<string>;
  readonly selected: Readonly<Ref<ReadonlySet<string>>>;
  readonly allState: ComputedRef<CheckState>;
  readonly tableState: (table: TableType) => CheckState;
  readonly canStart: ComputedRef<boolean>;
  /** 从提交前检查到创建请求返回：期间不能再提交 */
  readonly submitting: Readonly<Ref<boolean>>;
  readonly setYear: (year: string) => void;
  readonly toggle: (target: TableLevel, checked: boolean) => void;
  readonly toggleTable: (table: TableType, checked: boolean) => void;
  readonly toggleAll: (checked: boolean) => void;
  /**
   * 提交勾选的组合：先查各组合现在的状态，由界面确认（confirm 返回 false 表示取消），确认后切到第一项开始跟踪，
   * 再发出创建请求；创建是写操作，不随页面卸载取消
   */
  readonly submit: (confirm: (entries: readonly CalculationEntry[]) => Promise<boolean>) => Promise<SubmitOutcome>;
}

export interface StatisticsCalculationOptions {
  readonly api: StatisticsApi;
  readonly report: Pick<StatisticsReport, 'trackSubmission' | 'isTracking'>;
  readonly overview: Pick<StatisticsOverview, 'refresh'>;
  /** 默认按当前登录会话核对；组件样例不登录，传入总是有效的核对 */
  readonly sessionGuard?: SessionGuard;
}

// 业务码和 4xx（408 超时除外）说明后端没有接受；网络错误、超时、5xx、返回格式不对都不能证明没有创建
function isRejection(error: unknown): boolean {
  if (!(error instanceof ApiError)) {
    return false;
  }
  if (error.kind === 'business' || error.kind === 'unauthorized') {
    return true;
  }
  return error.kind === 'http' && error.status !== undefined && error.status < 500 && error.status !== 408;
}

const calculableKeys = CALCULABLE.map(tableLevelKey);
const keysOf = (table: TableType) => CALCULABLE.filter(item => item.table === table).map(tableLevelKey);

/** 统计报表计算（左栏）的拥有者：年份、勾选和提交 */
export function useStatisticsCalculation(options: StatisticsCalculationOptions): StatisticsCalculation {
  if (!getCurrentScope()) {
    throw new Error('useStatisticsCalculation 只能在组件的 setup 或 effectScope 中调用');
  }
  const { api, report, overview } = options;
  const sessionGuard = options.sessionGuard ?? useSessionGuard();
  const year = shallowRef(defaultYear());
  const selected = shallowRef<ReadonlySet<string>>(new Set());
  const submitting = shallowRef(false);
  // 只取消提交前的查询，不取消已发出的创建请求
  const checks = new AbortController();
  let disposed = false;
  onScopeDispose(() => {
    disposed = true;
    checks.abort();
  });

  const replace = (keys: readonly string[], checked: boolean) => {
    const next = new Set(selected.value);
    for (const key of keys) {
      if (checked) {
        next.add(key);
      } else {
        next.delete(key);
      }
    }
    selected.value = next;
  };

  const stateOf = (keys: readonly string[]): CheckState => {
    const count = keys.filter(key => selected.value.has(key)).length;
    return { checked: keys.length > 0 && count === keys.length, indeterminate: count > 0 && count < keys.length };
  };

  // 提交前查一个组合现在的状态：有表或没处理完就是已有任务；查不到的按未确认提示
  const inspect = async (target: TableLevel, signal: AbortSignal): Promise<CalculationEntry> => {
    if (report.isTracking({ year: year.value, ...target })) {
      return { ...target, status: 'unknown', statusText: '已有提交尚未结束，继续可能重复统计' };
    }
    try {
      const status = await api.fetchReport({ year: year.value, ...target }, signal);
      const settled = isReportSettled(status);
      if (settled && !hasReportResult(status)) {
        return { ...target, status: 'notStarted', statusText: '未处理' };
      }
      let kind: TaskStatus = 'processing';
      if (settled) {
        kind = status.counts.failed > 0 ? 'failed' : 'completed';
      }
      return { ...target, status: kind, statusText: status.statusText ?? '已有统计任务' };
    } catch (error) {
      if (signal.aborted) {
        throw error;
      }
      return { ...target, status: 'unknown', statusText: '状态未确认' };
    }
  };

  const submit = async (confirm: (entries: readonly CalculationEntry[]) => Promise<boolean>): Promise<SubmitOutcome> => {
    const targets = CALCULABLE.filter(item => selected.value.has(tableLevelKey(item)));
    if (disposed || submitting.value || targets.length === 0) {
      return { kind: 'canceled' };
    }
    const token = sessionGuard.capture();
    const submitYear = year.value;
    submitting.value = true;
    try {
      let entries: CalculationEntry[];
      try {
        entries = await Promise.all(targets.map(target => inspect(target, checks.signal)));
      } catch {
        // 提交前的查询只会因为页面卸载被取消，其余失败已按未确认处理
        return { kind: 'canceled' };
      }
      if (disposed || !(await confirm(entries)) || disposed || !sessionGuard.isCurrent(token)) {
        return { kind: 'canceled' };
      }
      const tracking = report.trackSubmission(
        submitYear,
        entries.map(entry => ({ target: entry, recompute: entry.status !== 'notStarted' }))
      );
      try {
        sessionGuard.assertCurrent(token);
        await api.createTasks(createTaskPayload(submitYear, targets));
      } catch (error) {
        const message = error instanceof Error && error.message ? error.message : '统计分析请求提交失败，请稍后重试';
        const rejected = isRejection(error);
        tracking.reject(message, !rejected);
        return rejected ? { kind: 'rejected', message } : { kind: 'uncertain', message };
      }
      // 已经创建；换了会话时不再更新旧会话的界面
      if (sessionGuard.isCurrent(token)) {
        tracking.accept();
        overview.refresh();
      }
      return { kind: 'accepted' };
    } finally {
      submitting.value = false;
    }
  };

  return {
    year: shallowReadonly(year),
    baseYear: computed(() => `${Number(year.value) - 1}年`),
    selected: shallowReadonly(selected),
    allState: computed(() => stateOf(calculableKeys)),
    tableState: table => stateOf(keysOf(table)),
    canStart: computed(() => selected.value.size > 0),
    submitting: shallowReadonly(submitting),
    setYear: value => (year.value = value),
    toggle: (target, checked) => {
      if (TABLES.some(table => table.type === target.table && table.enabled && table.levels.includes(target.level))) {
        replace([tableLevelKey(target)], checked);
      }
    },
    toggleTable: (table, checked) => replace(keysOf(table), checked),
    toggleAll: checked => replace(calculableKeys, checked),
    submit
  };
}
