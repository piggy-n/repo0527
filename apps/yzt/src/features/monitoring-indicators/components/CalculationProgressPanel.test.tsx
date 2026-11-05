import { flushPromises, mount } from '@vue/test-utils';
import { ElMessage } from 'element-plus';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computed, shallowRef } from 'vue';
import { required } from '@/shared/testing/required';
import { type CalculationTask, isCalculationBusy } from '../calculation';
import type { IndicatorCalculation } from '../composables/useIndicatorCalculation';
import { CalculationProgressPanel } from './CalculationProgressPanel';

const TASK: CalculationTask = {
  request: {
    year: 2025,
    regionCode: '320100',
    regionName: '南京市',
    indicators: [
      { code: 'A-32', name: '社区小学步行10分钟覆盖率（%）' },
      { code: 'A-33', name: '社区中学步行15分钟覆盖率（%）' },
      { code: 'A-14', name: '人均应急避难场所面积（m²）' }
    ]
  },
  phase: 'running',
  progress: {
    rows: [
      { code: 'A-32', name: '社区小学步行10分钟覆盖率（%）', status: 'completed', result: '40.04%' },
      { code: 'A-33', name: '社区中学步行15分钟覆盖率（%）', status: 'processing', result: null }
    ],
    percent: 33,
    finished: false,
    statusText: null
  },
  error: null
};

afterEach(() => {
  vi.restoreAllMocks();
});

function mountPanel(initial: CalculationTask | null) {
  const task = shallowRef(initial);
  const calculation: IndicatorCalculation = {
    task,
    busy: computed(() => isCalculationBusy(task.value)),
    start: vi.fn<IndicatorCalculation['start']>(),
    retryProgress: vi.fn<IndicatorCalculation['retryProgress']>(),
    reset: vi.fn<IndicatorCalculation['reset']>()
  };
  return { wrapper: mount(CalculationProgressPanel, { props: { calculation } }), task, calculation };
}

describe('CalculationProgressPanel', () => {
  it('没有计算时不显示', () => {
    const { wrapper } = mountPanel(null);
    expect(wrapper.find('[data-calculation-progress]').exists()).toBe(false);
  });

  it('显示这次计算的条件、数量和每个指标的状态，完成的显示结果', async () => {
    const { wrapper } = mountPanel(TASK);
    // 表格的列在挂载后登记，下一轮才渲染单元格
    await flushPromises();
    const text = wrapper.text();

    expect(text).toContain('2025年');
    expect(text).toContain('南京市');
    expect(text).toContain('正在处理中，已完成33%');
    expect(text).toContain('3个指标，1个正在计算，1个已完成，0个计算失败');
    const rows = wrapper.findAll('.el-table__body tr').map(row => row.findAll('td').map(cell => cell.text()));
    expect(rows).toEqual([
      ['1', '社区小学步行10分钟覆盖率（%）', '已完成', '40.04%'],
      ['2', '社区中学步行15分钟覆盖率（%）', '正在处理', ''],
      ['3', '人均应急避难场所面积（m²）', '待计算', '']
    ]);
  });

  it('进度连续失败停下时提示一次，可以重新获取', async () => {
    const error = vi.spyOn(ElMessage, 'error').mockReturnValue({ close: () => undefined });
    const { wrapper, task, calculation } = mountPanel(TASK);
    expect(wrapper.findAll('button').some(button => button.text() === '重新获取进度')).toBe(false);

    task.value = { ...TASK, phase: 'stalled' };
    await wrapper.vm.$nextTick();
    expect(error).toHaveBeenCalledWith('进度获取连续失败，请点击重新获取进度');
    const retry = required(
      wrapper.findAll('button').find(button => button.text() === '重新获取进度'),
      '重新获取进度'
    );
    await retry.trigger('click');
    expect(calculation.retryProgress).toHaveBeenCalledTimes(1);
  });

  it('可以最大化、收起；新的计算开始时恢复', async () => {
    const { wrapper, task } = mountPanel(TASK);
    await wrapper.get('button[aria-label="最大化数据处理进度"]').trigger('click');
    expect(wrapper.find('button[aria-label="还原数据处理进度"]').exists()).toBe(true);
    await wrapper.get('button[aria-label="收起数据处理进度"]').trigger('click');
    expect(wrapper.find('.el-table').exists()).toBe(false);

    task.value = { ...TASK, request: { ...TASK.request, year: 2024 }, progress: null };
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.el-table').exists()).toBe(true);
    expect(wrapper.find('button[aria-label="最大化数据处理进度"]').exists()).toBe(true);
  });
});
