import { flushPromises, mount } from '@vue/test-utils';
import { provideMap } from '@yzt/map-vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { JIANGSU_CAMERA } from '@/shared/map/jiangsu';
import { required } from '@/shared/testing/required';
import { sampleComposition } from '../compose/composition';
import { useSimulationMap } from '../composables/useSimulationMap';
import { type SimulationResult, useSimulationResult } from '../composables/useSimulationResult';
import { type SimulationRun, useSimulationRun } from '../composables/useSimulationRun';
import { ManualClock } from '../engine/test-clock';
import { createCalculator } from '../model/calculator';
import { loadTestAtlas } from '../model/test-atlas';
import { previewChanges } from '../result/result-view';
import { ResultStage } from './ResultStage';

// ECharts 在 jsdom 里没有画布，这里只检查图表的分区和配置是否给出，图表本身在页面验收
vi.mock('./SimulationChart', async () => {
  const vue = await import('vue');
  return {
    SimulationChart: vue.defineComponent({
      name: 'SimulationChart',
      props: { label: { type: String, required: true } },
      setup: props => () => <div data-chart={props.label} />
    })
  };
});

// 各步的时长按推理的话多少给：推进这么久一定推演完
const ENOUGH = 120_000;

async function mountResult(composition = sampleComposition()) {
  const calculator = createCalculator(await loadTestAtlas());
  const clock = new ManualClock();
  let run: SimulationRun | undefined;
  let owner: SimulationResult | undefined;
  const Host = defineComponent({
    emits: { showFlow: () => true },
    setup(_, { emit }) {
      const owned = useSimulationRun(clock);
      run = owned;
      // 只有会话没有画布：地图的分组照常推导，镜头操作等视图就绪（测试里不会就绪）
      const map = provideMap({ groups: [], camera: JIANGSU_CAMERA });
      const result = useSimulationResult(owned);
      owner = result;
      const simulationMap = useSimulationMap(owned, map, result);
      return () => (
        <ResultStage
          run={owned}
          model={{ status: 'ready', calculator }}
          simulationMap={simulationMap}
          result={result}
          onShowFlow={() => emit('showFlow')}
        />
      );
    }
  });
  const wrapper = mount(Host, { attachTo: document.body });
  const started = required(run, '推演的拥有者');
  started.start(composition, calculator);
  await clock.advance(ENOUGH);
  await flushPromises();
  return { wrapper, run: started, result: required(owner, '结果的拥有者'), clock };
}

type Mounted = Awaited<ReturnType<typeof mountResult>>;

const button = ({ wrapper }: Mounted, text: string) =>
  required(
    wrapper.findAll('button').find(item => item.text() === text),
    `"${text}"按钮`
  );
// 结果阶段用两个年度，才有多年度对比和年度切换
const twoYears = () => ({
  ...sampleComposition(),
  conditions: { ...sampleComposition().conditions, years: [2025, 2026] }
});
const titles = ({ wrapper }: Mounted) => wrapper.findAll('h2').map(title => title.text());
// 推演概览里的版本按钮
const versions = ({ wrapper }: Mounted) => wrapper.findAll('button[aria-pressed]').filter(item => /^v\d/.test(item.text()));

afterEach(() => {
  document.body.innerHTML = '';
});

describe('ResultStage', () => {
  it('左侧是推演概览（条件、版本、回看推演流程），右侧是推演结果；数字、结论和图表的分区都出现', async () => {
    const mounted = await mountResult(twoYears());
    const { wrapper } = mounted;

    expect(titles(mounted)).toEqual(expect.arrayContaining(['推演概览', '推演结果']));
    expect(wrapper.text()).toContain('2025、2026 年');
    expect(versions(mounted).map(item => item.text())).toEqual(['v1编排时的参数']);
    expect(wrapper.text()).toContain('66.6%');
    expect(wrapper.text()).toContain('5/ 13');
    expect(wrapper.text()).toContain('AI 结论');
    expect(wrapper.findAll('[data-chart]').map(chart => chart.attributes('data-chart'))).toEqual(['多年度对比', '城市对比', '参数敏感性']);
    expect(wrapper.text()).toContain('变化归因');
    expect(wrapper.get('[aria-label="图例"]').text()).toContain('2026 年 · 公园绿地覆盖率（%）');

    await button(mounted, '回看推演流程').trigger('click');
    expect(wrapper.emitted('showFlow')).toHaveLength(1);
  });

  it('只有一个年度时没有多年度对比和年度切换', async () => {
    const mounted = await mountResult();

    expect(mounted.wrapper.findAll('[data-chart]').map(chart => chart.attributes('data-chart'))).toEqual(['城市对比', '参数敏感性']);
    expect(mounted.wrapper.find('[aria-label="年度"]').exists()).toBe(false);
  });

  it('切换指标、着色和年度，图例跟着变', async () => {
    const mounted = await mountResult(twoYears());
    const { wrapper, result } = mounted;

    const tab = required(
      wrapper.findAll('[role="tab"]').find(item => item.text() === '人均公园绿地'),
      '人均公园绿地的页签'
    );
    await tab.trigger('click');
    expect(tab.attributes('aria-selected')).toBe('true');
    await wrapper.get('[aria-label="地图着色"] input[value="pass"]').setValue(true);
    await wrapper.get('[aria-label="年度"] input[value="2025"]').setValue(true);
    expect(result.selection.value).toMatchObject({ indicatorId: 'A-39', mode: 'pass', year: 2025 });
    expect(wrapper.get('[aria-label="图例"]').text()).toContain('对照目标 15 m²');
  });

  it('人工干预改成模拟情景再推演：生成 v2 并看它，和 v1 比；点 v1 换回去', async () => {
    const mounted = await mountResult();
    const { wrapper, run, clock } = mounted;

    await button(mounted, '人工干预').trigger('click');
    await wrapper.get('[aria-label="覆盖认定"] input[value="intersect"]').setValue(true);
    await button(mounted, '应用并重算').trigger('click');
    expect(run.state.value.params.recognition).toBe('intersect');
    await clock.advance(ENOUGH);
    await flushPromises();

    expect(versions(mounted).map(item => [item.text().slice(0, 2), item.attributes('aria-pressed')])).toEqual([
      ['v1', 'false'],
      ['v2', 'true']
    ]);
    expect(wrapper.text()).toContain('73.4%');
    expect(wrapper.text()).toContain('v1 → v2');
    await versions(mounted)[0]?.trigger('click');
    expect(versions(mounted)[0]?.attributes('aria-pressed')).toBe('true');
    expect(wrapper.text()).toContain('66.6%');
  });

  it('人工干预基于正在看的一版，草稿改变达标状态时地图预览这些区县；关闭时清掉', async () => {
    const mounted = await mountResult();
    const { wrapper, result, run } = mounted;

    await button(mounted, '人工干预').trigger('click');
    expect(wrapper.text()).toContain('基于 v1 调整，生成新版本');
    expect(result.preview.value.size).toBe(0);
    await wrapper.get('[aria-label="覆盖认定"] input[value="intersect"]').setValue(true);
    const calculator = required(run.calculator.value, '计算器');
    const conditions = required(run.state.value.conditions, '推演条件');
    const from = run.state.value.params;
    const expected = previewChanges(calculator, conditions, from, { ...from, recognition: 'intersect' }, 'B-65', 2026);
    expect(expected.size).toBeGreaterThan(0);
    expect(result.preview.value).toEqual(expected);

    await wrapper.get('[aria-label="关闭人工干预"]').trigger('click');
    expect(result.preview.value.size).toBe(0);
  });

  it('推演概览可以收起成窄条，点窄条展开', async () => {
    const mounted = await mountResult();
    const { wrapper } = mounted;
    await wrapper.get('[aria-label="收起推演概览"]').trigger('click');
    expect(titles(mounted)).not.toContain('推演概览');
    await wrapper.get('[aria-label="展开推演概览"]').trigger('click');
    expect(titles(mounted)).toContain('推演概览');
  });
});

// jsdom 没有 matchMedia；按窄屏回答
const narrow = () =>
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    matches: true,
    addEventListener: () => undefined,
    removeEventListener: () => undefined
  }));

describe('ResultStage 窄屏', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('左右只显示最后操作的一边：开始时看推演结果，展开推演概览后推演结果收成胶囊', async () => {
    narrow();
    const mounted = await mountResult();
    const { wrapper } = mounted;

    expect(titles(mounted)).toContain('推演结果');
    await wrapper.get('[aria-label="展开推演概览"]').trigger('click');
    expect(titles(mounted)).toContain('推演概览');
    expect(titles(mounted)).not.toContain('推演结果');
    await wrapper.get('[aria-label="展开推演结果"]').trigger('click');
    expect(titles(mounted)).toContain('推演结果');
  });
});
