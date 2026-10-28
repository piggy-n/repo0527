// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  calculationCounts,
  type CalculationProgress,
  type CalculationRequest,
  calculationResultValue,
  calculationRows,
  calculationRowStatus,
  calculationStatusText,
  type CalculationTask,
  isCalculationBusy
} from './calculation';

const request: CalculationRequest = {
  year: 2025,
  regionCode: '320100',
  regionName: '南京市',
  indicators: [
    { code: 'A-32', name: '社区小学步行10分钟覆盖率（%）' },
    { code: 'A-33', name: '社区中学步行15分钟覆盖率（%）' },
    { code: 'A-14', name: '人均应急避难场所面积（m²）' }
  ]
};

const progress = (change: Partial<CalculationProgress> = {}): CalculationProgress => ({
  rows: [
    { code: 'A-33', name: '社区中学步行15分钟覆盖率（%）', status: 'completed', result: '50.98%' },
    { code: 'A-14', name: '人均应急避难场所面积（m²）', status: 'failed', result: null }
  ],
  percent: 67,
  finished: false,
  statusText: null,
  ...change
});

const task = (change: Partial<CalculationTask> = {}): CalculationTask => ({
  request,
  phase: 'running',
  progress: progress(),
  error: null,
  ...change
});

describe('计算进度', () => {
  it('按结果原文判断每个指标的状态，认不出的不算完成', () => {
    expect(calculationRowStatus('')).toBe('pending');
    expect(calculationRowStatus('正在处理')).toBe('processing');
    expect(calculationRowStatus('分析结果:40.04%')).toBe('completed');
    expect(calculationRowStatus('计算失败')).toBe('failed');
    expect(calculationRowStatus('数据异常')).toBe('failed');
    expect(calculationRowStatus('排队中')).toBe('pending');
  });

  it('结果只留数值和单位', () => {
    expect(calculationResultValue('分析结果:40.04%')).toBe('40.04%');
    expect(calculationResultValue('分析结果：123')).toBe('123');
    expect(calculationResultValue('8.5507')).toBe('8.5507');
  });

  it('面板按提交的指标顺序列出，进度里还没有的是待计算；数量按行统计', () => {
    const rows = calculationRows(task());
    expect(rows.map(row => [row.code, row.status])).toEqual([
      ['A-32', 'pending'],
      ['A-33', 'completed'],
      ['A-14', 'failed']
    ]);
    expect(calculationCounts(rows)).toEqual({ total: 3, processing: 0, completed: 1, failed: 1 });
  });

  it('创建、开始和查进度期间不能再开始一次计算；完成、失败、进度卡住时可以', () => {
    expect(isCalculationBusy(null)).toBe(false);
    expect(isCalculationBusy(task({ phase: 'creating' }))).toBe(true);
    expect(isCalculationBusy(task({ phase: 'starting' }))).toBe(true);
    expect(isCalculationBusy(task({ phase: 'running' }))).toBe(true);
    expect(isCalculationBusy(task({ phase: 'stalled' }))).toBe(false);
    expect(isCalculationBusy(task({ phase: 'finished' }))).toBe(false);
    expect(isCalculationBusy(task({ phase: 'failed' }))).toBe(false);
  });

  it('当前状态优先用后端的说明，没有时按阶段和数量写', () => {
    expect(calculationStatusText(task({ phase: 'creating', progress: null }))).toBe('正在创建计算任务');
    expect(calculationStatusText(task({ phase: 'failed', progress: null, error: '后端繁忙' }))).toBe('后端繁忙');
    expect(calculationStatusText(task({ phase: 'stalled' }))).toBe('进度获取连续失败，请重新获取进度');
    expect(calculationStatusText(task({ phase: 'starting', progress: null }))).toBe('计算任务已创建，正在初始化');
    expect(calculationStatusText(task())).toBe('正在处理中，已完成67%');
    expect(calculationStatusText(task({ phase: 'finished', progress: progress({ percent: 100 }) }))).toBe(
      '处理完成，1个指标计算失败'
    );
    expect(calculationStatusText(task({ progress: progress({ statusText: '已处理完成' }) }))).toBe('已处理完成');
  });
});
