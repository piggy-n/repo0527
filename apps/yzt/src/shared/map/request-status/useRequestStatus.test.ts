// @vitest-environment node
import type { SceneActivity } from '@mx/map-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, shallowRef } from 'vue';
import { required } from '../../testing/required';
import { ALL_REQUEST_KINDS, type RequestKinds, type RequestSource, requestSummary } from './request-status';
import { useRequestStatus } from './useRequestStatus';

// 时钟、来源和显示哪几类都由用例控制；定时器用假的
function setup(initial: readonly RequestSource[] = []) {
  vi.useFakeTimers();
  let time = 0;
  const sources = shallowRef<readonly RequestSource[]>(initial);
  const kinds = shallowRef<RequestKinds>(ALL_REQUEST_KINDS);
  const scope = effectScope();
  const status = required(
    scope.run(() =>
      useRequestStatus(
        () => sources.value,
        () => time,
        () => kinds.value
      )
    ),
    '作用域没有运行'
  );
  const advance = async (ms: number) => {
    time += ms;
    vi.advanceTimersByTime(ms);
    await nextTick();
  };
  return { status, sources, kinds, advance, [Symbol.dispose]: () => scope.stop() };
}

const tiles = (key: string, startedAt: number, finishedAt: number | null = null, failed = 0): RequestSource => ({
  kind: 'tiles',
  key,
  name: key,
  icon: 'geometry-polygon',
  activity: { requested: 4, loaded: finishedAt === null ? 1 : 4 - failed, failed, startedAt, finishedAt }
});

const model = (
  key: string,
  state: 'loading' | 'ready' | 'failed',
  activity: SceneActivity | null = null
): RequestSource => ({
  kind: 'model',
  key,
  name: key,
  icon: 'model-3d',
  state,
  activity
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

  it('行内的转圈、失败按显示哪几类：关掉加载中没有转圈，关掉加载失败没有失败；失败的是这一轮结束、有失败的（ADR 0167）', async () => {
    using ctx = setup([tiles('a', 0)]);
    ctx.kinds.value = { ...ALL_REQUEST_KINDS, loading: false };
    await ctx.advance(500);
    expect(ctx.status.loadingKeys.value.size).toBe(0);
    ctx.kinds.value = ALL_REQUEST_KINDS;
    await nextTick();
    expect([...ctx.status.loadingKeys.value]).toStrictEqual(['a']);

    ctx.sources.value = [tiles('a', 0, 600, 1)];
    await nextTick();
    expect([...ctx.status.failedKeys.value]).toStrictEqual(['a']);
    ctx.kinds.value = { ...ALL_REQUEST_KINDS, failed: false };
    await nextTick();
    expect(ctx.status.failedKeys.value.size).toBe(0);
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

  it('读完索引后渲染器才开始请求块：中间那一下仍算加载中，行内转圈不断；块都到了才结束（ADR 0162）', async () => {
    using ctx = setup([model('m', 'loading')]);
    await ctx.advance(500);
    const shown = ctx.status.loadingKeys.value;
    expect([...shown]).toStrictEqual(['m']);

    // 750 读完索引，块还没请求
    await ctx.advance(250);
    ctx.sources.value = [model('m', 'ready')];
    await nextTick();
    expect(ctx.status.loadingKeys.value).toBe(shown);

    // 900 开始请求块，1000 报到
    await ctx.advance(250);
    const blocks = { kind: 'blocks', requested: 6, loaded: 2, failed: 0, startedAt: 900, finishedAt: null } as const;
    ctx.sources.value = [model('m', 'ready', blocks)];
    await nextTick();
    expect(ctx.status.items.value[0]).toMatchObject({ kind: 'blocks', startedAt: 0, finishedAt: null });
    await ctx.advance(500);
    expect(ctx.status.loadingKeys.value).toBe(shown);

    ctx.sources.value = [model('m', 'ready', { ...blocks, loaded: 6, finishedAt: 1400 })];
    await nextTick();
    expect(ctx.status.loadingKeys.value.size).toBe(0);
  });

  it('读索引 0.3 秒、之后不请求块的模型：不进行内转圈，条目不出现（2026-11-16 复核）', async () => {
    using ctx = setup([model('m', 'loading')]);
    await ctx.advance(250);
    await ctx.advance(50);
    ctx.sources.value = [model('m', 'ready')];
    await nextTick();
    const quiet = () =>
      ctx.status.loadingKeys.value.size === 0 &&
      requestSummary(ctx.status.items.value, ctx.status.display.value).kind === 'hidden';
    // 时钟每 250 毫秒走一格：走到 500、750 都不出现
    await ctx.advance(200);
    expect(quiet()).toBe(true);
    await ctx.advance(250);
    expect(quiet()).toBe(true);
    expect(ctx.status.items.value[0]).toMatchObject({ kind: 'model', finishedAt: 300 });
  });

  it('读完索引以后什么也不请求的模型：等一会儿算结束，结束时间是读完的时候', async () => {
    using ctx = setup([model('m', 'ready')]);
    expect(ctx.status.items.value[0]).toMatchObject({ kind: 'model', finishedAt: null });
    await ctx.advance(500);
    expect(ctx.status.items.value[0]).toMatchObject({ kind: 'model', startedAt: 0, finishedAt: 0 });
    expect(ctx.status.loadingKeys.value.size).toBe(0);
  });
});

// 条目现在显示什么
const summary = ({ status }: ReturnType<typeof setup>) => requestSummary(status.items.value, status.display.value).kind;

describe('useRequestStatus 的条目（用户 2026-11-22）', () => {
  it('行内转圈 0.4 秒、条目 0.8 秒才出现；出现以后又开始的加载直接是加载中，不先隐藏；都结束后留 1.5 秒，时钟停下', async () => {
    using ctx = setup([tiles('a', 0)]);
    await ctx.advance(500);
    expect([...ctx.status.loadingKeys.value]).toStrictEqual(['a']);
    expect(summary(ctx)).toBe('hidden');
    await ctx.advance(250);
    expect(summary(ctx)).toBe('hidden');
    await ctx.advance(250);
    expect(summary(ctx)).toBe('loading');

    // 1000 结束：已加载完成
    ctx.sources.value = [tiles('a', 0, 1000)];
    await nextTick();
    expect(summary(ctx)).toBe('done');
    // 1500 平移，新的一轮刚开始：还是同一次显示，直接回到加载中
    await ctx.advance(500);
    ctx.sources.value = [tiles('a', 1500)];
    await nextTick();
    expect(summary(ctx)).toBe('loading');
    expect(ctx.status.loadingKeys.value.size).toBe(0);
    ctx.sources.value = [tiles('a', 1500, 1600)];
    await nextTick();
    expect(summary(ctx)).toBe('done');

    // 结束后 1.5 秒内都是已加载完成，之后隐藏、时钟停下
    await ctx.advance(1250);
    expect(summary(ctx)).toBe('done');
    await ctx.advance(500);
    expect(summary(ctx)).toBe('hidden');
    const stopped = ctx.status.now.value;
    await ctx.advance(1000);
    expect(ctx.status.now.value).toBe(stopped);
  });

  it('失败留到下一轮结束：下一轮开始时条目、行内都不变，结束后按这一轮更新；集合内容不变时是同一个对象', async () => {
    using ctx = setup([tiles('a', 0)]);
    ctx.sources.value = [tiles('a', 0, 100, 2)];
    await nextTick();
    const failed = ctx.status.failedKeys.value;
    expect([...failed]).toStrictEqual(['a']);
    expect(summary(ctx)).toBe('failed');

    // 下一轮开始，这一轮还没有结果
    await ctx.advance(250);
    ctx.sources.value = [tiles('a', 250)];
    await nextTick();
    expect(ctx.status.failedKeys.value).toBe(failed);
    expect(summary(ctx)).toBe('failed');
    expect(ctx.status.items.value[0]).toMatchObject({ previousFailed: 2, finishedAt: null });

    // 这一轮没有失败地结束：一起清掉
    ctx.sources.value = [tiles('a', 250, 400)];
    await nextTick();
    expect(ctx.status.failedKeys.value.size).toBe(0);
    expect(summary(ctx)).toBe('hidden');
  });
});
