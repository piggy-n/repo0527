import { CancelledError } from '@tanstack/vue-query';
import { computed, type ComputedRef, getCurrentScope, type Ref, shallowReadonly, shallowRef, watch } from 'vue';
import type { StatisticsApi } from '../api';
import { useReportQuery } from '../queries';
import {
  criteriaOf,
  isReportSettled,
  levelOptionsFor,
  type ReportCriteria,
  type ReportOption,
  type ReportRow,
  type ReportStatus,
  resolveCriteria,
  sameCriteria
} from '../report';
import {
  type AreaLevel,
  type BaseYears,
  defaultBaseYears,
  defaultYear,
  firstWithResult,
  isBaseYearValid,
  type OverviewRow,
  type TableLevel,
  tableOf,
  type TableType,
  type TaskStatus
} from '../statistics';
import {
  isTrackingActive,
  type ReportNotice,
  reportNotice,
  type Tracking,
  trackAccepted,
  trackingOf,
  trackObserved,
  trackRejected,
  trackSubmitted
} from '../tracking';

/** 没处理完时查状态的间隔（同旧页面） */
export const REPORT_POLL_INTERVAL = 5000;
/** 连续失败几次后停下，等用户重新查询 */
export const REPORT_MAX_FAILURES = 3;

/** 一次提交的跟踪：创建请求返回后由提交方告诉它结果 */
export interface SubmissionTracking {
  readonly accept: () => void;
  /** uncertain：没有明确的结果（网络错误、超时、服务端异常），任务可能已在后台执行 */
  readonly reject: (message: string, uncertain: boolean) => void;
}

/** 轮询的提示文字：区分提交中、等待生成和实际在统计 */
export type ReportActivity = 'submitting' | 'waiting' | 'confirming' | 'processing' | 'querying';

export interface StatisticsReport {
  readonly criteria: Readonly<Ref<ReportCriteria>>;
  /** 查看变化类报表用的两个本底年份：换报表时跟着报表取，换监测年份时回到上一年 */
  readonly baseYears: Readonly<Ref<BaseYears>>;
  /** 这一年可选的报表类型；还没查到时为空 */
  readonly tableOptions: ComputedRef<readonly ReportOption<TableType>[]>;
  /** 当前报表能选的等级 */
  readonly levelOptions: ComputedRef<readonly ReportOption<AreaLevel>[]>;
  /** 当前条件的状态；换条件后新的还没到时为 null */
  readonly status: ComputedRef<ReportStatus | null>;
  /** 还没有可显示的状态，请求中 */
  readonly loading: ComputedRef<boolean>;
  /** 正在请求或在按间隔查：进度区显示转圈和 activity */
  readonly polling: ComputedRef<boolean>;
  readonly activity: ComputedRef<ReportActivity>;
  /** 最近一次查到当前条件的时刻（HH:mm:ss） */
  readonly updatedAt: ComputedRef<string | null>;
  readonly notice: ComputedRef<ReportNotice | null>;
  /** 监控列表按状态筛选：空集合表示全部 */
  readonly statusFilter: Readonly<Ref<ReadonlySet<TaskStatus>>>;
  /** 筛选后的行；新数组交给表格（表格要可变数组），查询结果没变时不重算 */
  readonly rows: ComputedRef<ReportRow[]>;
  /** 一轮新的提交：页面据此收起计算面板，监控列表回到顶部 */
  readonly run: Readonly<Ref<number>>;
  readonly setYear: (year: string) => void;
  readonly setTable: (table: TableType) => void;
  /** 当前报表的本底年份；不是变化类报表、或不早于监测年份时抛错 */
  readonly setBaseYear: (baseYear: string) => void;
  readonly setLevel: (level: AreaLevel) => void;
  /** 一次切到报表和等级（点总览矩阵）；就是当前的时重新查询 */
  readonly select: (target: TableLevel) => void;
  readonly toggleStatus: (status: TaskStatus | null) => void;
  /** 重新查询：查询停下、提交失败或等待超时后由用户发起 */
  readonly retry: () => void;
  /** 提交了这些组合：切到第一项开始跟踪，查看的本底年份换成提交的 */
  readonly trackSubmission: (
    year: string,
    baseYears: BaseYears,
    targets: readonly { readonly target: TableLevel; readonly recompute: boolean }[]
  ) => SubmissionTracking;
  /** 当前正在跟踪、还没结束的组合，提交前提示可能重复统计 */
  readonly isTracking: (target: ReportCriteria) => boolean;
  /** 这一年有还在跟踪的组合：总览要跟进 */
  readonly hasActiveTracking: (year: string) => boolean;
  /**
   * 初次进入：当前组合没有结果时落到总览里第一个有结果的组合（后端给的第一项常常没有数据，同旧页面）。
   * 只做一次，用户先动过条件就不做；matrix 要是当前年份的总览
   */
  readonly focusFirstResult: (matrix: readonly OverviewRow[]) => void;
}

export interface StatisticsReportOptions {
  readonly api: StatisticsApi;
  /** 测试时注入 */
  readonly now?: () => number;
}

const timeOf = (timestamp: number) => new Date(timestamp).toLocaleTimeString('zh-CN', { hour12: false });

/**
 * 当前报表的拥有者：查看条件、状态的查询与轮询、提交后的跟踪和监控列表的筛选（ADR 0100）。
 * 状态由查询缓存持有；条件不在后端给的选项里时换成第一个可选的
 */
export function useStatisticsReport({ api, now = Date.now }: StatisticsReportOptions): StatisticsReport {
  if (!getCurrentScope()) {
    throw new Error('useStatisticsReport 只能在组件的 setup 或 effectScope 中调用');
  }
  const initialYear = defaultYear();
  const criteria = shallowRef<ReportCriteria>({
    year: initialYear,
    table: 'baseTable',
    level: 'province',
    baseYear: null
  });
  const baseYears = shallowRef<BaseYears>(defaultBaseYears(initialYear));
  const trackings = shallowRef<readonly Tracking[]>([]);
  // 最近一次查到的选项，按年份；换报表、等级时还用这一年的
  const options = shallowRef<Pick<ReportStatus, 'tables' | 'levels'> & { readonly year: string }>({
    year: '',
    tables: [],
    levels: []
  });
  const statusFilter = shallowRef<ReadonlySet<TaskStatus>>(new Set());
  const run = shallowRef(0);
  // 当前条件连续失败的次数：换条件、成功一次就清零
  let failures = 0;
  // 初次进入的自动选择：做过、或用户先动过条件后不再做
  let focusSettled = false;

  const currentTracking = computed(() => trackingOf(trackings.value, criteria.value));

  const fetchReport = async (target: ReportCriteria, signal: AbortSignal) => {
    try {
      const status = await api.fetchReport(target, signal);
      failures = 0;
      return status;
    } catch (error) {
      if (!signal.aborted && !(error instanceof CancelledError)) {
        failures++;
      }
      throw error;
    }
  };

  const query = useReportQuery(
    () => criteria.value,
    fetchReport,
    state => {
      if (state.status === 'error') {
        // 失败后按 5、10 秒退避重试，连续 3 次停下（同旧页面）
        return failures < REPORT_MAX_FAILURES ? REPORT_POLL_INTERVAL * 2 ** (failures - 1) : false;
      }
      const data = state.data;
      if (data === undefined) {
        return false;
      }
      const settled = isReportSettled(data.status) && !isTrackingActive(trackingOf(trackings.value, data.criteria));
      return settled ? false : REPORT_POLL_INTERVAL;
    }
  );

  const current = computed(() => {
    const data = query.data.value;
    return data !== undefined && sameCriteria(data.criteria, criteria.value) ? data : null;
  });

  const replaceTracking = (target: ReportCriteria, change: (tracking: Tracking) => Tracking | null) => {
    trackings.value = trackings.value.flatMap(item => {
      if (!sameCriteria(item.target, target)) {
        return [item];
      }
      const next = change(item);
      return next === null ? [] : [next];
    });
  };

  // 换条件、新一轮提交：失败次数清零，筛选回到全部
  const resetView = () => {
    failures = 0;
    if (statusFilter.value.size > 0) {
      statusFilter.value = new Set();
    }
  };

  const setCriteria = (next: ReportCriteria) => {
    if (!sameCriteria(next, criteria.value)) {
      criteria.value = next;
      resetView();
    }
  };

  // 每次查到当前条件（结果没变也算，跟踪的截止时间要按时检查）：记下选项，推进跟踪；
  // 条件不在选项里时换成第一个可选的（刚提交的组合后端可能还没列出，保持不动）
  watch([current, query.dataUpdatedAt], ([data]) => {
    if (data === null) {
      return;
    }
    const { tables, levels } = data.status;
    if (options.value.year !== data.criteria.year || options.value.tables !== tables || options.value.levels !== levels) {
      options.value = { year: data.criteria.year, tables, levels };
    }
    const tracking = trackingOf(trackings.value, data.criteria);
    if (tracking !== null) {
      replaceTracking(data.criteria, item => trackObserved(item, data.status, now()));
    }
    if (!isTrackingActive(tracking)) {
      setCriteria(resolveCriteria(data.criteria, data.status, baseYears.value));
    }
  });
  // 用户改条件、点总览、提交
  const userCriteria = (next: ReportCriteria) => {
    focusSettled = true;
    setCriteria(next);
  };

  const tableOptions = computed(() => (options.value.year === criteria.value.year ? options.value.tables : []));
  const levelOptions = computed(() =>
    options.value.year === criteria.value.year ? levelOptionsFor(criteria.value.table, options.value.levels) : []
  );

  // 最近一次查询失败：显示着上一次的结果时也提示（同旧页面），按间隔重试，连续失败停下
  const errorMessage = computed(() =>
    query.isError.value ? query.error.value?.message || '查询统计任务状态失败，请稍后重试' : null
  );

  const activity = computed((): ReportActivity => {
    const tracking = currentTracking.value;
    if (tracking?.phase === 'submitting') {
      return 'submitting';
    }
    if (tracking?.phase === 'waiting') {
      return tracking.uncertain ? 'confirming' : 'waiting';
    }
    const status = current.value?.status;
    return tracking?.phase === 'processing' || (status !== undefined && status.counts.processing > 0)
      ? 'processing'
      : 'querying';
  });

  // 状态没处理完、或当前组合还在跟踪：下一次会按间隔查
  const pollingScheduled = computed(() => {
    const data = current.value;
    return data !== null && (!isReportSettled(data.status) || isTrackingActive(currentTracking.value));
  });

  const rows = computed(() => {
    const all = current.value?.status.rows ?? [];
    const filter = statusFilter.value;
    return filter.size === 0 ? [...all] : all.filter(row => filter.has(row.status));
  });

  const retry = () => {
    const tracking = currentTracking.value;
    if (tracking?.phase === 'failed' || tracking?.phase === 'timeout') {
      replaceTracking(criteria.value, () => null);
    }
    failures = 0;
    void query.refetch();
  };

  return {
    criteria: shallowReadonly(criteria),
    baseYears: shallowReadonly(baseYears),
    tableOptions,
    levelOptions,
    status: computed(() => current.value?.status ?? null),
    loading: computed(() => current.value === null && query.isFetching.value),
    polling: computed(() => query.isFetching.value || pollingScheduled.value),
    activity,
    updatedAt: computed(() => (current.value === null ? null : timeOf(query.dataUpdatedAt.value))),
    notice: computed(() => reportNotice(currentTracking.value, errorMessage.value)),
    statusFilter: shallowReadonly(statusFilter),
    rows,
    run: shallowReadonly(run),
    setYear: year => {
      baseYears.value = defaultBaseYears(year);
      userCriteria(criteriaOf(year, criteria.value, baseYears.value));
    },
    setTable: table => {
      const supported = tableOf(table).levels;
      const level = supported.includes(criteria.value.level) ? criteria.value.level : (supported[0] ?? criteria.value.level);
      userCriteria(criteriaOf(criteria.value.year, { table, level }, baseYears.value));
    },
    setBaseYear: baseYear => {
      const { year, table } = criteria.value;
      const kind = tableOf(table).baseYear;
      if (kind === null) {
        throw new Error(`${tableOf(table).name}没有本底年份`);
      }
      if (!isBaseYearValid(year, baseYear)) {
        throw new RangeError(`本底年份应早于监测年份 ${year}，收到 ${baseYear}`);
      }
      baseYears.value = { ...baseYears.value, [kind]: baseYear };
      userCriteria({ ...criteria.value, baseYear });
    },
    setLevel: level => userCriteria({ ...criteria.value, level }),
    select: target => {
      const next = criteriaOf(criteria.value.year, target, baseYears.value);
      if (sameCriteria(next, criteria.value)) {
        focusSettled = true;
        retry();
        return;
      }
      userCriteria(next);
    },
    toggleStatus: status => {
      if (status === null) {
        statusFilter.value = new Set();
        return;
      }
      const next = new Set(statusFilter.value);
      if (!next.delete(status)) {
        next.add(status);
      }
      statusFilter.value = next;
    },
    retry,
    trackSubmission: (year, submittedBaseYears, targets) => {
      const submission = run.value + 1;
      const submitted = trackSubmitted(
        targets.map(({ target, recompute }) => ({ target: criteriaOf(year, target, submittedBaseYears), recompute })),
        submission
      );
      baseYears.value = submittedBaseYears;
      const keep = trackings.value.filter(item => !submitted.some(next => sameCriteria(next.target, item.target)));
      trackings.value = [...keep, ...submitted];
      run.value = submission;
      resetView();
      const first = submitted[0];
      if (first !== undefined) {
        userCriteria(first.target);
      }
      // 跟踪可能已经结束（查到结果被去掉），或被之后的提交替换，只更新这次还在的
      const update = (change: (tracking: Tracking) => Tracking) => {
        trackings.value = trackings.value.map(item => (item.run === submission ? change(item) : item));
        failures = 0;
        void query.refetch();
      };
      return {
        accept: () => update(item => trackAccepted(item, now())),
        reject: (message, uncertain) => update(item => trackRejected(item, message, uncertain, now()))
      };
    },
    isTracking: target => isTrackingActive(trackingOf(trackings.value, target)),
    hasActiveTracking: year => trackings.value.some(item => item.target.year === year && isTrackingActive(item)),
    focusFirstResult: matrix => {
      if (focusSettled || current.value === null) {
        return;
      }
      focusSettled = true;
      const { table, level } = criteria.value;
      const cell = matrix.find(row => row.table === table)?.cells.find(item => item.level === level);
      if (cell?.kind === 'completed' || cell?.kind === 'processing' || cell?.kind === 'failed') {
        return;
      }
      const target = firstWithResult(matrix);
      if (target !== null) {
        setCriteria(criteriaOf(criteria.value.year, target, baseYears.value));
      }
    }
  };
}
