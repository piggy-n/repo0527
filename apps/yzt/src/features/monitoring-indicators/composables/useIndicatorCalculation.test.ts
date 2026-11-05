// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, type EffectScope } from 'vue';
import type { SessionGuard } from '@/shared/auth/session-guard';
import { required } from '@/shared/testing/required';
import type { CalculationParams, IndicatorApi } from '../api';
import type { CalculationProgress, CalculationRequest } from '../calculation';
import {
  FIRST_PROGRESS_DELAY,
  PROGRESS_INTERVAL,
  PROGRESS_MAX_FAILURES,
  useIndicatorCalculation
} from './useIndicatorCalculation';

const request: CalculationRequest = {
  year: 2025,
  regionCode: '320100',
  regionName: '南京市',
  indicators: [
    { code: 'A-32', name: '社区小学步行10分钟覆盖率（%）' },
    { code: 'A-33', name: '社区中学步行15分钟覆盖率（%）' }
  ]
};

const PARAMS: CalculationParams = { year: 2025, regionCode: '320100', analysisCode: 'A-32,A-33' };

const progress = (percent: number): CalculationProgress => ({
  rows: [{ code: 'A-32', name: '社区小学步行10分钟覆盖率（%）', status: 'completed', result: '40.04%' }],
  percent,
  finished: percent === 100,
  statusText: null
});

function fakeApi(change: Partial<IndicatorApi> = {}) {
  return {
    fetchTree: vi.fn<IndicatorApi['fetchTree']>(() => Promise.resolve([])),
    verifyCalculation: vi.fn<IndicatorApi['verifyCalculation']>(() => Promise.resolve(false)),
    startCalculation: vi.fn<IndicatorApi['startCalculation']>(() => Promise.resolve()),
    fetchProgress: vi.fn<IndicatorApi['fetchProgress']>(() => Promise.resolve(progress(100))),
    fetchResult: vi.fn<IndicatorApi['fetchResult']>(() => Promise.reject(new Error('没有成果'))),
    ...change
  };
}

// 会话核对：token 换了就不是同一个会话
function fakeGuard() {
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
  return { guard, switchSession: () => (token = 'session-2') };
}

const scopes: EffectScope[] = [];
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  scopes.splice(0).forEach(scope => scope.stop());
  vi.useRealTimers();
});

function host(api: IndicatorApi, guard = fakeGuard().guard) {
  const scope = effectScope();
  scopes.push(scope);
  const calculation = required(
    scope.run(() => useIndicatorCalculation({ api, sessionGuard: guard })),
    '指标计算的拥有者'
  );
  return { calculation, scope };
}

describe('useIndicatorCalculation', () => {
  it('先验证再确认，确认后提交；等一会儿再按间隔查进度，全部处理完就停下', async () => {
    const api = fakeApi({
      verifyCalculation: vi.fn<IndicatorApi['verifyCalculation']>(() => Promise.resolve(true)),
      fetchProgress: vi
        .fn<IndicatorApi['fetchProgress']>()
        .mockResolvedValueOnce(progress(50))
        .mockResolvedValueOnce(progress(100))
    });
    const { calculation } = host(api);
    const confirm = vi.fn<(existing: boolean) => Promise<boolean>>(() => Promise.resolve(true));

    void calculation.start(request, confirm);
    await vi.advanceTimersByTimeAsync(0);

    expect(api.verifyCalculation).toHaveBeenCalledWith(PARAMS);
    expect(confirm).toHaveBeenCalledWith(true);
    expect(api.startCalculation).toHaveBeenCalledWith(PARAMS);
    expect(calculation.task.value).toMatchObject({ phase: 'starting', progress: null });
    expect(calculation.busy.value).toBe(true);

    await vi.advanceTimersByTimeAsync(FIRST_PROGRESS_DELAY);
    expect(api.fetchProgress).toHaveBeenCalledTimes(1);
    expect(calculation.task.value).toMatchObject({ phase: 'running', progress: { percent: 50 } });

    await vi.advanceTimersByTimeAsync(PROGRESS_INTERVAL);
    expect(calculation.task.value).toMatchObject({ phase: 'finished', progress: { percent: 100 } });
    expect(calculation.busy.value).toBe(false);

    await vi.advanceTimersByTimeAsync(PROGRESS_INTERVAL * 3);
    expect(api.fetchProgress).toHaveBeenCalledTimes(2);
  });

  it('取消确认不提交；验证失败按没有结果确认', async () => {
    const api = fakeApi({ verifyCalculation: vi.fn<IndicatorApi['verifyCalculation']>(() => Promise.reject(new Error('验证失败'))) });
    const { calculation } = host(api);
    const confirm = vi.fn<(existing: boolean) => Promise<boolean>>(() => Promise.resolve(false));

    await calculation.start(request, confirm);

    expect(confirm).toHaveBeenCalledWith(false);
    expect(api.startCalculation).not.toHaveBeenCalled();
    expect(calculation.task.value).toBeNull();
    expect(calculation.busy.value).toBe(false);
  });

  it('确认期间换了会话不提交', async () => {
    const api = fakeApi();
    const { guard, switchSession } = fakeGuard();
    const { calculation } = host(api, guard);

    await calculation.start(request, () => {
      switchSession();
      return Promise.resolve(true);
    });

    expect(api.startCalculation).not.toHaveBeenCalled();
    expect(calculation.task.value).toBeNull();
  });

  it('开始计算失败：显示失败原因，不查进度，可以再开始', async () => {
    const api = fakeApi({ startCalculation: vi.fn<IndicatorApi['startCalculation']>(() => Promise.reject(new Error('后端繁忙'))) });
    const { calculation } = host(api);

    await calculation.start(request, () => Promise.resolve(true));
    await vi.advanceTimersByTimeAsync(FIRST_PROGRESS_DELAY);

    expect(calculation.task.value).toMatchObject({ phase: 'failed', error: '后端繁忙' });
    expect(api.fetchProgress).not.toHaveBeenCalled();
    expect(calculation.busy.value).toBe(false);
  });

  it('后端还没有这次计算的进度时保留上一次的，接着查', async () => {
    const api = fakeApi({
      fetchProgress: vi
        .fn<IndicatorApi['fetchProgress']>()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(progress(50))
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(progress(100))
    });
    const { calculation } = host(api);

    void calculation.start(request, () => Promise.resolve(true));
    await vi.advanceTimersByTimeAsync(FIRST_PROGRESS_DELAY);
    expect(calculation.task.value).toMatchObject({ phase: 'running', progress: null });

    await vi.advanceTimersByTimeAsync(PROGRESS_INTERVAL * 2);
    expect(calculation.task.value).toMatchObject({ phase: 'running', progress: { percent: 50 } });

    await vi.advanceTimersByTimeAsync(PROGRESS_INTERVAL);
    expect(calculation.task.value).toMatchObject({ phase: 'finished' });
  });

  it('进度连续失败几次后停下，重新获取进度时马上再查；中间成功一次就重新计数', async () => {
    const fetchProgress = vi
      .fn<IndicatorApi['fetchProgress']>()
      .mockRejectedValueOnce(new Error('超时'))
      .mockResolvedValueOnce(progress(50))
      .mockRejectedValue(new Error('超时'));
    const api = fakeApi({ fetchProgress });
    const { calculation } = host(api);

    void calculation.start(request, () => Promise.resolve(true));
    await vi.advanceTimersByTimeAsync(FIRST_PROGRESS_DELAY + PROGRESS_INTERVAL * PROGRESS_MAX_FAILURES);
    expect(calculation.task.value?.phase).toBe('running');

    await vi.advanceTimersByTimeAsync(PROGRESS_INTERVAL);
    expect(calculation.task.value).toMatchObject({ phase: 'stalled', progress: { percent: 50 } });
    expect(calculation.busy.value).toBe(false);
    const calls = fetchProgress.mock.calls.length;

    await vi.advanceTimersByTimeAsync(PROGRESS_INTERVAL * 3);
    expect(fetchProgress).toHaveBeenCalledTimes(calls);

    fetchProgress.mockResolvedValue(progress(100));
    calculation.retryProgress();
    expect(calculation.task.value?.phase).toBe('running');
    await vi.advanceTimersByTimeAsync(0);
    expect(calculation.task.value?.phase).toBe('finished');
  });

  it('进行中不能再开始；重置停止查进度、清掉任务', async () => {
    const api = fakeApi({ fetchProgress: vi.fn<IndicatorApi['fetchProgress']>(() => Promise.resolve(progress(50))) });
    const { calculation } = host(api);

    void calculation.start(request, () => Promise.resolve(true));
    await vi.advanceTimersByTimeAsync(FIRST_PROGRESS_DELAY);
    await calculation.start(request, () => Promise.resolve(true));
    expect(api.verifyCalculation).toHaveBeenCalledTimes(1);

    calculation.reset();
    expect(calculation.task.value).toBeNull();
    await vi.advanceTimersByTimeAsync(PROGRESS_INTERVAL * 3);
    expect(api.fetchProgress).toHaveBeenCalledTimes(1);
  });

  it('作用域销毁后不再查进度', async () => {
    const api = fakeApi({ fetchProgress: vi.fn<IndicatorApi['fetchProgress']>(() => Promise.resolve(progress(50))) });
    const { calculation, scope } = host(api);

    void calculation.start(request, () => Promise.resolve(true));
    await vi.advanceTimersByTimeAsync(FIRST_PROGRESS_DELAY);
    scope.stop();
    await vi.advanceTimersByTimeAsync(PROGRESS_INTERVAL * 3);

    expect(api.fetchProgress).toHaveBeenCalledTimes(1);
  });
});
