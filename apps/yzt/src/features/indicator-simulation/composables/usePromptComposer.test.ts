// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';
import { required } from '@/shared/testing/required';
import { emptyComposition, sampleComposition } from '../compose/composition';
import { areaPrompt, describeComposition, parsePrompt, PROMPT_EXAMPLES, randomPrompt } from '../compose/prompt';
import type { DialogueLine } from '../compose/guide';
import { areaScope, citiesScope, scopeCityCodes } from '../model/scope';
import { NANJING_RINGS, testArea } from '../model/test-area';
import { loadTestAtlas } from '../model/test-atlas';
import { type PromptComposer, type PromptComposerOptions, usePromptComposer } from './usePromptComposer';
import { useComposition } from './useComposition';

// 理解指令 900 毫秒，之后每个节点 450，最后一个节点到开始计算 1000
const THINK = 900;
const STEP = 450;
const LAUNCH = 1000;
// 第一条示例：年份、范围、指标、步行时长、计算规程、覆盖认定、AI计算
const FIRST_STEPS = 7;
const FIRST_DONE = THINK + STEP * (FIRST_STEPS - 1) + LAUNCH;

const [first = '', second = ''] = PROMPT_EXAMPLES;

// 解析得到的编排；解析不了时抛错
function parsedOf(text: string) {
  const result = parsePrompt(text);
  if (!result.ok) {
    throw new Error(`应能解析：${text}`);
  }
  return result.composition;
}

function setup(options: PromptComposerOptions = {}) {
  const composed = vi.fn<() => void>();
  const scope = effectScope();
  const owned = required(
    scope.run(() => {
      const composition = useComposition(sampleComposition());
      return { composition, composer: usePromptComposer(composition, { onComposed: composed, ...options }) };
    }),
    '编排和指令的拥有者'
  );
  return { ...owned, composed, scope, [Symbol.dispose]: () => scope.stop() };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('usePromptComposer 发送', () => {
  it('打开时输入框是空的，占位是第一条示例；空的或认不出指标时不编排', () => {
    using ctx = setup();
    const { composer, composition } = ctx;
    const before = composition.state.value;
    expect(composer.text.value).toBe('');
    expect(composer.example.value).toBe(first);
    expect(composer.send()).toBe('empty');

    composer.setText('  ');
    expect(composer.send()).toBe('empty');
    composer.setText('今天适合计算什么');
    expect(composer.send()).toBe('unrecognized');
    expect(composer.building.value).toBeNull();
    expect(composition.state.value).toBe(before);
  });

  it('Tab 填入示例后发送：先清空编排、理解指令，再一个节点一个节点地编排，完成后交给页面开始计算', async () => {
    using ctx = setup();
    const { composer, composition, composed } = ctx;

    composer.fillExample();
    expect(composer.text.value).toBe(first);
    expect(composer.send()).toBe('sent');
    expect(composer.sending.value).toBe(true);
    expect(composition.state.value.conditions).toEqual(emptyComposition().conditions);
    expect(composer.building.value).toEqual({ revealed: new Set(), latest: null, message: 'AI 正在理解指令…', launching: false });

    await vi.advanceTimersByTimeAsync(THINK);
    expect(composer.building.value).toMatchObject({ latest: 'years:2025', message: '识别年份：2025 年', launching: false });
    expect(composition.state.value.conditions).toEqual({ years: [2025], scope: citiesScope([]), indicatorIds: [] });

    await vi.advanceTimersByTimeAsync(STEP * (FIRST_STEPS - 1));
    expect(composer.building.value).toMatchObject({ latest: 'output', launching: true });
    expect(composer.building.value?.revealed.size).toBe(FIRST_STEPS);
    expect(composed).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(LAUNCH);
    expect(composed).toHaveBeenCalledTimes(1);
    expect(composer.building.value).toBeNull();
    expect(composition.state.value).toEqual(parsedOf(first));
  });

  it('编排中手动改编排：停下，不再开始计算；再次发送作废上一次', async () => {
    using ctx = setup();
    const { composer, composition, composed } = ctx;
    composer.fillExample();
    composer.send();
    await vi.advanceTimersByTimeAsync(THINK + STEP);
    composition.addYear(2024);
    expect(composer.building.value).toBeNull();
    await vi.advanceTimersByTimeAsync(FIRST_DONE);
    expect(composed).not.toHaveBeenCalled();
    expect(composition.state.value.conditions.years).toEqual([2025, 2024]);

    composer.send();
    await vi.advanceTimersByTimeAsync(THINK);
    composer.setText(second);
    composer.send();
    await vi.advanceTimersByTimeAsync(FIRST_DONE);
    expect(composed).toHaveBeenCalledTimes(1);
    expect(composition.state.value).toEqual(parsedOf(second));
  });

  it('作用域销毁时停下正在进行的编排', async () => {
    const { composer, composed, scope } = setup();
    composer.fillExample();
    composer.send();
    scope.stop();
    await vi.advanceTimersByTimeAsync(FIRST_DONE);
    expect(composed).not.toHaveBeenCalled();
  });
});

describe('usePromptComposer 输入框的文字', () => {
  it('发送后手动改编排：文字改写成当前编排的描述；用户自己改过文字后不再改写', async () => {
    using ctx = setup();
    const { composer, composition } = ctx;
    composer.fillExample();
    composer.send();
    await vi.advanceTimersByTimeAsync(FIRST_DONE);

    composition.addCity('320500');
    expect(composer.text.value).toBe(describeComposition(composition.state.value));
    expect(composer.text.value).toContain('南京市、苏州市');

    composer.setText('我自己写的');
    composition.addCity('320200');
    expect(composer.text.value).toBe('我自己写的');
  });

  it('重置条件后留着原来的话，之后不再改写', async () => {
    using ctx = setup();
    const { composer, composition } = ctx;
    composer.fillExample();
    composer.send();
    await vi.advanceTimersByTimeAsync(FIRST_DONE);
    const text = composer.text.value;

    composition.reset();
    expect(composer.text.value).toBe(text);
    composition.replace(sampleComposition());
    expect(composer.text.value).toBe(text);
  });

  it('换一批换成随机组合的一句（一定有社区卫生覆盖率，不和当前的重复），清空输入框让它显示出来；Tab 填入后发送', async () => {
    using ctx = setup({ random: () => 0.99 });
    const { composer, composition } = ctx;
    const target = randomPrompt(() => 0.99, [first]);
    expect(target).not.toBe(first);

    composer.setText('写了一半');
    composer.refresh();
    expect(composer.example.value).toBe(target);
    expect(composer.text.value).toBe('');

    composer.fillExample();
    expect(composer.send()).toBe('sent');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(composition.state.value).toEqual(parsedOf(target));
    expect(composition.state.value.conditions.indicatorIds[0]).toBe('A-31');
  });
});

describe('usePromptComposer 的自定义范围（ADR 0121）', () => {
  it('换了范围回到新范围的默认示例；填进来没改过的话跟着换，改过的不动', async () => {
    using ctx = setup({ random: () => 0.5 });
    const { composer, composition } = ctx;
    vi.useRealTimers();
    const atlas = await loadTestAtlas();
    const one = await testArea(atlas, NANJING_RINGS, '甲片区');
    const two = await testArea(atlas, NANJING_RINGS, '乙片区');
    vi.useFakeTimers();

    composition.setArea(one);
    composer.refresh();
    composition.setArea(two);
    expect(composer.example.value).toBe(areaPrompt(two));

    // 回到换过示例的范围：还是换上的那句，填进来的话跟着换
    composer.fillExample();
    composition.setArea(one);
    expect(composer.example.value).toContain('甲片区');
    expect(composer.text.value).toBe(composer.example.value);

    composer.setText('自己写的');
    composition.setArea(two);
    expect(composer.text.value).toBe('自己写的');
  });

  it('发送填进来的示例后，配置的中途和完成后输入框里还是这句话', async () => {
    using ctx = setup();
    const { composer, composition } = ctx;
    vi.useRealTimers();
    const area = await testArea(await loadTestAtlas(), NANJING_RINGS, '江宁片区');
    vi.useFakeTimers();
    composition.setArea(area);
    composer.fillExample();
    expect(composer.send()).toBe('sent');
    expect(composer.text.value).toBe(areaPrompt(area));
    await vi.advanceTimersByTimeAsync(THINK);
    expect(composer.text.value).toBe(areaPrompt(area));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(composer.text.value).toBe(areaPrompt(area));
  });

  it('正在用自定义范围时占位写出它的名称，换一批也是', async () => {
    using ctx = setup({ random: () => 0.5 });
    const { composer, composition } = ctx;
    vi.useRealTimers();
    const area = await testArea(await loadTestAtlas(), NANJING_RINGS, '江宁片区');
    vi.useFakeTimers();
    composition.setArea(area);
    expect(composer.example.value).toBe(areaPrompt(area));
    expect(composer.example.value).toContain('自定义范围「江宁片区」');
    composer.refresh();
    expect(composer.example.value).not.toBe(areaPrompt(area));
    expect(composer.example.value).toContain('计算自定义范围「江宁片区」 ');
    composition.setScopeKind('cities');
    expect(composer.example.value).toBe(first);

    composition.setScopeKind('area');
    composer.fillExample();
    expect(composer.send()).toBe('sent');
    // 配置开始时的空白记着自定义范围
    expect(composition.state.value.conditions.scope).toEqual(areaScope(null));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(composition.state.value.conditions.scope).toEqual(areaScope(area));
  });
});

// 没写范围的指令：年份、范围（待补充）、指标、步行时长、计算规程、覆盖认定、AI计算
const NO_SCOPE = '计算 2025 年社区卫生服务设施覆盖率';
const NO_SCOPE_DONE = THINK + STEP * 7;

function setupBlank() {
  const composed = vi.fn<(lines: readonly DialogueLine[]) => void>();
  const scope = effectScope();
  const owned = required(
    scope.run(() => {
      const composition = useComposition();
      const composer: PromptComposer = usePromptComposer(composition, {
        random: () => 0,
        onComposed: () => composed(composer.dialogue.value)
      });
      return { composition, composer };
    }),
    '编排和指令的拥有者'
  );
  return { ...owned, composed, [Symbol.dispose]: () => scope.stop() };
}
type Blank = ReturnType<typeof setupBlank>;

async function pendingNow(ctx: Blank, sentence = NO_SCOPE) {
  ctx.composer.setText(sentence);
  expect(ctx.composer.send()).toBe('sent');
  await vi.advanceTimersByTimeAsync(NO_SCOPE_DONE);
}

const reply = (ctx: Blank, words: string) => {
  ctx.composer.setText(words);
  return ctx.composer.send();
};

describe('usePromptComposer 先对话、后补充范围（ADR 0129）', () => {
  it('没写范围：配置到待补充就停，不开始计算；引导卡问范围，输入框腾出来，占位是回复的示例', async () => {
    using ctx = setupBlank();
    const { composer, composition, composed } = ctx;
    await pendingNow(ctx);
    expect(composed).not.toHaveBeenCalled();
    expect(composer.building.value).toBeNull();
    expect(composer.asking.value).toBe(true);
    expect(composer.guide.value?.kind).toBe('scope');
    expect(composer.text.value).toBe('');
    expect(composer.example.value).toBe('南京市、苏州市');
    expect(composition.state.value.conditions).toEqual({ years: [2025], scope: citiesScope([]), indicatorIds: ['A-31'] });
    expect(composer.dialogue.value.map(line => line.speaker)).toEqual(['user', 'ai']);
    expect(composer.dialogue.value[1]?.text).toContain('待补充：监测范围');
  });

  it('待补充期间说的话只改说到的条件，不重新配置，不开始计算', async () => {
    using ctx = setupBlank();
    const { composer, composition, composed } = ctx;
    await pendingNow(ctx);
    expect(reply(ctx, '再加上人均公园绿地')).toBe('replied');
    expect(composer.sending.value).toBe(false);
    expect(composition.state.value.conditions.indicatorIds).toEqual(['A-31', 'A-39']);
    expect(composer.guide.value?.lead).toEqual({ tone: 'said', text: '已调整：加上人均公园绿地。' });
    reply(ctx, '改成 2024 年');
    expect(composition.state.value.conditions.years).toEqual([2024]);
    reply(ctx, '按旧规程计算');
    expect(composition.state.value.params.rule).toBe('old');
    expect(composer.text.value).toBe('');
    await vi.advanceTimersByTimeAsync(5000);
    expect(composed).not.toHaveBeenCalled();
    expect(composer.guide.value?.kind).toBe('scope');
  });

  it('回复范围：补上后自动继续，已有的条件都还在；计算之前的对话交给页面', async () => {
    using ctx = setupBlank();
    const { composer, composition, composed } = ctx;
    await pendingNow(ctx);
    reply(ctx, '再加上人均公园绿地');
    expect(reply(ctx, '南京市、苏州市')).toBe('replied');
    expect(composer.building.value).toMatchObject({ latest: 'region', launching: true, message: '已补充范围：南京市、苏州市，即将开始计算' });
    expect(composer.guide.value).toBeNull();
    expect(composed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(LAUNCH);
    expect(composed).toHaveBeenCalledTimes(1);
    expect(composition.state.value.conditions).toEqual({
      years: [2025],
      scope: citiesScope(['320100', '320500']),
      indicatorIds: ['A-31', 'A-39']
    });
    const lines = composed.mock.calls[0]?.[0] ?? [];
    expect(lines.map(line => line.text)).toEqual([
      NO_SCOPE,
      expect.stringContaining('待补充：监测范围'),
      '再加上人均公园绿地',
      '南京市、苏州市',
      '已补充范围：南京市、苏州市，开始计算。'
    ]);
    // 开始之后对话清空，回到条件配置时不再问
    expect(composer.asking.value).toBe(false);
    expect(composer.dialogue.value).toEqual([]);
    expect(composer.text.value).toBe(describeComposition(composition.state.value));
  });

  it('弹窗确定、点选城市：一步完成，补上后自动继续', async () => {
    using ctx = setupBlank();
    const { composer, composition, composed } = ctx;
    await pendingNow(ctx);
    composer.supplyScope(citiesScope(['320500']), '苏州市');
    expect(composer.building.value?.launching).toBe(true);
    await vi.advanceTimersByTimeAsync(LAUNCH);
    expect(composed).toHaveBeenCalledTimes(1);
    expect(composed.mock.calls[0]?.[0].map(line => line.text)).toContain('苏州市');

    vi.useRealTimers();
    const area = await testArea(await loadTestAtlas(), NANJING_RINGS, '江宁片区');
    vi.useFakeTimers();
    composition.reset();
    await pendingNow(ctx);
    composer.supplyScope(areaScope(area), '上传范围「江宁片区」');
    expect(composer.building.value?.message).toContain('已补充范围：自定义范围「江宁片区」，涉及');
    await vi.advanceTimersByTimeAsync(LAUNCH);
    expect(composed).toHaveBeenCalledTimes(2);
    expect(composition.state.value.conditions.scope).toEqual(areaScope(area));
  });

  it('手动在条件库里点选：不自动开始；引导卡说齐了，点开始才计算；又取消时回到问范围', async () => {
    using ctx = setupBlank();
    const { composer, composition, composed } = ctx;
    await pendingNow(ctx);
    composition.toggleCity('320100');
    expect(composer.sending.value).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(composed).not.toHaveBeenCalled();
    expect(composer.guide.value?.kind).toBe('ready');
    composition.toggleCity('320100');
    expect(composer.guide.value?.kind).toBe('scope');
    expect(composer.guide.value?.options).toEqual([{ label: '恢复南京市', say: '南京市' }]);
    composition.toggleCity('320500');
    composer.start();
    expect(composed).toHaveBeenCalledTimes(1);
  });

  it('已经齐全时继续改条件不自动开始：只有这句话补齐了才继续', async () => {
    using ctx = setupBlank();
    const { composer, composition, composed } = ctx;
    await pendingNow(ctx);
    composition.toggleCity('320100');
    reply(ctx, '加上无锡市');
    await vi.advanceTimersByTimeAsync(5000);
    expect(composed).not.toHaveBeenCalled();
    expect(scopeCityCodes(composition.state.value.conditions.scope)).toEqual(['320100', '320200']);
    expect(composer.guide.value).toMatchObject({ kind: 'ready', lead: { tone: 'said', text: '已调整：范围改为南京市、无锡市。' } });
    expect(reply(ctx, '开始计算')).toBe('replied');
    expect(composed).toHaveBeenCalledTimes(1);
  });

  it('执行校验：缺范围或有冲突时开始不了，交给引导卡', async () => {
    using ctx = setupBlank();
    const { composer, composed } = ctx;
    composer.start();
    expect(composed).not.toHaveBeenCalled();
    expect(composer.guide.value?.kind).toBe('scope');
    reply(ctx, '开始计算');
    expect(composed).not.toHaveBeenCalled();

    await pendingNow(ctx, '按旧规程和新规程计算 2025 年南京市社区卫生服务设施覆盖率');
    composer.start();
    expect(composed).not.toHaveBeenCalled();
    expect(composer.guide.value?.kind).toBe('conflict');
  });

  it('冲突：不开始，引导卡问；点选项走回复的路，答完自动继续', async () => {
    using ctx = setupBlank();
    const { composer, composition, composed } = ctx;
    await pendingNow(ctx, '按旧规程和新规程计算 2025 年南京市社区卫生服务设施覆盖率');
    expect(composed).not.toHaveBeenCalled();
    expect(composer.conflicts.value.map(item => item.key)).toEqual(['rule']);
    const guide = composer.guide.value;
    expect(guide?.kind).toBe('conflict');
    expect(composer.example.value).toBe('按旧规程计算');

    expect(composer.send(guide?.options[0]?.say)).toBe('replied');
    expect(composition.state.value.params.rule).toBe('old');
    expect(composer.conflicts.value).toEqual([]);
    expect(composer.building.value?.launching).toBe(true);
    await vi.advanceTimersByTimeAsync(LAUNCH);
    expect(composed).toHaveBeenCalledTimes(1);
  });

  it('答的是标准口径（条件没变）也算回答了', async () => {
    using ctx = setupBlank();
    const { composer, composed } = ctx;
    await pendingNow(ctx, '按旧规程和新规程计算 2025 年南京市社区卫生服务设施覆盖率');
    composer.send('按新规程计算');
    expect(composer.conflicts.value).toEqual([]);
    await vi.advanceTimersByTimeAsync(LAUNCH);
    expect(composed).toHaveBeenCalledTimes(1);
  });

  it('年份不可用：不按 2025 悄悄算；回答年份后继续', async () => {
    using ctx = setupBlank();
    const { composer, composition, composed } = ctx;
    await pendingNow(ctx, '计算 2019 年南京市社区卫生服务设施覆盖率');
    expect(composed).not.toHaveBeenCalled();
    expect(composition.state.value.conditions.years).toEqual([]);
    expect(composer.guide.value?.kind).toBe('conflict');
    composer.send('改成 2025 年');
    expect(composition.state.value.conditions.years).toEqual([2025]);
    await vi.advanceTimersByTimeAsync(LAUNCH);
    expect(composed).toHaveBeenCalledTimes(1);
  });

  it('不阻断的说明在开始计算时交给页面', async () => {
    using ctx = setupBlank();
    const { composer, composed } = ctx;
    composer.setText('按旧规程计算 2025 年南京市人均公园绿地面积');
    composer.send();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(composed).toHaveBeenCalledTimes(1);
    expect(composed.mock.calls[0]?.[0]).toEqual([
      { speaker: 'user', text: '按旧规程计算 2025 年南京市人均公园绿地面积' },
      { speaker: 'ai', text: '所选指标不适用计算规程，已按标准口径。' }
    ]);
  });

  it('移除范围：回到问范围，给恢复；再补上自动继续', async () => {
    using ctx = setupBlank();
    const { composer, composition, composed } = ctx;
    await pendingNow(ctx);
    composition.toggleCity('320100');
    reply(ctx, '移除范围');
    expect(composition.state.value.conditions.scope).toEqual(citiesScope([]));
    expect(composer.guide.value).toMatchObject({ kind: 'scope', lead: { tone: 'said', text: '已移除南京市。' } });
    expect(composer.guide.value?.options).toEqual([{ label: '恢复南京市', say: '南京市' }]);
    composer.send('南京市');
    await vi.advanceTimersByTimeAsync(LAUNCH);
    expect(composed).toHaveBeenCalledTimes(1);
  });

  it('计算阶段移除范围后回到这里：写明计算已停止，补上后自动继续', async () => {
    using ctx = setupBlank();
    const { composer, composition, composed } = ctx;
    composition.replace({
      conditions: { years: [2025], scope: citiesScope([]), indicatorIds: ['A-31'] },
      params: composition.state.value.params
    });
    composer.awaitScope(['已移除南京市', '计算已停止，其他条件已保留']);
    expect(composer.guide.value).toMatchObject({ kind: 'scope', lead: { text: '已移除南京市；计算已停止，其他条件已保留。' } });
    expect(composer.send('苏州市')).toBe('replied');
    expect(composer.building.value?.launching).toBe(true);
    await vi.advanceTimersByTimeAsync(LAUNCH);
    expect(composed).toHaveBeenCalledTimes(1);
  });

  it('重置条件：不再问，占位回到指令的示例', async () => {
    using ctx = setupBlank();
    const { composer, composition } = ctx;
    await pendingNow(ctx);
    composition.reset();
    expect(composer.asking.value).toBe(false);
    expect(composer.guide.value).toBeNull();
    expect(composer.example.value).toBe(first);
  });

  it('换一批：等范围时换回复的示例', async () => {
    using ctx = setupBlank();
    const { composer } = ctx;
    await pendingNow(ctx);
    composer.refresh();
    expect(composer.example.value).toBe('全省');
    expect(composer.text.value).toBe('');
  });

  it('说上传、绘制范围时交给对话栏打开；空白页只说范围还是认不出', () => {
    using ctx = setupBlank();
    const { composer } = ctx;
    expect(reply(ctx, '上传范围')).toBe('upload');
    expect(composer.text.value).toBe('');
    expect(reply(ctx, '绘制范围')).toBe('draw');
    expect(reply(ctx, '南京市')).toBe('unrecognized');
    expect(composer.guide.value).toBeNull();
  });

  it('已有范围时没写范围就沿用：直接配置、开始计算，写明沿用', async () => {
    using ctx = setupBlank();
    const { composer, composition, composed } = ctx;
    composition.toggleCity('320100');
    composer.setText(NO_SCOPE);
    composer.send();
    await vi.advanceTimersByTimeAsync(THINK + STEP);
    expect(composer.building.value?.message).toBe('沿用范围：南京市');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(composed).toHaveBeenCalledTimes(1);
  });

  it('配置中手动改条件：停下，不再问，也不再自动开始', async () => {
    using ctx = setupBlank();
    const { composer, composition, composed } = ctx;
    composer.setText(NO_SCOPE);
    composer.send();
    await vi.advanceTimersByTimeAsync(THINK);
    composition.toggleCity('320100');
    expect(composer.asking.value).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(composed).not.toHaveBeenCalled();
    expect(composer.guide.value).toBeNull();
  });
});
