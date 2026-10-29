import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import { required } from '@/shared/testing/required';
import { defaultComposition } from '../compose/composition';
import { type SimulationRun, useSimulationRun } from '../composables/useSimulationRun';
import { ManualClock } from '../engine/test-clock';
import { createCalculator } from '../model/calculator';
import { loadTestAtlas } from '../model/test-atlas';
import { RunStage } from './RunStage';

// 默认时长下数据核查在 7300 毫秒处停下来问
const QC_CHECKPOINT_AT = 7300;

async function mountRun() {
  const calculator = createCalculator(await loadTestAtlas());
  const clock = new ManualClock();
  let run: SimulationRun | undefined;
  const Host = defineComponent({
    setup() {
      const owned = useSimulationRun(clock);
      run = owned;
      return () => <RunStage run={owned} model={{ status: 'ready', calculator }} />;
    }
  });
  const wrapper = mount(Host, { attachTo: document.body });
  const started = required(run, '推演的拥有者');
  started.start(defaultComposition(), calculator);
  await flushPromises();
  return { wrapper, run: started, clock };
}

type Mounted = Awaited<ReturnType<typeof mountRun>>;

// 左侧步骤的行（阶段条也有 li，不算）
const rows = ({ wrapper }: Mounted) => wrapper.findAll('section li').map(row => row.text());
const button = ({ wrapper }: Mounted, text: string) =>
  required(
    wrapper.findAll('button').find(item => item.text() === text),
    `"${text}"按钮`
  );

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
