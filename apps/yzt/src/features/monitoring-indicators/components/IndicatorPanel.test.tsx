import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { provideMap } from '@yzt/map-vue';
import { ElMessageBox, type MessageBoxData } from 'element-plus';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import type { SessionGuard } from '@/shared/auth/session-guard';
import { JIANGSU_CAMERA } from '@/shared/map/jiangsu';
import { required } from '@/shared/testing/required';
import type { IndicatorApi } from '../api';
import { type IndicatorCalculation, useIndicatorCalculation } from '../composables/useIndicatorCalculation';
import { type IndicatorConditions, useIndicatorConditions } from '../composables/useIndicatorConditions';
import { type IndicatorTree, useIndicatorTree } from '../composables/useIndicatorTree';
import type { IndicatorLeaf, IndicatorTreeNode } from '../indicator-tree';
import { IndicatorPanel, type IndicatorTab } from './IndicatorPanel';

const leaf = (code: string, name: string, change: Partial<IndicatorLeaf> = {}): IndicatorLeaf => ({
  kind: 'leaf',
  code,
  dataId: null,
  name,
  disabled: false,
  status: 'pending',
  result: null,
  reason: null,
  ...change
});

const TREE: IndicatorTreeNode[] = [
  {
    kind: 'group',
    code: 'A',
    name: '教育便利性',
    children: [
      leaf('A-32', '社区小学步行10分钟覆盖率（%）', { status: 'done', result: '40.04%' }),
      leaf('A-33', '社区中学步行15分钟覆盖率（%）'),
      leaf('A-34', '高等学校数量（所）', { disabled: true })
    ]
  }
];

const GUARD: SessionGuard = { capture: () => 'session', isCurrent: () => true, assertCurrent: () => undefined };

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function mountPanel() {
  const verifyCalculation = vi.fn<IndicatorApi['verifyCalculation']>(() => Promise.resolve(true));
  const startCalculation = vi.fn<IndicatorApi['startCalculation']>(() => Promise.resolve());
  const api: IndicatorApi = {
    fetchTree: () => Promise.resolve(TREE),
    verifyCalculation,
    startCalculation,
    fetchProgress: () => Promise.resolve(null),
    fetchResult: () => Promise.reject(new Error('没有成果'))
  };
  const tab = ref<IndicatorTab>('calculation');
  let owners:
    | { conditions: IndicatorConditions; calculationTree: IndicatorTree; calculation: IndicatorCalculation }
    | undefined;
  const Page = defineComponent(() => {
    provideMap({ groups: [], camera: JIANGSU_CAMERA });
    const conditions = useIndicatorConditions();
    conditions.setYear(2025);
    const calculationTree = useIndicatorTree({ api, source: 'calculation', mode: 'multiple', conditions });
    const resultTree = useIndicatorTree({ api, source: 'result', mode: 'single', conditions });
    const calculation = useIndicatorCalculation({ api, sessionGuard: GUARD });
    owners = { conditions, calculationTree, calculation };
    return () => (
      <IndicatorPanel
        tab={tab.value}
        conditions={conditions}
        calculationTree={calculationTree}
        resultTree={resultTree}
        calculation={calculation}
        onUpdate:tab={value => (tab.value = value)}
      />
    );
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = mount(Page, { global: { plugins: [[VueQueryPlugin, { queryClient }]] }, attachTo: document.body });
  return { wrapper, verifyCalculation, startCalculation, tab, ...required(owners, '页面的拥有者') };
}

const startButton = (wrapper: VueWrapper) =>
  required(
    wrapper.findAll('button').find(button => button.text() === '开始计算'),
    '开始计算按钮'
  );

async function check(wrapper: VueWrapper, name: string) {
  const box = required(
    wrapper.findAll('.el-checkbox').find(item => item.text() === name),
    `${name} 的复选框`
  );
  await box.get('input').setValue(true);
}

describe('IndicatorPanel', () => {
  it('勾选指标后开始计算：已有结果时确认是否重新计算，确认后按勾选的先后提交', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as MessageBoxData);
    const { wrapper, verifyCalculation, startCalculation } = mountPanel();
    await flushPromises();
    expect(startButton(wrapper).attributes('disabled')).toBeDefined();

    await check(wrapper, '社区中学步行15分钟覆盖率（%）');
    await check(wrapper, '社区小学步行10分钟覆盖率（%）');
    expect(startButton(wrapper).attributes('disabled')).toBeUndefined();
    await startButton(wrapper).trigger('click');
    await flushPromises();

    expect(verifyCalculation).toHaveBeenCalledWith({ year: 2025, regionCode: '320100', analysisCode: 'A-33,A-32' });
    expect(confirm).toHaveBeenCalledWith('当前选中的指标已存在计算结果，是否重新计算？', '提示', {
      type: 'warning',
      confirmButtonText: '重新计算'
    });
    expect(startCalculation).toHaveBeenCalledWith({ year: 2025, regionCode: '320100', analysisCode: 'A-33,A-32' });
  });

  it('全选只勾可选的指标；禁用的指标勾不上', async () => {
    const { wrapper, calculationTree } = mountPanel();
    await flushPromises();

    const all = required(
      wrapper.findAll('.el-checkbox').find(item => item.text() === '全选'),
      '全选'
    );
    await all.get('input').setValue(true);

    expect([...calculationTree.checked.value]).toEqual(['A-32', 'A-33']);
    const disabled = required(
      wrapper.findAll('.el-checkbox').find(item => item.text() === '高等学校数量（所）'),
      '禁用的指标'
    );
    expect(disabled.classes()).toContain('is-disabled');
  });

  it('按名称搜索指标，没有命中时提示', async () => {
    const { wrapper } = mountPanel();
    await flushPromises();
    const search = wrapper.get('input[placeholder="搜索指标"]');

    await search.setValue('中学');
    // 展示页签的树也挂着（只是隐藏），只看显示出来的
    const shown = wrapper.findAll('.el-checkbox').filter(item => item.isVisible());
    expect(shown.map(item => item.text())).toEqual(['全选', '社区中学步行15分钟覆盖率（%）']);

    await search.setValue('不存在');
    expect(wrapper.text()).toContain('没有找到指标');
  });

  it('确认框打开期间面板卸载：关掉确认框，不提交', async () => {
    const answers: ((value: MessageBoxData) => void)[] = [];
    vi.spyOn(ElMessageBox, 'confirm').mockImplementation(() => new Promise(resolve => answers.push(resolve)));
    const close = vi.spyOn(ElMessageBox, 'close').mockImplementation(() => undefined);
    const { wrapper, startCalculation } = mountPanel();
    await flushPromises();
    await check(wrapper, '社区中学步行15分钟覆盖率（%）');
    await startButton(wrapper).trigger('click');
    await flushPromises();

    wrapper.unmount();
    expect(close).toHaveBeenCalledTimes(1);
    required(answers[0], '打开的确认框')('confirm' as MessageBoxData);
    await flushPromises();
    expect(startCalculation).not.toHaveBeenCalled();
  });

  it('重置回到默认条件，清掉选择和这次计算；切换页签由页面决定', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as MessageBoxData);
    const { wrapper, conditions, calculationTree, calculation, tab } = mountPanel();
    await flushPromises();
    await check(wrapper, '社区中学步行15分钟覆盖率（%）');
    await startButton(wrapper).trigger('click');
    await flushPromises();
    expect(calculation.task.value).not.toBeNull();

    const reset = required(
      wrapper.findAll('button').find(button => button.text() === '重置'),
      '重置按钮'
    );
    await reset.trigger('click');
    expect(conditions.year.value).toBe(new Date().getFullYear());
    expect(conditions.region.value?.code).toBe('320100');
    expect(calculationTree.picked.value).toEqual([]);
    expect(calculation.task.value).toBeNull();

    await wrapper.get('[role="tab"]:not([aria-selected="true"])').trigger('click');
    expect(tab.value).toBe('result');
    expect(wrapper.findAll('button').some(button => button.text() === '开始计算')).toBe(false);
  });
});
