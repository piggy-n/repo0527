// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { effectScope, ref } from 'vue';
import { required } from '@/shared/testing/required';
import { type Composition, sampleComposition } from '../compose/composition';
import { ManualClock } from '../engine/test-clock';
import { createCalculator } from '../model/calculator';
import { defaultParams } from '../model/params';
import { areaScope, citiesScope } from '../model/scope';
import { NINGZHEN_RINGS, testArea } from '../model/test-area';
import { loadTestAtlas } from '../model/test-atlas';
import type { RunView } from '../result/result-view';
import { useComposition } from './useComposition';
import { type LogEntry, useReasoningLog } from './useReasoningLog';
import { useRunConversation } from './useRunConversation';
import { useSimulationResult } from './useSimulationResult';
import { useSimulationRun } from './useSimulationRun';
import { useUserPause } from './useUserPause';

// 各步的时长按推理的话多少给：推进这么久一定计算完
const ENOUGH = 120_000;
const composition: Composition = {
  conditions: { years: [2025], scope: citiesScope(['320100']), indicatorIds: ['A-31', 'A-39'] },
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
      const removed = vi.fn<(said: readonly string[]) => void>();
      const conversation = useRunConversation(run, owner, userPause, log, viewer, { onScopeRemoved: removed });
      return { run, owner, log, userPause, result, view, removed, conversation };
    }),
    '计算和对话'
  );
  const start = () => {
    owned.log.begin([{ speaker: 'user', text: '计算南京市的两项指标' }]);
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
    expect(outline(log.entries.value)).toEqual(['用户：计算南京市的两项指标']);
    await clock.advance(ENOUGH);
    expect(outline(log.entries.value)).toEqual([
      '用户：计算南京市的两项指标',
      'parse',
      'prep',
      'qc',
      'spatial',
      'compute',
      'report'
    ]);
  });
});

describe('useRunConversation', () => {
  it('暂停、继续：和阶段条的暂停是同一个；计算完成后说暂停时提示直接说要改什么', async () => {
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
      'AI：已暂停。输入"继续"恢复计算，也可先调整参数或范围。',
      'AI：继续计算。',
      'AI：计算未暂停。'
    ]);

    await clock.advance(ENOUGH);
    conversation.send('暂停');
    expect(lastReply(log.entries.value)).toContain('计算已完成');
  });

  it('计算中改参数：还没执行的步骤保存，已执行的从受影响的一步重算；先解除暂停，编排同步成新的', async () => {
    using ctx = await setup();
    const { conversation, userPause, run, clock, start, log, owner } = ctx;
    start();
    await clock.advance(3000);
    userPause.pause();
    conversation.send('按旧规程计算');
    expect([userPause.paused.value, run.state.value.paused]).toEqual([false, false]);
    expect(run.state.value.params.rule).toBe('old');
    expect(lastReply(log.entries.value)).toContain('「空间分析」尚未执行');
    expect(owner.state.value.params.rule).toBe('old');

    await clock.advance(ENOUGH);
    conversation.send('常住人口增加 10%');
    expect(run.state.value.restart).toBe('pop');
    expect(lastReply(log.entries.value)).toContain('将从「数据准备」重新计算，前 1 步沿用已有结果');
    // 要重算的步骤冻结成"已调整"，重算开始时另加一条
    await clock.advance(1000);
    const lines = outline(log.entries.value);
    expect(lines.filter(line => line.includes('·outdated'))).toEqual([
      'prep·outdated',
      'qc·outdated',
      'spatial·outdated',
      'compute·outdated',
      'report·outdated'
    ]);
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
    expect(run.state.value.conditions?.scope).toEqual(citiesScope(['320100', '320500']));
    expect(run.state.value.previousConditions?.scope).toEqual(citiesScope(['320100']));
    expect(owner.state.value.conditions.scope).toEqual(citiesScope(['320100', '320500']));
    expect(outline(log.entries.value).slice(1)).toEqual([
      'parse·outdated',
      'prep·stopped',
      '用户：加上苏州市',
      'AI：已调整：范围改为南京市、苏州市。将从「条件解析」重新计算。'
    ]);
  });

  it('停止回到空闲；空的话不发；听不懂时给出能说的话', async () => {
    using ctx = await setup();
    const { conversation, run, clock, start, log } = ctx;
    start();
    await clock.advance(3000);
    expect(conversation.send('  ')).toBe('empty');
    conversation.send('今天天气怎么样');
    expect(lastReply(log.entries.value)).toContain('未能识别该指令');
    expect(conversation.send('停止')).toBe('stopped');
    expect(run.state.value.status).toBe('idle');
  });

  it('示例编排也能对话：快捷说法按条件给；占位的示例是第一条不是暂停、停止这类控制的说法，Tab 填进输入框', async () => {
    using ctx = await setup();
    const { conversation, run, start } = ctx;
    start();
    expect(conversation.suggestions.value).toContain('按旧规程计算');
    expect(conversation.suggestions.value[0]).toBe('暂停');
    expect(conversation.example.value).toBe(conversation.suggestions.value[1]);
    conversation.fillExample();
    expect(conversation.text.value).toBe(conversation.example.value);
    run.restart(sampleComposition());
    expect(conversation.suggestions.value).toContain('去掉人均公园绿地');
  });

  it('完成后看结果的说法只换结果和视图，不重新计算；看结果时对话栏有回复，快捷说法先给看结果的', async () => {
    using ctx = await setup();
    const { conversation, run, result, view, calculator, clock, log } = ctx;
    run.start(
      {
        ...composition,
        conditions: { years: [2024, 2025], scope: citiesScope(['320100', '320500']), indicatorIds: ['A-31', 'A-39'] }
      },
      calculator
    );
    await clock.advance(ENOUGH);
    const { versions } = run.state.value;

    conversation.send('看苏州市');
    expect([result.selection.value?.cityCode, view.value]).toEqual(['320500', 'result']);
    expect(conversation.reply.value).toBe('放大到苏州市，设施和服务范围放大后显示。');
    expect(conversation.suggestions.value.slice(0, 3)).toEqual(['看南京市', '看人均公园绿地', '回看计算流程']);
    expect(conversation.example.value).toBe('看南京市');
    conversation.send('看 2024 年');
    conversation.send('看人均公园绿地');
    conversation.send('回到计算范围');
    expect(result.selection.value).toEqual({ indicatorId: 'A-39', year: 2024, cityCode: null });
    expect(conversation.reply.value).toBe('回到整个计算范围。');

    conversation.send('回看计算流程');
    expect(view.value).toBe('flow');
    expect(conversation.reply.value).toBeNull();
    expect(lastReply(log.entries.value)).toBe('已切换到计算流程，可点击标题栏"计算结果"返回。');
    expect(run.state.value.versions).toBe(versions);
  });

  it('完成后：范围外的城市按改条件重算；只有一个市时说范围就是它；听不懂时给出看结果和改计算的说法', async () => {
    using ctx = await setup();
    const { conversation, run, clock, start, log } = ctx;
    start();
    await clock.advance(ENOUGH);

    conversation.send('看南京市');
    expect(conversation.reply.value).toBe('当前计算范围仅含南京市。');
    conversation.send('今天天气怎么样');
    expect(conversation.reply.value).toContain('查看结果可尝试');
    conversation.send('看无锡市');
    expect(run.state.value.conditions?.scope).toEqual(citiesScope(['320100', '320200']));
    // 改了就重新计算：回复只记在时间线上（回到流程图由页面按计算状态切换）
    expect(lastReply(log.entries.value)).toContain('将从「条件解析」重新计算');
    expect(conversation.reply.value).toBeNull();
  });
});

describe('计算阶段新增、替换、移除范围（ADR 0129）', () => {
  it('开始时接上计算之前的对话：AI 的话已经说完，不再逐字打出', async () => {
    using ctx = await setup();
    const { log } = ctx;
    log.begin([
      { speaker: 'user', text: '计算社区卫生' },
      { speaker: 'ai', text: '还缺监测范围。' },
      { speaker: 'user', text: '南京市' }
    ]);
    expect(outline(log.entries.value)).toEqual(['用户：计算社区卫生', 'AI：还缺监测范围。', '用户：南京市']);
    const [, ai] = log.entries.value;
    expect(ai?.kind === 'ai' && ai.at).toBe(Number.NEGATIVE_INFINITY);
  });

  it('计算中移除范围：停止计算，交回条件配置，其余条件保留', async () => {
    using ctx = await setup();
    const { run, owner, conversation, removed, clock, start } = ctx;
    start();
    await clock.advance(3000);
    expect(conversation.send('移除范围')).toBe('scope-removed');
    expect(run.state.value.status).toBe('idle');
    expect(owner.state.value.conditions).toEqual({ ...composition.conditions, scope: citiesScope([]) });
    expect(removed).toHaveBeenCalledWith(['已移除南京市', '计算已停止，其他条件已保留']);
  });

  it('完成后去掉最后一个市也一样；说明里不说计算已停止', async () => {
    using ctx = await setup();
    const { run, conversation, removed, clock, start } = ctx;
    start();
    await clock.advance(ENOUGH);
    expect(conversation.send('去掉南京市')).toBe('scope-removed');
    expect(run.state.value.status).toBe('idle');
    expect(removed).toHaveBeenCalledWith(['已移除南京市', '其他条件已保留']);
  });

  it('换范围：从条件解析重算，不交回条件配置', async () => {
    using ctx = await setup();
    const { run, conversation, removed, clock, log, start } = ctx;
    start();
    await clock.advance(3000);
    expect(conversation.send('换成苏州市')).toBe('replied');
    expect(removed).not.toHaveBeenCalled();
    expect(run.state.value.conditions?.scope).toEqual(citiesScope(['320500']));
    expect(lastReply(log.entries.value)).toBe('已调整：范围改为苏州市。将从「条件解析」重新计算。');
  });

  it('要上传、绘制范围时交给对话栏打开；绘制有说明', async () => {
    using ctx = await setup();
    const { conversation, log, start } = ctx;
    start();
    expect(conversation.send('上传范围')).toBe('upload');
    expect(conversation.send('绘制范围')).toBe('draw');
    expect(lastReply(log.entries.value)).toContain('已打开地图绘制，计算暂停');
    expect(conversation.suggestions.value).toEqual(expect.arrayContaining(['绘制范围', '移除范围']));
    expect(conversation.example.value).not.toMatch(/绘制范围|移除范围/);
  });

  it('弹窗确定了新范围：解除暂停，从条件解析重算，条件配置同步', async () => {
    using ctx = await setup();
    const { run, owner, conversation, userPause, calculator, log, clock, start } = ctx;
    const area = await testArea(calculator.atlas, NINGZHEN_RINGS, '宁镇交界');
    start();
    await clock.advance(3000);
    userPause.pause();
    conversation.applyArea(area);
    expect(userPause.paused.value).toBe(false);
    expect(owner.state.value.conditions.scope).toEqual(areaScope(area));
    expect(run.state.value.conditions?.scope).toEqual(areaScope(area));
    expect(outline(log.entries.value)).toContain('用户：绘制范围「宁镇交界」');
    expect(lastReply(log.entries.value)).toContain('已调整：范围改为自定义范围「宁镇交界」');
    await clock.advance(ENOUGH);
    expect(run.state.value.status).toBe('done');
  });

  it('一句话里互相矛盾：问用哪一个，不重算', async () => {
    using ctx = await setup();
    const { run, conversation, log, clock, start } = ctx;
    start();
    await clock.advance(3000);
    const before = run.state.value.conditions;
    expect(conversation.send('按旧规程和新规程计算')).toBe('replied');
    expect(lastReply(log.entries.value)).toBe('同时提到了旧规程和新规程，要按哪一个计算？计算条件未变化。');
    expect(run.state.value.conditions).toBe(before);
  });
});
