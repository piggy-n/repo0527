// @vitest-environment node
import { abortReason } from '@mx/utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createIndexLoader, fetchJson, HttpStatusError, INDEX_RETRY_DELAYS } from './index-loader';
import type { LoadJson } from './prepare-tileset';

// 每次下载挂起，测试决定结果；记下开始的顺序和收到的信号
function controlledLoad() {
  const started: string[] = [];
  const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: unknown) => void }>();
  const load = vi.fn<LoadJson>(
    (url, signal) =>
      new Promise((resolve, reject) => {
        started.push(url);
        pending.set(url, { resolve, reject });
        signal.addEventListener('abort', () => reject(abortReason(signal)));
      })
  );
  const settle = (url: string, outcome: { value: unknown } | { error: unknown }) => {
    const entry = pending.get(url);
    pending.delete(url);
    if ('error' in outcome) {
      entry?.reject(outcome.error);
    } else {
      entry?.resolve(outcome.value);
    }
  };
  return { load, started, pending, settle };
}

// 只经过微任务的推进
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const signal = () => new AbortController().signal;

// 可能一直挂着的结果不直接 await：和必然更晚结束的等待赛跑，失败给出原因
const PENDING = '还挂着';
const outcomeBefore = (promise: Promise<unknown>, later: Promise<unknown>) =>
  Promise.race([promise.then(value => value, (error: unknown) => error), later.then(() => PENDING)]);

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('createIndexLoader', () => {
  it('同一个下载器的下载共用名额：同时进行的不超过上限，结束一个就按先来后到开始下一个', async () => {
    const { load, started, settle } = controlledLoad();
    const loadJson = createIndexLoader(load, { maxDownloads: 2 });

    const results = Promise.allSettled(['a', 'b', 'c', 'd'].map(url => loadJson(url, signal())));
    await flush();
    expect(started).toStrictEqual(['a', 'b']);

    settle('b', { value: 'B' });
    await flush();
    expect(started).toStrictEqual(['a', 'b', 'c']);
    settle('a', { error: new Error('内容不对') });
    await flush();
    expect(started).toStrictEqual(['a', 'b', 'c', 'd']);
    settle('c', { value: 'C' });
    settle('d', { value: 'D' });

    await expect(results).resolves.toStrictEqual([
      { status: 'rejected', reason: new Error('内容不对') },
      { status: 'fulfilled', value: 'B' },
      { status: 'fulfilled', value: 'C' },
      { status: 'fulfilled', value: 'D' }
    ]);
  });

  it('排队时中止：以中止的原因结束，不下载、不占名额', async () => {
    const { load, started, settle } = controlledLoad();
    const loadJson = createIndexLoader(load, { maxDownloads: 1 });
    const controller = new AbortController();
    const first = loadJson('a', signal());
    const queued = loadJson('b', controller.signal);
    const next = loadJson('c', signal());
    await flush();

    const reason = new DOMException('撤下了', 'AbortError');
    controller.abort(reason);
    expect(await outcomeBefore(queued, flush())).toBe(reason);
    settle('a', { value: 'A' });
    await flush();

    expect(started).toStrictEqual(['a', 'c']);
    settle('c', { value: 'C' });
    await expect(Promise.all([first, next])).resolves.toStrictEqual(['A', 'C']);
  });

  it('网络错误、5xx、408、429 等一会儿再试，等的时候不占名额；重试用完时以最后一次的原因结束', async () => {
    vi.useFakeTimers();
    const { load, started, settle } = controlledLoad();
    const loadJson = createIndexLoader(load, { maxDownloads: 1 });
    const flaky = loadJson('a', signal());
    const other = loadJson('b', signal());
    await vi.advanceTimersByTimeAsync(0);

    settle('a', { error: new TypeError('Failed to fetch') });
    await vi.advanceTimersByTimeAsync(0);
    // 等着重试的不占名额，排在后面的先下
    expect(started).toStrictEqual(['a', 'b']);
    settle('b', { value: 'B' });
    await vi.advanceTimersByTimeAsync(INDEX_RETRY_DELAYS[0] ?? 0);
    expect(started).toStrictEqual(['a', 'b', 'a']);
    settle('a', { error: new HttpStatusError('a', 503) });
    await vi.advanceTimersByTimeAsync(INDEX_RETRY_DELAYS[1] ?? 0);
    expect(started).toStrictEqual(['a', 'b', 'a', 'a']);
    const last = new HttpStatusError('a', 502);
    settle('a', { error: last });

    await expect(other).resolves.toBe('B');
    await expect(flaky).rejects.toBe(last);
    expect(INDEX_RETRY_DELAYS).toHaveLength(2);
  });

  it('重试以后成功就用这一次的结果；408、429 也重试', async () => {
    const { load, started, settle } = controlledLoad();
    const loadJson = createIndexLoader(load, { retryDelays: [0, 0] });
    const result = loadJson('a', signal());
    // 失败的处理在微任务里排上重试的定时器，再推进一轮它才开始
    const retried = async () => {
      await flush();
      await flush();
    };
    await flush();

    settle('a', { error: new HttpStatusError('a', 408) });
    await retried();
    settle('a', { error: new HttpStatusError('a', 429) });
    await retried();
    settle('a', { value: 'A' });

    await expect(result).resolves.toBe('A');
    expect(started).toStrictEqual(['a', 'a', 'a']);
  });

  it('404 这类客户端错误和内容错误不重试', async () => {
    const { load, started, settle } = controlledLoad();
    const loadJson = createIndexLoader(load, { retryDelays: [0, 0] });
    const missing = loadJson('a', signal());
    const broken = loadJson('b', signal());
    await flush();
    const notFound = new HttpStatusError('a', 404);
    const syntax = new SyntaxError('Unexpected token <');

    settle('a', { error: notFound });
    settle('b', { error: syntax });
    // 重试的话这一轮结束不了，开始第二次下载
    const later = flush().then(flush);

    expect(await outcomeBefore(missing, later)).toBe(notFound);
    expect(await outcomeBefore(broken, later)).toBe(syntax);
    expect(started).toStrictEqual(['a', 'b']);
  });

  it('等着重试时中止：不等到时间就以中止的原因结束，不再下载', async () => {
    vi.useFakeTimers();
    const { load, started, settle } = controlledLoad();
    const loadJson = createIndexLoader(load);
    const controller = new AbortController();
    const result = loadJson('a', controller.signal);
    await vi.advanceTimersByTimeAsync(0);
    settle('a', { error: new TypeError('Failed to fetch') });
    await vi.advanceTimersByTimeAsync(0);

    const reason = new DOMException('撤下了', 'AbortError');
    controller.abort(reason);

    expect(await outcomeBefore(result, vi.advanceTimersByTimeAsync(0))).toBe(reason);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(started).toStrictEqual(['a']);
  });
});

describe('fetchJson', () => {
  it('状态码不是 2xx 时以带状态码的 HttpStatusError 结束，否则给出解析后的 JSON', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async input => {
      const url = input instanceof Request ? input.url : input.toString();
      return url.endsWith('ok.json') ? Response.json({ root: {} }) : new Response('', { status: 503 });
    });
    vi.stubGlobal('fetch', fetch);

    await expect(fetchJson('https://models.test/ok.json', signal())).resolves.toStrictEqual({ root: {} });
    const failure = fetchJson('https://models.test/busy.json', signal());
    await expect(failure).rejects.toBeInstanceOf(HttpStatusError);
    await expect(failure).rejects.toMatchObject({ status: 503, message: '下载 https://models.test/busy.json 失败：503' });
  });
});
