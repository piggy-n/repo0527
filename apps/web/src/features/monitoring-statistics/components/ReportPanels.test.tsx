import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { computed } from 'vue';
import { required } from '@/shared/testing/required';
import type { StatisticsOverview } from '../composables/useStatisticsOverview';
import { overviewMatrix } from '../statistics';
import { ReportMonitorPanel } from './ReportMonitorPanel';
import { ReportProgressPanel } from './ReportProgressPanel';
import { StatisticsOverviewPanel } from './StatisticsOverviewPanel';
import { fakeReport, reportRow, reportStatus } from './test-owners';

const ROWS = [
  reportRow('江苏省城基1-1表', 'completed', '处理成功'),
  reportRow('江苏省城基1-2表', 'failed', '处理失败', '缺少基础数据'),
  reportRow('江苏省城基1-3表', 'completed', '处理成功')
];

describe('ReportProgressPanel', () => {
  it('完成度算上失败；没有任务时不显示 0%', async () => {
    const { report, status } = fakeReport(reportStatus(ROWS));
    const wrapper = mount(ReportProgressPanel, { props: { report } });
    expect(wrapper.text()).toContain('100%');
    expect(wrapper.text()).toContain('成功2');

    status.value = reportStatus([]);
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('—');
    expect(wrapper.text()).not.toContain('0%');
  });

  it('提示里的重新查询交给拥有者；刷新由页面同时刷新总览', async () => {
    const { report, notice } = fakeReport(reportStatus(ROWS));
    notice.value = { type: 'error', text: '查询失败', retry: true };
    const wrapper = mount(ReportProgressPanel, { props: { report } });

    expect(wrapper.text()).toContain('查询失败');
    await required(
      wrapper.findAll('button').find(button => button.text() === '重新查询'),
      '重新查询'
    ).trigger('click');
    expect(report.retry).toHaveBeenCalledTimes(1);
    await required(
      wrapper.findAll('button').find(button => button.text() === '刷新'),
      '刷新'
    ).trigger('click');
    expect(wrapper.emitted('refresh')).toHaveLength(1);
  });
});

const overviewOf = (error: string | null = null): StatisticsOverview => ({
  rows: computed(() => overviewMatrix(new Map([['baseTable:province', '处理失败'], ['summaryTable:city', '正在处理']]))),
  ready: computed(() => true),
  loading: computed(() => false),
  error: computed(() => error),
  updatedAt: computed(() => '09:00:00'),
  refresh: vi.fn<() => void>()
});

describe('StatisticsOverviewPanel', () => {
  it('有状态的格子可以点，当前查看的标为按下；不支持的等级、暂未开放的报表不能点', async () => {
    const wrapper = mount(StatisticsOverviewPanel, {
      props: { overview: overviewOf(), criteria: { year: '2025', table: 'baseTable', level: 'province' } }
    });

    expect(wrapper.text()).toContain('2025年报表统计计算总览');
    const buttons = wrapper.findAll('td button');
    expect(buttons).toHaveLength(6);
    expect(wrapper.findAll('[aria-pressed="true"]').map(item => item.text())).toEqual(['处理失败']);
    expect(buttons[0]?.attributes('aria-pressed')).toBe('true');
    await buttons[5]?.trigger('click');
    expect(wrapper.emitted('select')).toEqual([[{ table: 'summaryTable', level: 'city' }]]);
    expect(wrapper.findAll('td').filter(cell => cell.text() === '暂未开放')).toHaveLength(16);
  });

  it('总览获取失败时显示原因，按钮是重试', () => {
    const overview = overviewOf('总览获取失败');
    const wrapper = mount(StatisticsOverviewPanel, {
      props: { overview, criteria: { year: '2025', table: 'baseTable', level: 'province' } }
    });
    expect(wrapper.find('table').exists()).toBe(false);
    expect(wrapper.text()).toContain('总览获取失败');
    expect(wrapper.findAll('button').some(button => button.text() === '重试')).toBe(true);
  });
});

describe('ReportMonitorPanel', () => {
  it('数量标签兼作筛选：没有这种状态的表时不能点，"共几个"回到全部', async () => {
    const { report } = fakeReport(reportStatus(ROWS));
    const wrapper = mount(ReportMonitorPanel, { props: { report } });
    const tags = wrapper.findAll('.el-check-tag');

    expect(tags.map(tag => tag.text())).toEqual(['共3个报表', '成功: 2个', '失败: 1个', '处理中: 0个', '未处理: 0个']);
    expect(tags[0]?.classes()).toContain('is-checked');
    expect(tags[3]?.classes()).toContain('is-disabled');
    await tags[2]?.trigger('click');
    expect(report.toggleStatus).toHaveBeenCalledWith('failed');
    await tags[0]?.trigger('click');
    expect(report.toggleStatus).toHaveBeenLastCalledWith(null);
  });

  it('能下载时点"去下载"交给页面；不能时按钮置灰并说明原因', async () => {
    const { report } = fakeReport(reportStatus(ROWS));
    const allowed = mount(ReportMonitorPanel, { props: { report } });
    await required(
      allowed.findAll('button').find(button => button.text() === '去下载'),
      '去下载'
    ).trigger('click');
    expect(allowed.emitted('download')).toHaveLength(1);

    const blocked = mount(ReportMonitorPanel, { props: { report, downloadBlocked: '数据下载页面迁移后可用' } });
    await flushPromises();
    const button = required(
      blocked.findAll('button').find(item => item.text() === '去下载'),
      '去下载'
    );
    expect(button.attributes('disabled')).toBeDefined();
  });
});
