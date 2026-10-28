import { flushPromises, mount } from '@vue/test-utils';
import { ElMessage, ElMessageBox, type MessageBoxData } from 'element-plus';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computed, render, shallowRef, type VNode } from 'vue';
import { required } from '@/shared/testing/required';
import type {
  CalculationEntry,
  StatisticsCalculation,
  SubmitOutcome
} from '../composables/useStatisticsCalculation';
import { StatisticsCalculationPanel } from './StatisticsCalculationPanel';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

// 提交时把这些组合交给确认框，确认后返回 outcome
function fakeCalculation(entries: readonly CalculationEntry[], outcome: SubmitOutcome) {
  const confirmed = shallowRef<boolean | null>(null);
  const calculation: StatisticsCalculation = {
    year: shallowRef('2025'),
    baseYear: computed(() => '2024年'),
    selected: shallowRef(new Set(['baseTable:province'])),
    allState: computed(() => ({ checked: false, indeterminate: true })),
    tableState: () => ({ checked: false, indeterminate: false }),
    canStart: computed(() => true),
    submitting: shallowRef(false),
    setYear: vi.fn<StatisticsCalculation['setYear']>(),
    toggle: vi.fn<StatisticsCalculation['toggle']>(),
    toggleTable: vi.fn<StatisticsCalculation['toggleTable']>(),
    toggleAll: vi.fn<StatisticsCalculation['toggleAll']>(),
    submit: async confirm => {
      confirmed.value = await confirm(entries);
      return confirmed.value ? outcome : { kind: 'canceled' };
    }
  };
  return { calculation, confirmed };
}

const entry = (level: CalculationEntry['level'], status: CalculationEntry['status'], statusText: string) =>
  ({ table: 'baseTable', level, status, statusText }) satisfies CalculationEntry;

// 确认框的内容是 VNode：渲染出来取文字
function messageText(message: unknown) {
  if (typeof message === 'string') {
    return message;
  }
  const container = document.createElement('div');
  render(message as VNode, container);
  return container.textContent ?? '';
}

async function clickStart(wrapper: ReturnType<typeof mount>) {
  await required(
    wrapper.findAll('button').find(button => button.text() === '开始统计分析'),
    '开始统计分析'
  ).trigger('click');
  await flushPromises();
}

describe('StatisticsCalculationPanel', () => {
  it('本底年度只读；暂未开放的报表不能勾，没有等级', () => {
    const { calculation } = fakeCalculation([], { kind: 'accepted' });
    const wrapper = mount(StatisticsCalculationPanel, { props: { calculation } });

    expect(wrapper.findAll('input[disabled]').map(input => (input.element as HTMLInputElement).value)).toContain('2024年');
    const changeTable = required(
      wrapper.findAll('article').find(article => article.text().includes('变化统计报表')),
      '变化统计报表'
    );
    expect(changeTable.text()).toContain('暂未开放');
    expect(changeTable.findAll('.el-checkbox')).toHaveLength(1);
    expect(changeTable.find('.el-checkbox').classes()).toContain('is-disabled');
  });

  it('没有已有任务时确认一句话；有时逐条列出并提醒正在处理的会被打断', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as MessageBoxData);
    const fresh = fakeCalculation([entry('province', 'notStarted', '未处理')], { kind: 'accepted' });
    await clickStart(mount(StatisticsCalculationPanel, { props: { calculation: fresh.calculation } }));
    expect(messageText(confirm.mock.calls[0]?.[0])).toBe('本次将提交 1 项统计分析任务，是否继续？');

    const existing = fakeCalculation(
      [
        entry('province', 'failed', '已有统计任务'),
        entry('city', 'processing', '已有统计任务'),
        entry('district', 'notStarted', '未处理')
      ],
      { kind: 'accepted' }
    );
    await clickStart(mount(StatisticsCalculationPanel, { props: { calculation: existing.calculation } }));
    const text = messageText(confirm.mock.calls[1]?.[0]);
    expect(text).toContain('本次将提交 3 项，其中 2 项已有统计任务，继续将重新统计并覆盖原有结果');
    expect(text).toContain('基本统计报表 / 省级已有统计任务');
    expect(text).toContain('基本统计报表 / 市级已有统计任务');
    expect(text).not.toContain('区级');
    expect(text).toContain('其中包含正在处理的项目');
    expect(confirm.mock.calls[1]?.[1]).toBe('确认开始统计分析？');
  });

  it('被拒绝时报错，没有明确结果时提醒不要重复提交', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as MessageBoxData);
    const error = vi.spyOn(ElMessage, 'error').mockReturnValue({ close: () => undefined });
    const warning = vi.spyOn(ElMessage, 'warning').mockReturnValue({ close: () => undefined });

    const rejected = fakeCalculation([entry('province', 'notStarted', '未处理')], {
      kind: 'rejected',
      message: '已有统计任务在执行'
    });
    await clickStart(mount(StatisticsCalculationPanel, { props: { calculation: rejected.calculation } }));
    expect(error).toHaveBeenCalledWith('已有统计任务在执行');

    const uncertain = fakeCalculation([entry('province', 'notStarted', '未处理')], {
      kind: 'uncertain',
      message: '网络异常'
    });
    await clickStart(mount(StatisticsCalculationPanel, { props: { calculation: uncertain.calculation } }));
    expect(warning).toHaveBeenCalledWith('提交响应未确认，正在查询任务状态，请勿重复提交');
  });

  // 关掉后确认框按取消结束；页面已经卸载时不再提交由拥有者保证（useStatisticsCalculation 的测试）
  it('确认框打开期间面板卸载：关掉本组件打开的确认框；没有打开的不关', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockImplementation(() => new Promise(() => undefined));
    const close = vi.spyOn(ElMessageBox, 'close').mockImplementation(() => undefined);
    const { calculation } = fakeCalculation([entry('province', 'notStarted', '未处理')], { kind: 'accepted' });
    const idle = mount(StatisticsCalculationPanel, { props: { calculation } });
    idle.unmount();
    expect(close).not.toHaveBeenCalled();

    const wrapper = mount(StatisticsCalculationPanel, { props: { calculation } });
    await clickStart(wrapper);
    wrapper.unmount();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
