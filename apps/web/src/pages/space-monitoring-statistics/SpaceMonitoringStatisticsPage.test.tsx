import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { ElDatePicker, ElMessageBox, type MessageBoxData } from 'element-plus';
import { createPinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import type { StatisticsApi } from '@/features/monitoring-statistics/api';
import type { ReportStatus } from '@/features/monitoring-statistics/report';
import { defaultYear } from '@/features/monitoring-statistics/statistics';
import { Role } from '@/shared/auth/roles';
import type { SessionGuard } from '@/shared/auth/session-guard';
import { RouteName } from '@/shared/router/route-names';
import { required } from '@/shared/testing/required';
import { SpaceMonitoringStatisticsPage } from './SpaceMonitoringStatisticsPage';

const OPTIONS = {
  tables: [
    { value: 'baseTable', label: '基本统计报表' },
    { value: 'summaryTable', label: '汇总统计报表' },
    { value: 'baseChangeTable', label: '基本变化统计报表' }
  ],
  levels: [
    { value: 'province', label: '省级' },
    { value: 'city', label: '市级' }
  ]
} as const satisfies Pick<ReportStatus, 'tables' | 'levels'>;

const empty: ReportStatus = {
  rows: [],
  counts: { total: 0, completed: 0, failed: 0, processing: 0, notStarted: 0 },
  progress: null,
  statusText: null,
  ...OPTIONS
};

const finished: ReportStatus = {
  ...empty,
  rows: [
    {
      year: '2025',
      regionName: '江苏省',
      name: '江苏省城汇1-1表',
      status: 'completed',
      statusText: '处理成功',
      completeTime: null,
      cause: null
    }
  ],
  counts: { total: 1, completed: 1, failed: 0, processing: 0, notStarted: 0 },
  progress: 100
};

// 只有汇总统计的省级有结果
const API: StatisticsApi = {
  fetchOverview: () => Promise.resolve(new Map([['summaryTable:province', '处理成功']])),
  fetchReport: ({ table, level }) =>
    Promise.resolve(table === 'summaryTable' && level === 'province' ? finished : empty),
  createTasks: () => Promise.resolve()
};

const GUARD: SessionGuard = { capture: () => 'session', isCurrent: () => true, assertCurrent: () => undefined };

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

async function mountPage(role: Role) {
  const Empty = defineComponent(() => () => null);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: RouteName.spaceMonitoringBasicStatistics, component: Empty },
      { path: '/reports', name: RouteName.systemManagementReports, component: Empty }
    ]
  });
  await router.push('/');
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = mount(SpaceMonitoringStatisticsPage, {
    props: { api: API, sessionGuard: GUARD, role },
    global: { plugins: [createPinia(), router, [VueQueryPlugin, { queryClient }]] },
    attachTo: document.body
  });
  await flushPromises();
  return { wrapper, router };
}

const button = (wrapper: VueWrapper, name: string) =>
  required(
    wrapper.findAll('button').find(item => item.text() === name),
    name
  );
const asideHidden = (wrapper: VueWrapper) => wrapper.find('aside').classes().some(name => name.includes('hidden'));

describe('SpaceMonitoringStatisticsPage', () => {
  it('初次进入时当前组合没有结果，落到总览里第一个有结果的组合', async () => {
    const { wrapper } = await mountPage(Role.admin);
    await flushPromises();

    expect(wrapper.find('[aria-pressed="true"]').text()).toBe('处理成功');
    expect(wrapper.text()).toContain('共1个报表');
  });

  it('左栏默认收起，收起、展开的把手是设计图；展开后提交、确认，左栏再收起', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as MessageBoxData);
    const { wrapper } = await mountPage(Role.admin);
    expect(asideHidden(wrapper)).toBe(true);

    const rail = button(wrapper, '统计报表计算');
    expect(rail.find('img').exists()).toBe(true);
    await rail.trigger('click');
    expect(asideHidden(wrapper)).toBe(false);
    expect(wrapper.find('button[aria-label="收起统计报表计算"] img').exists()).toBe(true);
    const all = required(
      wrapper.findAll('.el-checkbox').find(item => item.text() === '全选'),
      '全选'
    );
    await all.get('input').setValue(true);
    await button(wrapper, '开始统计分析').trigger('click');
    await flushPromises();

    expect(asideHidden(wrapper)).toBe(true);
  });

  it('左栏第一次展开时，监测年度和两个本底年度跟着正在查看的', async () => {
    const { wrapper } = await mountPage(Role.admin);
    const changeRow = required(
      wrapper.findAll('tbody tr').find(row => row.find('th').text() === '基本变化统计报表'),
      '基本变化统计报表这一行'
    );
    await changeRow.get('button').trigger('click');
    await flushPromises();
    const picker = required(
      wrapper.findAllComponents(ElDatePicker).find(item => item.find('input[aria-label="本底年份"]').exists()),
      '本底年份'
    );
    picker.vm.$emit('update:modelValue', '2022');
    await flushPromises();
    const year = defaultYear();

    await button(wrapper, '统计报表计算').trigger('click');
    const aside = wrapper.get('aside');
    expect(aside.findAll<HTMLInputElement>('.el-date-editor input').map(input => input.element.value)).toEqual([
      `${year}年`,
      '2022年',
      `${Number(year) - 1}年`
    ]);
    expect(aside.text()).toContain('变更本底 2022年');
  });

  it('管理员去系统管理的统计报表下载；普通用户的按钮置灰', async () => {
    const admin = await mountPage(Role.admin);
    await button(admin.wrapper, '去下载').trigger('click');
    await flushPromises();
    expect(admin.router.currentRoute.value.name).toBe(RouteName.systemManagementReports);

    const user = await mountPage(Role.user);
    expect(button(user.wrapper, '去下载').attributes('disabled')).toBeDefined();
  });
});
