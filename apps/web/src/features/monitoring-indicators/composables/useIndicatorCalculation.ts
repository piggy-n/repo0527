import { LatestController } from '@yzt/utils';
import {
  computed,
  type ComputedRef,
  getCurrentScope,
  onScopeDispose,
  type Ref,
  shallowReadonly,
  shallowRef
} from 'vue';
import { type SessionGuard, useSessionGuard } from '@/shared/auth/session-guard';
import type { CalculationParams, IndicatorApi } from '../api';
import { type CalculationRequest, type CalculationTask, isCalculationBusy } from '../calculation';

/** 开始计算后等多久再查第一次进度：给后端启动计算的时间（旧页面的做法） */
export const FIRST_PROGRESS_DELAY = 3000;
/** 查进度的间隔 */
export const PROGRESS_INTERVAL = 5000;
/** 连续失败几次后停下，等用户重新获取 */
export const PROGRESS_MAX_FAILURES = 3;

export interface IndicatorCalculation {
  /** 最近一次计算；重置后为 null */
  readonly task: Readonly<Ref<CalculationTask | null>>;
  /** 正在验证、确认或进行计算：这期间不能再开始 */
  readonly busy: ComputedRef<boolean>;
  /**
   * 开始一次计算：先验证这些指标是否已有结果，再由界面确认（confirm 收到是否已有结果，返回 false 表示取消），
   * 确认后提交并按间隔查进度。确认期间页面销毁、会话变了都不再提交
   */
  readonly start: (request: CalculationRequest, confirm: (existing: boolean) => Promise<boolean>) => Promise<void>;
  /** 进度连续失败停下后重新开始查询；其他时候什么也不做 */
  readonly retryProgress: () => void;
  /** 停止查进度、清掉这次计算；已经提交的计算不会撤回 */
  readonly reset: () => void;
}

/** 等 ms 毫秒；信号中止时提前结束 */
function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}

const paramsOf = (request: CalculationRequest): CalculationParams => ({
  year: request.year,
  regionCode: request.regionCode,
  analysisCode: request.indicators.map(indicator => indicator.code).join(',')
});

export interface IndicatorCalculationOptions {
  readonly api: IndicatorApi;
  /** 默认按当前登录会话核对；组件样例不登录，传入总是有效的核对 */
  readonly sessionGuard?: SessionGuard;
}

/**
 * 指标计算的拥有者：一次只有一个任务，新的任务、重置、作用域销毁都会作废上一次的进度查询（ADR 0039 的可替换操作）。
 * 开始计算是服务端写操作，按会话核对，不随页面卸载取消；确认框和提示由界面负责
 */
export function useIndicatorCalculation(options: IndicatorCalculationOptions): IndicatorCalculation {
  if (!getCurrentScope()) {
    throw new Error('useIndicatorCalculation 只能在组件的 setup 或 effectScope 中调用');
  }
  const { api } = options;
  const sessionGuard = options.sessionGuard ?? useSessionGuard();
  const task = shallowRef<CalculationTask | null>(null);
  const preparing = shallowRef(false);
  // 每个任务一个信号：换任务、重置、重新获取进度时中止，晚到的结果不写入
  const tasks = new LatestController();
  let disposed = false;
  onScopeDispose(() => {
    disposed = true;
    tasks[Symbol.dispose]();
  });

  const update = (signal: AbortSignal, patch: Partial<CalculationTask>) => {
    if (!signal.aborted && task.value !== null) {
      task.value = { ...task.value, ...patch };
    }
  };

  // 按间隔查进度，直到全部处理完或连续失败；每个等待点之后都确认这次仍然有效
  const poll = async (params: CalculationParams, signal: AbortSignal) => {
    let failures = 0;
    while (!signal.aborted) {
      try {
        // oxlint-disable-next-line no-await-in-loop -- 轮询：上一次返回后才决定是否查下一次
        const progress = await api.fetchProgress(params, signal);
        if (signal.aborted) {
          return;
        }
        failures = 0;
        // 后端还没登记这次计算时没有进度：保留上一次查到的，接着查（同旧页面）
        if (progress === null) {
          update(signal, { phase: 'running' });
        } else {
          update(signal, { phase: progress.finished ? 'finished' : 'running', progress });
          if (progress.finished) {
            return;
          }
        }
      } catch {
        if (signal.aborted) {
          return;
        }
        failures++;
        if (failures >= PROGRESS_MAX_FAILURES) {
          update(signal, { phase: 'stalled' });
          return;
        }
      }
      // oxlint-disable-next-line no-await-in-loop -- 两次查询之间按间隔等待
      await wait(PROGRESS_INTERVAL, signal);
    }
  };

  const run = async (request: CalculationRequest, token: string | undefined) => {
    const signal = tasks.next();
    const params = paramsOf(request);
    task.value = { request, phase: 'creating', progress: null, error: null };
    try {
      sessionGuard.assertCurrent(token);
      await api.startCalculation(params);
    } catch (error) {
      // 失败原因已由全局提示显示，进度面板里再写一次
      update(signal, { phase: 'failed', error: error instanceof Error ? error.message : null });
      return;
    }
    // 计算已经提交；换了会话时不再查进度
    if (signal.aborted || disposed || !sessionGuard.isCurrent(token)) {
      return;
    }
    update(signal, { phase: 'starting' });
    await wait(FIRST_PROGRESS_DELAY, signal);
    await poll(params, signal);
  };

  const start = async (request: CalculationRequest, confirm: (existing: boolean) => Promise<boolean>) => {
    if (disposed || preparing.value || isCalculationBusy(task.value)) {
      return;
    }
    const token = sessionGuard.capture();
    preparing.value = true;
    try {
      // 验证失败不挡住计算，按没有结果确认
      const existing = await api.verifyCalculation(paramsOf(request)).catch(() => false);
      if (disposed) {
        return;
      }
      const confirmed = await confirm(existing);
      if (!confirmed || disposed || !sessionGuard.isCurrent(token)) {
        return;
      }
    } finally {
      preparing.value = false;
    }
    await run(request, token);
  };

  const retryProgress = () => {
    const current = task.value;
    if (current?.phase !== 'stalled') {
      return;
    }
    const signal = tasks.next();
    task.value = { ...current, phase: 'running' };
    void poll(paramsOf(current.request), signal);
  };

  const reset = () => {
    tasks.next();
    task.value = null;
  };

  return {
    task: shallowReadonly(task),
    busy: computed(() => preparing.value || isCalculationBusy(task.value)),
    start,
    retryProgress,
    reset
  };
}
