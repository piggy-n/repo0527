import { hasReportResult, isReportSettled, type ReportCriteria, type ReportStatus, sameCriteria } from './report';
import { levelLabel, tableName } from './statistics';

/** 新统计提交后最多等多久任务出现（同旧页面） */
export const NEW_TASK_WAIT = 90_000;
/** 重新统计提交后的宽限：后台异步重算，状态可能一会儿才变（同旧页面） */
export const RECOMPUTE_WAIT = 15_000;

/**
 * 提交后一个组合的跟踪阶段：submitting 创建请求还没返回；waiting 已提交、等任务出现；processing 查到在处理；
 * failed 创建被拒绝；timeout 等到截止也没查到本次的任务
 */
export type TrackingPhase = 'submitting' | 'waiting' | 'processing' | 'failed' | 'timeout';

/** 一次提交里一个组合的跟踪；跟踪结束（查到结果）就去掉 */
export interface Tracking {
  readonly target: ReportCriteria;
  /** 第几次提交：创建请求返回后只更新这一次的，不碰之后对同一组合的提交 */
  readonly run: number;
  /** 这次提交一共几项，提示里用 */
  readonly count: number;
  /** 提交前已有任务：属于重新统计，等待更短，查到在处理才算这次的 */
  readonly recompute: boolean;
  readonly phase: TrackingPhase;
  /** 创建请求没有明确的结果（网络错误、超时、服务端异常），任务可能已在后台执行 */
  readonly uncertain: boolean;
  /** 等待的截止时间；submitting 时还没开始算 */
  readonly deadline: number | null;
  /** failed 时的原因 */
  readonly message: string | null;
}

/** 提交时每个组合一条，等创建请求返回 */
export function trackSubmitted(
  targets: readonly { readonly target: ReportCriteria; readonly recompute: boolean }[],
  run: number
): Tracking[] {
  return targets.map(({ target, recompute }) => ({
    target,
    run,
    count: targets.length,
    recompute,
    phase: 'submitting',
    uncertain: false,
    deadline: null,
    message: null
  }));
}

/** 创建请求成功：开始计算等待的截止时间 */
export function trackAccepted(tracking: Tracking, now: number): Tracking {
  return {
    ...tracking,
    phase: tracking.phase === 'submitting' ? 'waiting' : tracking.phase,
    deadline: now + (tracking.recompute ? RECOMPUTE_WAIT : NEW_TASK_WAIT)
  };
}

/** 创建请求被明确拒绝（业务码、4xx）：失败；没有明确结果时按可能已提交继续等 */
export function trackRejected(tracking: Tracking, message: string, uncertain: boolean, now: number): Tracking {
  if (uncertain) {
    return {
      ...tracking,
      phase: tracking.phase === 'submitting' ? 'waiting' : tracking.phase,
      uncertain: true,
      deadline: now + NEW_TASK_WAIT,
      message
    };
  }
  return { ...tracking, phase: 'failed', message };
}

/** 查到当前组合的状态后推进跟踪；查到本次的结果时结束（null） */
export function trackObserved(tracking: Tracking, status: ReportStatus, now: number): Tracking | null {
  if (tracking.phase === 'failed' || tracking.phase === 'timeout') {
    return tracking;
  }
  if (!isReportSettled(status)) {
    return { ...tracking, phase: 'processing' };
  }
  // 新统计查到结果就是本次的；重新统计要先见过处理中，才能确定结果属于本次
  if (hasReportResult(status) && (!tracking.recompute || tracking.phase === 'processing')) {
    return null;
  }
  if (tracking.deadline === null || now < tracking.deadline) {
    return tracking;
  }
  return { ...tracking, phase: 'timeout' };
}

/** 还在等这个组合的任务：继续按间隔查 */
export const isTrackingActive = (tracking: Tracking | null) =>
  tracking !== null &&
  (tracking.phase === 'submitting' || tracking.phase === 'waiting' || tracking.phase === 'processing');

export const trackingOf = (trackings: readonly Tracking[], criteria: ReportCriteria) =>
  trackings.find(item => sameCriteria(item.target, criteria)) ?? null;

/** 进度区的提示：查询出错优先，其次是当前组合的跟踪；没有要说的时为 null */
export interface ReportNotice {
  readonly type: 'info' | 'warning' | 'error';
  readonly text: string;
  /** 显示"重新查询" */
  readonly retry: boolean;
}

const describe = ({ table, level, year, baseYear }: ReportCriteria) => {
  const parts = [tableName(table), levelLabel(level, table), `${year}年`];
  return (baseYear === null ? parts : [...parts, `本底${baseYear}年`]).join(' / ');
};

export function reportNotice(tracking: Tracking | null, error: string | null): ReportNotice | null {
  if (error !== null) {
    return { type: 'error', text: error, retry: true };
  }
  if (tracking === null) {
    return null;
  }
  const target = `（${describe(tracking.target)}）`;
  switch (tracking.phase) {
    case 'submitting':
      return { type: 'info', text: `统计请求提交中${target}，请稍候...`, retry: false };
    case 'failed':
      return { type: 'error', text: tracking.message ?? '统计分析请求提交失败，请稍后重试', retry: true };
    case 'timeout':
      return {
        type: 'warning',
        text: `暂未查询到本次提交的统计任务${target}，任务可能仍在后台生成，可稍后重新查询`,
        retry: true
      };
    case 'waiting':
    case 'processing':
      break;
  }
  if (tracking.uncertain) {
    return { type: 'warning', text: `提交响应未确认${target}，任务可能已在后台执行，正在根据任务状态继续跟踪`, retry: false };
  }
  if (tracking.phase === 'processing') {
    return null;
  }
  const request = tracking.recompute ? '重新统计请求' : '统计分析请求';
  const submitted = tracking.count > 1 ? `已提交 ${tracking.count} 项${request}，当前查看${target}` : `已提交${request}${target}`;
  const wait = tracking.recompute ? '正在刷新处理结果...' : '正在等待任务生成，请稍候...';
  return { type: 'info', text: `${submitted}，${wait}`, retry: false };
}
