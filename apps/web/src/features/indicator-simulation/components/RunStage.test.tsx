import { flushPromises, mount } from '@vue/test-utils';
import { provideMap } from '@yzt/map-vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { required } from '@/shared/testing/required';
import { defaultComposition } from '../compose/composition';
import { JIANGSU_CAMERA } from '@/shared/map/jiangsu';
import { useSimulationMap } from '../composables/useSimulationMap';
import { type SimulationResult, useSimulationResult } from '../composables/useSimulationResult';
import { type SimulationRun, useSimulationRun } from '../composables/useSimulationRun';
import { ManualClock } from '../engine/test-clock';
import { createCalculator } from '../model/calculator';
import { loadTestAtlas } from '../model/test-atlas';
import { previewChanges } from '../result/result-view';
import { RunStage } from './RunStage';

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

// 默认时长下数据核查在 7300 毫秒处停下来问；确认后 1200 到空间分析，再确认后 13600 完成
const QC_CHECKPOINT_AT = 7300;
const AFTER_QC = 1200;
const AFTER_SPATIAL = 13_600;
// 干预后重算到完成足够长的时间
const RERUN_ENOUGH = 30_000;

async function mountRun(composition = defaultComposition()) {
  const calculator = createCalculator(await loadTestAtlas());
  const clock = new ManualClock();
  let run: SimulationRun | undefined;
  let owner: SimulationResult | undefined;
  const Host = defineComponent({
    setup() {
      const owned = useSimulationRun(clock);
      run = owned;
      // 只有会话没有画布：地图的分组照常推导，镜头操作等视图就绪（测试里不会就绪）
      const map = provideMap({ groups: [], camera: JIANGSU_CAMERA });
      const result = useSimulationResult(owned);
      owner = result;
      const simulationMap = useSimulationMap(owned, map, result);
      return () => (
        <RunStage run={owned} model={{ status: 'ready', calculator }} simulationMap={simulationMap} result={result} />
      );
    }
  });
  const wrapper = mount(Host, { attachTo: document.body });
  const started = required(run, '推演的拥有者');
  started.start(composition, calculator);
  await flushPromises();
  return { wrapper, run: started, result: required(owner, '结果的拥有者'), clock };
}

type Mounted = Awaited<ReturnType<typeof mountRun>>;

// 左侧步骤的行（阶段条也有 li，不算）
const rows = ({ wrapper }: Mounted) => wrapper.findAll('section li').map(row => row.text());
const button = ({ wrapper }: Mounted, text: string) =>
  required(
    wrapper.findAll('button').find(item => item.text() === text),
    `"${text}"按钮`
  );

// 两个确认点都按默认确认，推演到完成
async function runToDone({ run, clock }: Mounted) {
  await clock.advance(QC_CHECKPOINT_AT);
  run.resolveCheckpoint({ step: 'qc', missing: { kind: 'impute' } });
  await clock.advance(AFTER_QC);
  run.resolveCheckpoint({ step: 'spatial' });
  await clock.advance(AFTER_SPATIAL);
  await flushPromises();
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('RunStage', () => {
  it('步骤开始了才出现，下一步是虚影；数据核查停下来时右上出现确认卡片', async () => {
    const mounted = await mountRun();
    const { clock, wrapper } = mounted;
    expect(wrapper.text()).toContain('正在理解推演条件，规划推演步骤');

    await clock.advance(1300);
    expect(rows(mounted)).toHaveLength(2);
    expect(rows(mounted)[1]).toContain('下一步 · 数据准备');

    await clock.advance(QC_CHECKPOINT_AT - 1300);
    const texts = rows(mounted);
    expect(texts[0]).toMatch(/^条件解析完成1 年 · 13 市 · 3 项/);
    expect(texts[1]).toContain('3 路数据已就绪');
    expect(texts[2]).toMatch(/^数据核查需确认等待你确认缺失处理/);
    expect(wrapper.text()).toContain('需要你确认：缺失人口如何处理');
  });

  it('确认缺失处理后继续，分析过程写出人工确认，这一行标"人工"', async () => {
    const mounted = await mountRun();
    const { clock, wrapper, run } = mounted;
    await clock.advance(QC_CHECKPOINT_AT);

    await button(mounted, '剔除这 2 个区县').trigger('click');
    expect(run.state.value.params.missing).toEqual({ kind: 'exclude' });
    expect(rows(mounted)[2]).toContain('人工');

    // jsdom 没有动画帧，详情只在状态变化时重画：等数据核查完成，再回看这一行
    await clock.advance(1200);
    expect(rows(mounted)[2]).toMatch(/^数据核查完成人工已剔除 2 个区县/);
    await wrapper.findAll('section li button')[2]?.trigger('click');
    expect(wrapper.text()).toContain('按人工确认：剔除缺失区县，继续推演。');
  });

  it('打开人工干预时暂停，关闭后继续；改参数时按钮写出会怎样处理', async () => {
    const mounted = await mountRun();
    const { clock, wrapper, run } = mounted;
    await clock.advance(QC_CHECKPOINT_AT);
    await button(mounted, '人工干预').trigger('click');
    expect(run.state.value.paused).toBe(true);
    expect(wrapper.text()).toContain('推演已暂停，关闭后继续');
    expect(button(mounted, '应用').attributes('disabled')).toBeDefined();

    await wrapper.get('[aria-label="关闭人工干预"]').trigger('click');
    expect(run.state.value.paused).toBe(false);
  });

  it('干预已执行过的步骤：从这一步重算，待更新的行标出来，右上写这次改了什么', async () => {
    const mounted = await mountRun();
    const { clock, wrapper, run } = mounted;
    await clock.advance(QC_CHECKPOINT_AT);
    run.apply({ ...run.state.value.params, popCaliber: 'registered' });
    await flushPromises();

    expect(rows(mounted)[1]).toMatch(/^数据准备已调整/);
    expect(rows(mounted)[2]).toMatch(/^数据核查待更新/);
    await clock.advance(800);
    expect(wrapper.text()).toContain('调整后重算：人口口径 常住人口 → 户籍人口');
  });

  it('点左侧一行回看，"回到当前"恢复跟随', async () => {
    const mounted = await mountRun();
    const { clock, wrapper } = mounted;
    await clock.advance(QC_CHECKPOINT_AT);
    await wrapper.findAll('section li button')[0]?.trigger('click');
    expect(wrapper.findAll('h2').map(title => title.text())).toContain('条件解析');

    await button(mounted, '回到当前').trigger('click');
    expect(wrapper.findAll('h2').map(title => title.text())).toContain('数据核查');
  });

  it('两侧面板可以收起；需要确认时右上自动展开', async () => {
    const mounted = await mountRun();
    const { clock, wrapper } = mounted;
    await wrapper.get('[aria-label="收起推演步骤"]').trigger('click');
    await wrapper.get('[aria-label="收起当前步骤"]').trigger('click');
    expect(wrapper.get('[aria-label="展开推演步骤"]').text()).toContain('AI 推演');
    expect(wrapper.find('[aria-label="展开当前步骤"]').exists()).toBe(true);

    await clock.advance(QC_CHECKPOINT_AT);
    expect(wrapper.find('[aria-label="展开当前步骤"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('需要你确认');
  });
});

// 结果阶段用两个年度，才有多年度对比和年度切换
const twoYears = () => ({
  ...defaultComposition(),
  conditions: { ...defaultComposition().conditions, years: [2025, 2026] }
});
const titles = ({ wrapper }: Mounted) => wrapper.findAll('h2').map(title => title.text());
// 推演概览里的版本按钮
const versions = ({ wrapper }: Mounted) =>
  wrapper.findAll('button[aria-pressed]').filter(item => /^v\d/.test(item.text()));

describe('RunStage 结果阶段', () => {
  it('完成后左侧是推演概览，右侧是推演结果；数字、结论和图表的分区都出现', async () => {
    const mounted = await mountRun(twoYears());
    await runToDone(mounted);
    const { wrapper } = mounted;

    expect(titles(mounted)).toEqual(expect.arrayContaining(['推演概览', '推演结果']));
    expect(wrapper.text()).toContain('2025、2026 年');
    expect(versions(mounted).map(item => item.text())).toEqual(['v1编排时的参数']);
    expect(wrapper.text()).toContain('64.6%');
    expect(wrapper.text()).toContain('5/ 13');
    expect(wrapper.text()).toContain('AI 结论');
    expect(wrapper.findAll('[data-chart]').map(chart => chart.attributes('data-chart'))).toEqual(['多年度对比', '城市对比', '参数敏感性']);
    expect(wrapper.text()).toContain('变化归因');
    expect(wrapper.get('[aria-label="图例"]').text()).toContain('2026 年 · 公园绿地覆盖率（%）');
  });

  it('只有一个年度时没有多年度对比和年度切换', async () => {
    const mounted = await mountRun();
    await runToDone(mounted);

    expect(mounted.wrapper.findAll('[data-chart]').map(chart => chart.attributes('data-chart'))).toEqual(['城市对比', '参数敏感性']);
    expect(mounted.wrapper.find('[aria-label="年度"]').exists()).toBe(false);
  });

  it('切换指标、着色和年度，图例跟着变', async () => {
    const mounted = await mountRun(twoYears());
    await runToDone(mounted);
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
    expect(wrapper.get('[aria-label="图例"]').text()).toContain('对照演示目标 15 m²');
  });

  it('按建议情景再推演：生成 v2 并看它，和 v1 比；点 v1 换回去', async () => {
    const mounted = await mountRun();
    await runToDone(mounted);
    const { wrapper, run, clock } = mounted;

    await button(mounted, '按此情景再推演').trigger('click');
    expect(run.state.value.params.newFacilities).toBe(20);
    expect(titles(mounted)).not.toContain('推演结果');
    await clock.advance(RERUN_ENOUGH);
    await flushPromises();

    expect(versions(mounted).map(item => [item.text().slice(0, 2), item.attributes('aria-pressed')])).toEqual([
      ['v1', 'false'],
      ['v2', 'true']
    ]);
    expect(wrapper.text()).toContain('70.3%');
    expect(wrapper.text()).toContain('v1 → v2');
    await versions(mounted)[0]?.trigger('click');
    expect(versions(mounted)[0]?.attributes('aria-pressed')).toBe('true');
    expect(wrapper.text()).toContain('64.6%');
  });

  it('点推演概览的一步回看，在推演结果左边打开；再点一次收起', async () => {
    const mounted = await mountRun();
    await runToDone(mounted);
    const { wrapper } = mounted;

    await wrapper.findAll('section li button')[0]?.trigger('click');
    expect(titles(mounted)).toEqual(expect.arrayContaining(['条件解析', '推演结果']));
    await wrapper.findAll('section li button')[0]?.trigger('click');
    expect(titles(mounted)).not.toContain('条件解析');
  });

  it('结果阶段的人工干预：基于正在看的一版，草稿改变达标状态时地图预览这些区县', async () => {
    const mounted = await mountRun();
    await runToDone(mounted);
    const { wrapper, result, run } = mounted;

    await button(mounted, '人工干预').trigger('click');
    expect(wrapper.text()).toContain('基于 v1 调整，生成新版本');
    expect(result.preview.value.size).toBe(0);
    await wrapper.get('[aria-label="设施纳入口径"] input[value="all"]').setValue(true);
    const calculator = required(run.calculator.value, '计算器');
    const conditions = required(run.state.value.conditions, '推演条件');
    const from = run.state.value.params;
    const expected = previewChanges(calculator, conditions, from, { ...from, facilityScope: 'all' }, 'B-65', 2026);
    expect(expected.size).toBeGreaterThan(0);
    expect(result.preview.value).toEqual(expected);

    await wrapper.get('[aria-label="关闭人工干预"]').trigger('click');
    expect(result.preview.value.size).toBe(0);
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

describe('RunStage 窄屏', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('左右只显示最后操作的一边：开始时看当前步骤，展开步骤后当前步骤收成胶囊，点一行又回到右边', async () => {
    narrow();
    const mounted = await mountRun();
    const { wrapper, clock } = mounted;
    await clock.advance(1300);
    expect(wrapper.find('[aria-label="展开推演步骤"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="展开当前步骤"]').exists()).toBe(false);

    await wrapper.get('[aria-label="展开推演步骤"]').trigger('click');
    expect(wrapper.find('[aria-label="展开推演步骤"]').exists()).toBe(false);
    expect(wrapper.get('[aria-label="展开当前步骤"]').text()).toContain('条件解析');

    await wrapper.findAll('section li button')[0]?.trigger('click');
    expect(wrapper.find('[aria-label="展开推演步骤"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="展开当前步骤"]').exists()).toBe(false);
  });

  it('需要确认时换到右边；结果阶段看推演概览时，推演结果收成胶囊', async () => {
    narrow();
    const mounted = await mountRun();
    const { wrapper, clock } = mounted;
    await wrapper.get('[aria-label="展开推演步骤"]').trigger('click');
    await clock.advance(QC_CHECKPOINT_AT);
    expect(wrapper.text()).toContain('需要你确认');
    expect(wrapper.find('[aria-label="展开推演步骤"]').exists()).toBe(true);

    await runToDone(mounted);
    expect(titles(mounted)).toContain('推演结果');
    await wrapper.get('[aria-label="展开推演步骤"]').trigger('click');
    expect(titles(mounted)).toContain('推演概览');
    expect(titles(mounted)).not.toContain('推演结果');
    await wrapper.get('[aria-label="展开推演结果"]').trigger('click');
    expect(titles(mounted)).toContain('推演结果');
    expect(wrapper.get('[aria-label="展开推演步骤"]').text()).toContain('推演概览');
  });
});
