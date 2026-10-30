// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';
import { required } from '@/shared/testing/required';
import { emptyComposition, sampleComposition } from '../compose/composition';
import { describeComposition, parsePrompt, PROMPT_EXAMPLES, randomPrompt } from '../compose/prompt';
import { type PromptComposerOptions, usePromptComposer } from './usePromptComposer';
import { useComposition } from './useComposition';

// 理解指令 900 毫秒，之后每个节点 450，最后一个节点到开始计算 1000
const THINK = 900;
const STEP = 450;
const LAUNCH = 1000;
// 第一条示例：年份、范围、指标、计算规程、覆盖认定、目标值、AI计算
const FIRST_STEPS = 7;
const FIRST_DONE = THINK + STEP * (FIRST_STEPS - 1) + LAUNCH;

const [first = '', second = ''] = PROMPT_EXAMPLES;

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
    expect(composition.state.value).toEqual(emptyComposition());
    expect(composer.building.value).toEqual({ revealed: new Set(), latest: null, message: 'AI 正在理解指令…', launching: false });

    await vi.advanceTimersByTimeAsync(THINK);
    expect(composer.building.value).toMatchObject({ latest: 'years:2025', message: '识别年份：2025 年', launching: false });
    expect(composition.state.value.conditions).toEqual({ years: [2025], cityCodes: [], indicatorIds: [] });

    await vi.advanceTimersByTimeAsync(STEP * (FIRST_STEPS - 1));
    expect(composer.building.value).toMatchObject({ latest: 'output', launching: true });
    expect(composer.building.value?.revealed.size).toBe(FIRST_STEPS);
    expect(composed).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(LAUNCH);
    expect(composed).toHaveBeenCalledTimes(1);
    expect(composer.building.value).toBeNull();
    expect(composition.state.value).toEqual(parsePrompt(first));
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
    expect(composition.state.value).toEqual(parsePrompt(second));
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
    expect(composition.state.value).toEqual(parsePrompt(target));
    expect(composition.state.value.conditions.indicatorIds[0]).toBe('A-31');
  });
});
