import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import { required } from '@/shared/testing/required';
import { type Composition, sampleComposition } from '../compose/composition';
import { type ReasoningLog, useReasoningLog } from '../composables/useReasoningLog';
import { useRunFlow } from '../composables/useRunFlow';
import { type SimulationRun, useSimulationRun } from '../composables/useSimulationRun';
import { useUserPause } from '../composables/useUserPause';
import { ManualClock } from '../engine/test-clock';
import { THINK_MS } from '../flow/frame';
import { createCalculator } from '../model/calculator';
import { defaultParams } from '../model/params';
import { loadTestAtlas } from '../model/test-atlas';
import { FlowChart } from './FlowChart';
import { ReasoningPanel } from './ReasoningPanel';
import { RunStage } from './RunStage';

// 规划步骤 1300 毫秒，每步先想 1100 毫秒；各步的时长按推理的话多少给，推进这么久一定推演完
const PLANNING = 1300;
const ENOUGH = 120_000;

async function mountRun(composition: Composition = sampleComposition()) {
  const calculator = createCalculator(await loadTestAtlas());
  const clock = new ManualClock();
  let run: SimulationRun | undefined;
  let log: ReasoningLog | undefined;
  const Host = defineComponent({
    emits: { showResult: () => true },
    setup(_, { emit }) {
      const owned = useSimulationRun(clock);
      run = owned;
      log = useReasoningLog(owned);
      const flow = useRunFlow(owned);
      const userPause = useUserPause(owned);
      return () => (
        <RunStage
          run={owned}
          model={{ status: 'ready', calculator }}
          flow={flow}
          log={log ?? useReasoningLog(owned)}
          userPause={userPause}
          onShowResult={() => emit('showResult')}
        />
      );
    }
  });
  const wrapper = mount(Host, { attachTo: document.body });
  const started = required(run, '推演的拥有者');
  required(log, '时间线').begin('推演全省三项指标');
  started.start(composition, calculator);
  await flushPromises();
  return { wrapper, run: started, clock };
}

type Mounted = Awaited<ReturnType<typeof mountRun>>;

const button = ({ wrapper }: Mounted, text: string) =>
  required(
    wrapper.findAll('button').find(item => item.text() === text),
    `"${text}"按钮`
  );
// 时间线的条目、流程图的节点
const entries = ({ wrapper }: Mounted) => wrapper.findAll('[class*="_timeline_"] > li').map(item => item.text());
const nodes = ({ wrapper }: Mounted): Record<string, string> =>
  Object.fromEntries(
    wrapper.findAll('[data-node]').map((node): [string, string] => [node.attributes('data-node') ?? '', node.attributes('data-status') ?? ''])
  );
const advance = async ({ clock }: Mounted, ms: number) => {
  await clock.advance(ms);
  await flushPromises();
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('RunStage', () => {
  it('时间线先是指令和"正在规划"，开始一步加一条：先思考（轮换的提示），再逐字打出；下一步是虚影；流程图从条件解析长出来', async () => {
    const mounted = await mountRun();
    const { run, wrapper } = mounted;
    // jsdom 没有动画帧：重画一次，代替逐帧刷新
    const redraw = async () => {
      wrapper.findComponent(ReasoningPanel).vm.$forceUpdate();
      await flushPromises();
    };
    expect(entries(mounted)).toEqual(['推演全省三项指标', '正在规划推演步骤…', '下一步 · 条件解析']);
    expect(nodes(mounted)).toEqual({});

    await advance(mounted, PLANNING + 300);
    await redraw();
    expect(entries(mounted).slice(1)).toEqual(['条件解析进行中正在理解指令…', '下一步 · 数据准备']);
    expect(wrapper.get('[role="status"]').text()).toBe('推演中 · 条件解析');
    // 想了半秒多，提示换成下一句；想完开始打字
    await advance(mounted, 400);
    await redraw();
    expect(entries(mounted)[1]).toBe('条件解析进行中正在拆分年份、范围和指标…');
    await advance(mounted, THINK_MS - 700 + 300);
    await redraw();
    expect(entries(mounted)[1]).toMatch(/^条件解析进行中理解指令：/);

    // 条件解析结束、数据准备刚开始（还在想）：条件解析的节点完成，三路数据还没长出
    await advance(mounted, run.state.value.durations.parse - 1400 + 10);
    expect(nodes(mounted)).toEqual({ parse: 'done' });
    expect(entries(mounted).at(-2)).toBe('数据准备进行中正在连接人口库…');
  });

  it('暂停按钮：推演停住、写已暂停，再点继续；和打开人工干预的暂停互不影响', async () => {
    const mounted = await mountRun();
    const { run, wrapper } = mounted;
    await advance(mounted, PLANNING + 300);
    await button(mounted, '暂停').trigger('click');
    expect(run.state.value.paused).toBe(true);
    expect(wrapper.get('[role="status"]').text()).toBe('已暂停 · 条件解析');
    expect(wrapper.find('[class*="_paused_"]').exists()).toBe(true);

    // 人工干预在流程图右上角：打开时镜头让出右边，不挡住正在生长的树
    expect(wrapper.getComponent(FlowChart).props('reserveRight')).toBe(0);
    await button(mounted, '人工干预').trigger('click');
    expect(wrapper.getComponent(FlowChart).props('reserveRight')).toBe(424);
    await wrapper.get('[aria-label="关闭人工干预"]').trigger('click');
    expect(wrapper.getComponent(FlowChart).props('reserveRight')).toBe(0);
    expect(run.state.value.paused).toBe(true);
    await button(mounted, '继续').trigger('click');
    expect(run.state.value.paused).toBe(false);
  });

  it('完成后节点都完成，时间线每步收成摘要、点开看全文；底部卡片点"查看结果"进入结果展示', async () => {
    const mounted = await mountRun();
    const { wrapper } = mounted;
    await advance(mounted, ENOUGH);

    expect(new Set(Object.values(nodes(mounted)))).toEqual(new Set(['done']));
    expect(Object.keys(nodes(mounted))).toContain('eval:B-65');
    const parse = required(
      wrapper.findAll('[class*="_timeline_"] > li').find(item => item.text().startsWith('条件解析')),
      '条件解析这一条'
    );
    expect(parse.text()).toBe('条件解析完成2026 年 · 全省 · 3 项');
    await parse.get('button').trigger('click');
    expect(parse.text()).toContain('理解指令：推演 2026 年全省的 3 项指标。');
    expect(wrapper.get('[role="status"]').text()).toBe('推演完成');

    await button(mounted, '查看结果').trigger('click');
    expect(wrapper.emitted('showResult')).toHaveLength(1);
    await button(mounted, '重新编排').trigger('click');
    expect(mounted.run.state.value.status).toBe('idle');
  });

  it('干预重算：受影响的节点标为待更新，时间线旧的一条标"已调整"，重算时另加一条', async () => {
    const mounted = await mountRun();
    const { run } = mounted;
    await advance(mounted, ENOUGH);
    run.apply({ ...defaultParams(), recognition: 'intersect' });
    await flushPromises();

    expect(nodes(mounted)['sa:B-65:0']).toBe('stale');
    expect(nodes(mounted).qc).toBe('done');
    expect(entries(mounted).filter(text => text.includes('已调整')).map(text => text.slice(0, 4))).toEqual(['空间分析', '指标计算', '评价分级', '结论生成']);
    await advance(mounted, 2000);
    expect(entries(mounted).at(-2)).toMatch(/^空间分析重算进行中/);
  });

  it('悬停时间线的一步，流程图里这一列以外的节点变淡', async () => {
    const mounted = await mountRun();
    const { wrapper } = mounted;
    await advance(mounted, ENOUGH);
    const prep = required(
      wrapper.findAll('[class*="_timeline_"] > li').find(item => item.text().startsWith('数据准备')),
      '数据准备这一条'
    );
    await prep.trigger('mouseenter');
    const dim = (key: string) => wrapper.get(`[data-node="${key}"]`).classes().some(name => name.includes('_dim_'));
    expect([dim('pop'), dim('parse'), dim('report')]).toEqual([false, true, true]);
    await prep.trigger('mouseleave');
    expect(dim('parse')).toBe(false);
  });
});
