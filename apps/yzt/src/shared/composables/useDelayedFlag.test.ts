// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';
import { useDelayedFlag } from './useDelayedFlag';

// 组合式函数不依赖组件时，可以在 effectScope 中直接运行，scope.stop() 相当于组件卸载
function setup(initial = false) {
  const source = ref(initial);
  const scope = effectScope();
  const shown = scope.run(() => useDelayedFlag(source, { delay: 300, minDuration: 400 }));
  if (!shown) {
    throw new Error('effectScope 未返回结果');
  }
  // 源的变化要等 watch 回调执行后才生效
  const set = async (value: boolean) => {
    source.value = value;
    await nextTick();
  };
  return { shown, set, scope };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useDelayedFlag', () => {
  it('在延迟时间内结束时一直不显示', async () => {
    const { shown, set } = setup();

    await set(true);
    vi.advanceTimersByTime(299);
    await set(false);
    vi.advanceTimersByTime(1000);

    expect(shown.value).toBe(false);
  });

  it('超过延迟时间才显示；显示后很快结束，也至少保持最短时间', async () => {
    const { shown, set } = setup();

    await set(true);
    vi.advanceTimersByTime(300);
    expect(shown.value).toBe(true);

    vi.advanceTimersByTime(50);
    await set(false);
    vi.advanceTimersByTime(349);
    expect(shown.value).toBe(true);
    vi.advanceTimersByTime(1);
    expect(shown.value).toBe(false);
  });

  it('显示超过最短时间后结束，立即隐藏', async () => {
    const { shown, set } = setup();

    await set(true);
    vi.advanceTimersByTime(300 + 500);
    await set(false);

    expect(shown.value).toBe(false);
  });

  it('最短保持期内再次开始，继续显示，不闪烁', async () => {
    const { shown, set } = setup();
    await set(true);
    vi.advanceTimersByTime(300);
    await set(false);
    vi.advanceTimersByTime(100);

    await set(true);
    vi.advanceTimersByTime(1000);

    expect(shown.value).toBe(true);
  });

  it('最短时间从第一次显示算起：保持期内再次开始、持续较久后结束，立即隐藏', async () => {
    const { shown, set } = setup();
    await set(true);
    vi.advanceTimersByTime(300);
    await set(false);
    vi.advanceTimersByTime(100);
    await set(true);
    vi.advanceTimersByTime(500);

    await set(false);

    expect(shown.value).toBe(false);
  });

  it('初始为 true 时同样延迟显示', () => {
    const { shown } = setup(true);

    expect(shown.value).toBe(false);
    vi.advanceTimersByTime(300);
    expect(shown.value).toBe(true);
  });

  it('作用域销毁（组件卸载）时清掉定时器', async () => {
    const { set, scope } = setup();
    await set(true);

    scope.stop();

    expect(vi.getTimerCount()).toBe(0);
  });
});
