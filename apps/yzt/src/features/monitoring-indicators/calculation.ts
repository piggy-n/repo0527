/** 进度里一个指标的状态 */
export type CalculationRowStatus = 'pending' | 'processing' | 'completed' | 'failed';

export const CALCULATION_ROW_LABELS: Readonly<Record<CalculationRowStatus, string>> = {
  pending: '待计算',
  processing: '正在处理',
  completed: '已完成',
  failed: '计算失败'
};

/** 提交计算的指标 */
export interface CalculationIndicator {
  readonly code: string;
  readonly name: string;
}

/** 一次计算的条件，开始时固定下来，之后改左边的条件不影响这次的进度 */
export interface CalculationRequest {
  readonly year: number;
  readonly regionCode: string;
  readonly regionName: string;
  readonly indicators: readonly CalculationIndicator[];
}

/** 进度接口里一个指标的结果 */
export interface CalculationRow {
  readonly code: string;
  readonly name: string;
  readonly status: CalculationRowStatus;
  /** 完成时的结果，去掉了"分析结果:"前缀 */
  readonly result: string | null;
}

/** 查询一次进度的结果 */
export interface CalculationProgress {
  readonly rows: readonly CalculationRow[];
  /** 0～100 */
  readonly percent: number;
  /** 后端给出的全部处理完的标记（ratio 到 100） */
  readonly finished: boolean;
  /** 后端给出的状态说明；没有时为 null，由前端按数量写 */
  readonly statusText: string | null;
}

/**
 * 计算任务的阶段：creating 正在请求开始计算；starting 已创建、等后端开始后再查进度；running 按间隔查进度；
 * stalled 进度连续查询失败、停下等重试；finished 全部处理完；failed 开始计算失败
 */
export type CalculationPhase = 'creating' | 'starting' | 'running' | 'stalled' | 'finished' | 'failed';

export interface CalculationTask {
  readonly request: CalculationRequest;
  readonly phase: CalculationPhase;
  /** 最近一次查到的进度；还没查到时为 null */
  readonly progress: CalculationProgress | null;
  /** failed 时开始计算失败的原因 */
  readonly error: string | null;
}

/** 按后端的结果原文判断状态：认不出的不算完成 */
export function calculationRowStatus(result: string): CalculationRowStatus {
  const text = result.trim();
  if (text === '') {
    return 'pending';
  }
  if (text === '正在处理') {
    return 'processing';
  }
  if (/失败|错误|异常/.test(text)) {
    return 'failed';
  }
  if (/分析结果|成功|已完成|处理完成|计算完成/.test(text)) {
    return 'completed';
  }
  return 'pending';
}

/** 进度接口的结果写成"分析结果:40.04%"，面板只显示数值和单位 */
export function calculationResultValue(result: string): string {
  return result.replace(/^分析结果[:：]\s*/, '');
}

/** 进度面板的每一行：按提交的指标顺序，进度里还没有的指标是待计算 */
export function calculationRows(task: CalculationTask): CalculationRow[] {
  const byCode = new Map(task.progress?.rows.map(row => [row.code, row]));
  return task.request.indicators.map(
    ({ code, name }) => byCode.get(code) ?? { code, name, status: 'pending', result: null }
  );
}

export interface CalculationCounts {
  readonly total: number;
  readonly processing: number;
  readonly completed: number;
  readonly failed: number;
}

export function calculationCounts(rows: readonly CalculationRow[]): CalculationCounts {
  const count = (status: CalculationRowStatus) => rows.filter(row => row.status === status).length;
  return {
    total: rows.length,
    processing: count('processing'),
    completed: count('completed'),
    failed: count('failed')
  };
}

/** 任务正在进行：这期间不能再开始一次计算 */
export function isCalculationBusy(task: CalculationTask | null): boolean {
  return task !== null && (task.phase === 'creating' || task.phase === 'starting' || task.phase === 'running');
}

/** 进度面板"当前状态"一行的文字 */
export function calculationStatusText(task: CalculationTask): string {
  switch (task.phase) {
    case 'creating':
      return '正在创建计算任务';
    case 'failed':
      return task.error ?? '计算任务创建失败，请重试';
    case 'stalled':
      return '进度获取连续失败，请重新获取进度';
    case 'starting':
    case 'running':
    case 'finished':
      break;
  }
  const { progress } = task;
  if (progress === null) {
    return '计算任务已创建，正在初始化';
  }
  if (progress.statusText !== null) {
    return progress.statusText;
  }
  if (task.phase === 'finished') {
    const { failed } = calculationCounts(calculationRows(task));
    return failed > 0 ? `处理完成，${failed}个指标计算失败` : '处理完成';
  }
  return `正在处理中，已完成${progress.percent}%`;
}
