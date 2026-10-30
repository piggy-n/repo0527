import {
  type AreaLevel,
  baseYearFor,
  type BaseYears,
  levelLabel,
  type TableLevel,
  tableOf,
  type TableType,
  type TaskStatus,
  taskStatusOf
} from './statistics';

/** 查看哪一份报表：年份加报表类型、行政区划等级；变化类报表另有本底年份 */
export interface ReportCriteria extends TableLevel {
  readonly year: string;
  /** 变化类报表的本底年份，其余报表为 null */
  readonly baseYear: string | null;
}

/** 按这组本底年份给出一个组合的查看条件 */
export const criteriaOf = (year: string, target: TableLevel, baseYears: BaseYears): ReportCriteria => ({
  year,
  table: target.table,
  level: target.level,
  baseYear: baseYearFor(target.table, baseYears)
});

export const sameCriteria = (a: ReportCriteria, b: ReportCriteria) =>
  a.year === b.year && a.table === b.table && a.level === b.level && a.baseYear === b.baseYear;

export interface ReportOption<T> {
  readonly value: T;
  readonly label: string;
}

/** 监控列表的一行：一张统计表 */
export interface ReportRow {
  readonly year: string;
  readonly regionName: string;
  readonly name: string;
  readonly status: TaskStatus;
  /** 后端的状态原文 */
  readonly statusText: string;
  readonly completeTime: string | null;
  readonly cause: string | null;
}

export interface ReportCounts {
  readonly total: number;
  readonly completed: number;
  readonly failed: number;
  readonly processing: number;
  readonly notStarted: number;
}

/** 一份报表的处理状态 */
export interface ReportStatus {
  readonly rows: readonly ReportRow[];
  readonly counts: ReportCounts;
  /** 后端的完成百分比；没有任务时为 null */
  readonly progress: number | null;
  /** 后端的整体状态文字（实测都是 null） */
  readonly statusText: string | null;
  /** 这一年可选的报表类型和行政区划等级，随每次查询返回 */
  readonly tables: readonly ReportOption<TableType>[];
  readonly levels: readonly ReportOption<AreaLevel>[];
}

/** 处理到头了：不用再按间隔查（沿用旧页面的判断，几个条件满足一个即可） */
export function isReportSettled({ counts, progress, statusText }: ReportStatus): boolean {
  const overall = taskStatusOf(statusText);
  return (
    overall === 'completed' ||
    overall === 'failed' ||
    (progress !== null && progress >= 100) ||
    (counts.total > 0 && counts.completed + counts.failed >= counts.total) ||
    (counts.total === 0 && counts.notStarted === 0 && counts.processing === 0)
  );
}

/** 有任务：有表或有数量 */
export const hasReportResult = ({ counts, rows }: ReportStatus) => counts.total > 0 || rows.length > 0;

/** 已处理的比例（成功和失败都算），0～1；没有任务时为 null */
export function settledRatio({ total, completed, failed }: ReportCounts): number | null {
  if (total <= 0) {
    return null;
  }
  return Math.min(1, Math.max(0, (completed + failed) / total));
}

/**
 * 某个报表能选的等级：后端给的等级里这个报表支持的那些（汇总统计只有省、市，水路网没有县级），
 * 名称按前端的叫法（水路网的区级叫"区县级"）
 */
export function levelOptionsFor(
  table: TableType,
  levels: readonly ReportOption<AreaLevel>[]
): readonly ReportOption<AreaLevel>[] {
  const supported = tableOf(table).levels;
  return levels
    .filter(option => supported.includes(option.value))
    .map(option => ({ value: option.value, label: levelLabel(option.value, table) }));
}

/** 当前条件不在后端给的选项里时，换成第一个可选的报表和等级（本底年份跟着报表）；这一年什么都没有时保持不变 */
export function resolveCriteria(criteria: ReportCriteria, status: ReportStatus, baseYears: BaseYears): ReportCriteria {
  const table = status.tables.some(option => option.value === criteria.table)
    ? criteria.table
    : status.tables[0]?.value;
  if (table === undefined) {
    return criteria;
  }
  const levels = levelOptionsFor(table, status.levels);
  const level = levels.some(option => option.value === criteria.level)
    ? criteria.level
    : (levels[0]?.value ?? criteria.level);
  if (table === criteria.table) {
    return level === criteria.level ? criteria : { ...criteria, level };
  }
  return criteriaOf(criteria.year, { table, level }, baseYears);
}
