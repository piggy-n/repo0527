// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { effectScope, ref } from 'vue';
import { required } from '@/shared/testing/required';
import { type Composition, sampleComposition } from '../compose/composition';
import { ManualClock } from '../engine/test-clock';
import { createCalculator } from '../model/calculator';
import { defaultParams } from '../model/params';
import { loadTestAtlas } from '../model/test-atlas';
import type { RunView } from '../result/result-view';
import { useComposition } from './useComposition';
import { type LogEntry, useReasoningLog } from './useReasoningLog';
import { useRunConversation } from './useRunConversation';
import { useSimulationResult } from './useSimulationResult';
import { useSimulationRun } from './useSimulationRun';
import { useUserPause } from './useUserPause';

// 各步的时长按推理的话多少给：推进这么久一定推演完
const ENOUGH = 120_000;
const composition: Composition = {
  conditions: { years: [2025], cityCodes: ['320100'], indicatorIds: ['A-31', 'A-39'] },
  params: { ...defaultParams(), recognition: 'intersect' }
};

async function setup() {
  const calculator = createCalculator(await loadTestAtlas());
  const clock = new ManualClock();
  const scope = effectScope();
  const owned = required(
    scope.run(() => {
      const run = useSimulationRun(clock);
      const owner = useComposition(composition);
      const log = useReasoningLog(run, () => clock.now());
      const userPause = useUserPause(run);
      const result = useSimulationResult(run);
      const view = ref<RunView>('flow');
      const viewer = { selection: result.selection, view, select: result.select, show: (next: RunView) => (view.value = next) };
      return { run, owner, log, userPause, result, view, conversation: useRunConversation(run, owner, userPause, log, viewer) };
    }),
    '推演和对话'
  );
  const start = () => {
    owned.log.begin('推演南京市的两项指标');
    owned.run.start(composition, calculator);
  };
  return { ...owned, calculator, clock, start, [Symbol.dispose]: () => scope.stop() };
}

// 时间线上最后一条 AI 的回复
const lastReply = (entries: readonly LogEntry[]) => {
  const last = entries.at(-1);
  return last?.kind === 'ai' ? last.text : '';
};

// 时间线的样子：说话的内容，或者一步的名称和状态
const outline = (entries: readonly LogEntry[]) =>
  entries.map(entry => {
    switch (entry.kind) {
      case 'user':
        return `用户：${entry.text}`;
      case 'ai':
        return `AI：${entry.text}`;
      case 'step':
        break;
    }
    return `${entry.group}${entry.rerun ? '（重算）' : ''}${entry.frozen ? `·${entry.frozen.state}` : ''}`;
  });

describe('useReasoningLog', () => {
  it('开始时先写上指令；一步开始时加一条，按开始的先后排', async () => {
    using ctx = await setup();
    const { log, clock, start } = ctx;
    start();
    expect(outline(log.entries.value)).toEqual(['用户：推演南京市的两项指标']);
    await clock.advance(ENOUGH);
    expect(outline(log.entries.value)).toEqual([
      '用户：推演南京市的两项指标',
      'parse',
      'prep',
      'qc',
      'spatial',
      'compute',
      'evaluate',
      'report'
    ]);
  });
});

describe('useRunConversation', () => {
  it('暂停、继续：和阶段条的暂停是同一个；推演完成后说暂停时提示直接说要改什么', async () => {
    using ctx = await setup();
    const { conversation, userPause, run, clock, start, log } = ctx;
    start();
    await clock.advance(3000);
    expect(conversation.send('暂停')).toBe('replied');
    expect([userPause.paused.value, run.state.value.paused]).toEqual([true, true]);
    expect(conversation.phase.value).toBe('paused');
    expect(conversation.suggestions.value[0]).toBe('继续');
    conversation.send('继续');
    expect(run.state.value.paused).toBe(false);
    conversation.send('继续');
    expect(outline(log.entries.value).filter(line => line.startsWith('AI'))).toEqual([
      'AI：已暂停。说"继续"接着推演，也可以先改参数或范围。',
      'AI：继续推演。',
      'AI：推演没有暂停。'
    ]);

    await clock.advance(ENOUGH);
    conversation.send('暂停');
    expect(lastReply(log.entries.value)).toContain('推演已经完成了');
  });

  it('推演中改参数：还没执行的步骤保存，已执行的从受影响的一步重算；先解除暂停，编排同步成新的', async () => {
    using ctx = await setup();
    const { conversation, userPause, run, clock, start, log, owner } = ctx;
    start();
    await clock.advance(3000);
    userPause.pause();
    conversation.send('按旧规程推演');
    expect([userPause.paused.value, run.state.value.paused]).toEqual([false, false]);
    expect(run.state.value.params.rule).toBe('old');
    expect(lastReply(log.entries.value)).toContain('「空间分析」还没执行');
    expect(owner.state.value.params.rule).toBe('old');

    await clock.advance(ENOUGH);
    conversation.send('常住人口增加 10%');
    expect(run.state.value.restart).toBe('pop');
    expect(lastReply(log.entries.value)).toContain('从「数据准备」重算，前 1 步复用');
    // 要重算的步骤冻结成"已调整"，重算开始时另加一条
    await clock.advance(1000);
    const lines = outline(log.entries.value);
    expect(lines.filter(line => line.includes('·outdated'))).toEqual(['prep·outdated', 'qc·outdated', 'spatial·outdated', 'compute·outdated', 'evaluate·outdated', 'report·outdated']);
    expect(lines.at(-1)).toBe('prep（重算）');
  });

  it('改条件：从条件解析重算，打到一半的一步标为已中断；输入框里的话发出后清空', async () => {
    using ctx = await setup();
    const { conversation, run, clock, start, log, owner } = ctx;
    start();
    // 规划 1300 毫秒，条件解析完成后数据准备进行中
    await clock.advance(1300 + run.state.value.durations.parse + 500);
    conversation.setText('加上苏州市');
    expect(conversation.send()).toBe('replied');
    expect(conversation.text.value).toBe('');
    expect(run.state.value.conditions?.cityCodes).toEqual(['320100', '320500']);
    expect(run.state.value.previousConditions?.cityCodes).toEqual(['320100']);
    expect(owner.state.value.conditions.cityCodes).toEqual(['320100', '320500']);
    expect(outline(log.entries.value).slice(1)).toEqual([
      'parse·outdated',
      'prep·stopped',
      '用户：加上苏州市',
      'AI：好的，范围改为南京市、苏州市。从「条件解析」重算。'
    ]);
  });

  it('停止回到空闲；空的话不发；听不懂时给出能说的话', async () => {
    using ctx = await setup();
    const { conversation, run, clock, start, log } = ctx;
    start();
    await clock.advance(3000);
    expect(conversation.send('  ')).toBe('empty');
    conversation.send('今天天气怎么样');
    expect(lastReply(log.entries.value)).toContain('没听懂这句话');
    expect(conversation.send('停止')).toBe('stopped');
    expect(run.state.value.status).toBe('idle');
  });

  it('示例编排也能对话：快捷说法按条件给', async () => {
    using ctx = await setup();
    const { conversation, run, start } = ctx;
    start();
    expect(conversation.suggestions.value).toContain('按旧规程推演');
    run.restart(sampleComposition());
    expect(conversation.suggestions.value).toContain('去掉人均公园绿地');
  });

  it('完成后看结果的说法只换结果和视图，不重新推演；看结果时对话栏有回复，快捷说法先给看结果的', async () => {
    using ctx = await setup();
    const { conversation, run, result, view, calculator, clock, log } = ctx;
    run.start(
      { ...composition, conditions: { years: [2024, 2025], cityCodes: ['320100', '320500'], indicatorIds: ['A-31', 'A-39'] } },
      calculator
    );
    await clock.advance(ENOUGH);
    const { versions } = run.state.value;

    conversation.send('看苏州市');
    expect([result.selection.value?.cityCode, view.value]).toEqual(['320500', 'result']);
    expect(conversation.reply.value).toBe('放大到苏州市，设施和服务范围放大后显示。');
    expect(conversation.suggestions.value.slice(0, 4)).toEqual(['看南京市', '按达标着色', '看人均公园绿地', '回看推演流程']);
    conversation.send('按达标着色');
    conversation.send('看 2024 年');
    conversation.send('看人均公园绿地');
    conversation.send('回到推演范围');
    expect(result.selection.value).toEqual({ indicatorId: 'A-39', year: 2024, mode: 'pass', cityCode: null });
    expect(conversation.reply.value).toBe('回到整个推演范围。');

    conversation.send('回看推演流程');
    expect(view.value).toBe('flow');
    expect(conversation.reply.value).toBeNull();
    expect(lastReply(log.entries.value)).toBe('回到推演流程。点标题栏的"推演结果"再回来。');
    expect(run.state.value.versions).toBe(versions);
  });

  it('完成后：范围外的城市按改条件重算；只有一个市时说范围就是它；听不懂时给出看结果和改推演的说法', async () => {
    using ctx = await setup();
    const { conversation, run, clock, start, log } = ctx;
    start();
    await clock.advance(ENOUGH);

    conversation.send('看南京市');
    expect(conversation.reply.value).toBe('推演范围就是南京市。');
    conversation.send('今天天气怎么样');
    expect(conversation.reply.value).toContain('看结果可以说');
    conversation.send('看无锡市');
    expect(run.state.value.conditions?.cityCodes).toEqual(['320100', '320200']);
    // 改了就重新推演：回复只记在时间线上（回到流程图由页面按推演状态切换）
    expect(lastReply(log.entries.value)).toContain('从「条件解析」重算');
    expect(conversation.reply.value).toBeNull();
  });
});
