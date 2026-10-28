import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { ElMessageBox, type MessageBoxData } from 'element-plus';
import { createPinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IndicatorApi } from '@/features/monitoring-indicators/api';
import type { IndicatorLeaf, IndicatorTreeNode } from '@/features/monitoring-indicators/indicator-tree';
import { resultLayersOf } from '@/features/monitoring-indicators/result-layers';
import type { SessionGuard } from '@/shared/auth/session-guard';
import { required } from '@/shared/testing/required';
import { SpaceMonitoringIndicatorsPage } from './SpaceMonitoringIndicatorsPage';

const leaf = (code: string, name: string, dataId: string | null): IndicatorLeaf => ({
  kind: 'leaf',
  code,
  dataId,
  name,
  disabled: false,
  status: null,
  result: dataId === null ? null : '40.04%',
  reason: null
});

const treeOf = (dataId: string | null): IndicatorTreeNode[] => [
  { kind: 'group', code: 'A', name: '教育便利性', children: [leaf('A-32', '社区小学步行10分钟覆盖率（%）', dataId)] }
];

const API: IndicatorApi = {
  fetchTree: source => Promise.resolve(treeOf(source === 'result' ? 'e3472ce215e0420baec22477cb48721b' : null)),
  verifyCalculation: () => Promise.resolve(false),
  startCalculation: () => Promise.resolve(),
  fetchProgress: () => Promise.resolve(null),
  fetchResult: id =>
    Promise.resolve({
      analysisId: id,
      value: '40.04%',
      layers: resultLayersOf([{ key: 'xxp', name: '社区小学', geometry: 'point' }])
    })
};

const GUARD: SessionGuard = { capture: () => 'session', isCurrent: () => true, assertCurrent: () => undefined };

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

// jsdom 没有 matchMedia：窄屏时模拟一个始终匹配的版本，否则按宽屏
function stubNarrow() {
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    matches: true,
    addEventListener: () => undefined,
    removeEventListener: () => undefined
  }));
}

// 画布用真实的 MapLibre，jsdom 里创建不出来；这里只看面板，换成空的替身
async function mountPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = mount(SpaceMonitoringIndicatorsPage, {
    props: { api: API, sessionGuard: GUARD },
    global: { plugins: [createPinia(), [VueQueryPlugin, { queryClient }]], stubs: { MapCanvas: true } },
    attachTo: document.body
  });
  await flushPromises();
  return wrapper;
}

const shown = (wrapper: VueWrapper, selector: string) => {
  const element = wrapper.find(selector);
  return element.exists() && element.isVisible();
};

async function check(wrapper: VueWrapper, name: string) {
  const box = required(
    wrapper.findAll('.el-checkbox').find(item => item.isVisible() && item.text() === name),
    `${name} 的复选框`
  );
  await box.get('input').setValue(true);
}

async function startCalculation(wrapper: VueWrapper) {
  vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as MessageBoxData);
  await check(wrapper, '社区小学步行10分钟覆盖率（%）');
  const start = required(
    wrapper.findAll('button').find(button => button.text() === '开始计算'),
    '开始计算按钮'
  );
  await start.trigger('click');
  await flushPromises();
}

describe('SpaceMonitoringIndicatorsPage', () => {
  it('宽屏时指标面板和进度一起显示', async () => {
    const wrapper = await mountPage();
    await startCalculation(wrapper);

    expect(shown(wrapper, '[data-calculation-progress]')).toBe(true);
    expect(wrapper.find('button[aria-label="展开监测指标"]').exists()).toBe(false);
  });

  it('窄屏时开始计算让出左边、显示进度；展开指标面板时进度隐藏，收起后回来', async () => {
    stubNarrow();
    const wrapper = await mountPage();
    // 先收起再展开指标面板：最后操作的是左边
    await wrapper.get('button[aria-label="收起监测指标"]').trigger('click');
    await wrapper.get('button[aria-label="展开监测指标"]').trigger('click');
    await startCalculation(wrapper);

    expect(shown(wrapper, '[data-calculation-progress]')).toBe(true);
    expect(wrapper.find('button[aria-label="展开监测指标"]').exists()).toBe(true);

    await wrapper.get('button[aria-label="展开监测指标"]').trigger('click');
    expect(shown(wrapper, '[data-calculation-progress]')).toBe(false);

    await wrapper.get('button[aria-label="收起监测指标"]').trigger('click');
    expect(shown(wrapper, '[data-calculation-progress]')).toBe(true);
  });

  it('展示页签选中指标后显示成果；切回计算再回来要重新选', async () => {
    const wrapper = await mountPage();
    const tab = (name: string) =>
      required(
        wrapper.findAll('[role="tab"]').find(item => item.text() === name),
        `${name}页签`
      );

    await tab('指标展示').trigger('click');
    await check(wrapper, '社区小学步行10分钟覆盖率（%）');
    await flushPromises();
    expect(wrapper.get('[data-indicator-result]').text()).toContain('40.04%');

    await tab('指标计算').trigger('click');
    expect(wrapper.find('[data-indicator-result]').exists()).toBe(false);
    await tab('指标展示').trigger('click');
    expect(wrapper.find('[data-indicator-result]').exists()).toBe(false);
  });
});
