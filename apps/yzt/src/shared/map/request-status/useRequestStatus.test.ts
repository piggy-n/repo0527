// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, shallowRef } from 'vue';
import { required } from '../../testing/required';
import type { RequestSource } from './request-status';
import { useRequestStatus } from './useRequestStatus';

// 时钟和来源都由用例控制；定时器用假的
function setup(initial: readonly RequestSource[] = []) {
  vi.useFakeTimers();
  let time = 0;
  const sources = shallowRef<readonly RequestSource[]>(initial);
  const scope = effectScope();
  const status = required(
    scope.run(() => useRequestStatus(() => sources.value, () => time)),
    '作用域没有运行'
  );
  const advance = async (ms: number) => {
    time += ms;
    vi.advanceTimersByTime(ms);
    await nextTick();
  };
  return { status, sources, advance, [Symbol.dispose]: () => scope.stop() };
}

const tiles = (key: string, startedAt: number, finishedAt: number | null = null): RequestSource => ({
  kind: 'tiles',
  key,
  name: key,
  icon: 'geometry-polygon',
  activity: { requested: 4, loaded: finishedAt === null ? 1 : 4, failed: 0, startedAt, finishedAt }
});

const model = (key: string, state: 'loading' | 'ready' | 'failed'): RequestSource => ({
  kind: 'model',
  key,
  name: key,
  icon: 'model-3d',
  state
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useRequestStatus', () => {
  it('有在加载的时让时钟走，超过 0.4 秒的进入行内转圈；集合内容不变时是同一个对象；都结束、过了 1.5 秒后时钟停下', async () => {
    using ctx = setup([tiles('a', 0)]);
    const first = ctx.status.loadingKeys.value;
    expect(first.size).toBe(0);

    await ctx.advance(250);
    expect(ctx.status.loadingKeys.value).toBe(first);
    await ctx.advance(250);
    const shown = ctx.status.loadingKeys.value;
    expect([...shown]).toStrictEqual(['a']);
    await ctx.advance(250);
    expect(ctx.status.loadingKeys.value).toBe(shown);

    ctx.sources.value = [tiles('a', 0, 750)];
    await nextTick();
    expect(ctx.status.loadingKeys.value.size).toBe(0);
    await ctx.advance(2000);
    const stopped = ctx.status.now.value;
    await ctx.advance(1000);
    expect(ctx.status.now.value).toBe(stopped);
  });

  it('模型按状态变化记下时间：进入加载中时开始，就绪、失败时结束；状态不变时时间不变', async () => {
    using ctx = setup([model('m', 'loading')]);
    await ctx.advance(500);
    expect(ctx.status.items.value[0]).toMatchObject({ kind: 'model', startedAt: 0, finishedAt: null });
    expect([...ctx.status.loadingKeys.value]).toStrictEqual(['m']);

    ctx.sources.value = [model('m', 'failed')];
    await nextTick();
    expect(ctx.status.items.value[0]).toMatchObject({ startedAt: 0, finishedAt: 500, failed: 1 });

    await ctx.advance(250);
    ctx.sources.value = [model('m', 'loading')];
    await nextTick();
    expect(ctx.status.items.value[0]).toMatchObject({ startedAt: 750, finishedAt: null, failed: 0 });
  });
});
