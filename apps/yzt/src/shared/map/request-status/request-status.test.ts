// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { SceneActivity } from '@mx/map-core';
import {
  CHIP_DELAY,
  DONE_HOLD,
  failedRequestKeys,
  failedRowText,
  type FailureMemory,
  hasFailure,
  INLINE_DELAY,
  mergedActivity,
  MODEL_SETTLE,
  type ModelPhase,
  modelRequestItem,
  nextFailureMemory,
  nextRequestDisplay,
  type RequestDisplay,
  type RequestItem,
  requestGroups,
  requestPercent,
  requestRowText,
  requestStatusText,
  requestStatusTip,
  requestSummary,
  withPreviousFailures
} from './request-status';
import { required } from '../../testing/required';

const tiles = (key: string, extra: Partial<RequestItem> = {}): RequestItem => ({
  key,
  kind: 'tiles',
  name: key,
  icon: 'geometry-polygon',
  requested: 10,
  loaded: 0,
  failed: 0,
  previousFailed: 0,
  detail: null,
  startedAt: 0,
  finishedAt: null,
  ...extra
});

const model = (key: string, extra: Partial<RequestItem> = {}): RequestItem => ({
  ...tiles(key, extra),
  kind: 'model',
  icon: 'model-3d',
  requested: 0,
  ...extra
});

// 条目这一次显示着、还有在加载的；加载都在 2000 结束了的
const SHOWING: RequestDisplay = { settledAt: null };
const SETTLED: RequestDisplay = { settledAt: 2000 };

// 一项瓦片按开始、结束的时间
const at = (startedAt: number, finishedAt: number | null = null) => tiles('a', { startedAt, finishedAt });

// 失败的记忆走一步，再给各项带上上一轮的失败（同 useRequestStatus）
const step = (memory: FailureMemory, rounds: readonly RequestItem[]) => {
  const next = nextFailureMemory(memory, rounds);
  return { memory: next, items: withPreviousFailures(rounds, next) };
};

describe('requestSummary', () => {
  it('这一次显示里、明细开着时，有在加载的显示加载中的项数和瓦片完成的比例；没在显示时是空闲（ADR 0171）', () => {
    expect(requestSummary([], null)).toStrictEqual({ kind: 'idle' });
    const items = [tiles('a', { loaded: 3, failed: 1 }), tiles('b', { loaded: 6 }), model('m')];
    expect(requestSummary(items, null)).toStrictEqual({ kind: 'idle' });
    expect(requestSummary(items, SHOWING)).toStrictEqual({ kind: 'loading', count: 3, ratio: 0.5, withFailures: 0 });
    // 明细开着时不等这一次显示开始
    expect(requestSummary(items, null, true)).toMatchObject({ kind: 'loading', count: 3 });
    // 只有模型在加载时没有比例
    expect(requestSummary([model('m')], SHOWING)).toStrictEqual({
      kind: 'loading',
      count: 1,
      ratio: null,
      withFailures: 0
    });
  });

  it('瓦片集的块和二维瓦片按张数、块数合起来算比例；高斯泼溅的细节比例不算进去，只算项数（ADR 0162）', () => {
    const blocks = tiles('b', { kind: 'blocks', requested: 30, loaded: 15 });
    const detail = tiles('d', { kind: 'detail', requested: 0, detail: 0.9 });
    expect(requestSummary([tiles('a', { loaded: 5 }), blocks, detail], SHOWING)).toMatchObject({ count: 3, ratio: 0.5 });
    expect(requestSummary([detail], SHOWING)).toMatchObject({ count: 1, ratio: null });
  });

  it('失败留到下一轮结束：结束后有失败时一直显示几项失败；下一轮还在加载时照旧算，这一轮的失败等它结束才算', () => {
    const failed = [tiles('a', { loaded: 9, failed: 1, finishedAt: 2000 })];
    expect(requestSummary(failed, null)).toStrictEqual({ kind: 'failed', count: 1 });
    expect(requestSummary(failed, SETTLED)).toStrictEqual({ kind: 'failed', count: 1 });

    // 下一轮开始了，还没显示出加载中：仍是上一轮的失败，不闪成空的
    const again = [tiles('a', { previousFailed: 1, startedAt: 9000 })];
    expect(requestSummary(again, null)).toStrictEqual({ kind: 'failed', count: 1 });
    // 显示出加载中以后红点也算它
    expect(requestSummary(again, SHOWING)).toMatchObject({ kind: 'loading', withFailures: 1 });
    // 这一轮才有的失败：结束前不算
    expect(requestSummary([tiles('a', { failed: 2, startedAt: 9000 })], null)).toStrictEqual({ kind: 'idle' });
    expect(requestSummary([tiles('a', { failed: 2, startedAt: 9000 })], SHOWING)).toMatchObject({ withFailures: 0 });
  });

  it('这一次显示里加载都结束了是"已加载完成"，项都移走了的也是；这一次结束了回到空闲，明细开着时同样', () => {
    const done = [tiles('a', { loaded: 10, finishedAt: 2000 })];
    expect(requestSummary(done, SETTLED)).toStrictEqual({ kind: 'done' });
    expect(requestSummary([], SETTLED)).toStrictEqual({ kind: 'done' });
    expect(requestSummary(done, null)).toStrictEqual({ kind: 'idle' });
    expect(requestSummary(done, null, true)).toStrictEqual({ kind: 'idle' });
  });
});

describe('状态按钮的百分比和说明（ADR 0171）', () => {
  it('百分比向下取整，还在加载时最多 99', () => {
    expect([0, 0.005, 0.629, 0.994, 1].map(requestPercent)).toStrictEqual([0, 0, 62, 99, 99]);
  });

  it('按钮上只有图标和数字，读屏名称写全，Tooltip 再加上点了做什么', () => {
    const loading = { kind: 'loading', count: 3, ratio: 0.629, withFailures: 0 } as const;
    expect(requestStatusText(loading)).toBe('正在加载 3 项，已完成 62%');
    expect(requestStatusText({ ...loading, ratio: null, withFailures: 1 })).toBe('正在加载 3 项；1 项有失败');
    expect(requestStatusText({ kind: 'failed', count: 2 })).toBe('2 项加载失败');
    expect(requestStatusText({ kind: 'done' })).toBe('地图数据已加载完成');
    expect(requestStatusText({ kind: 'idle' })).toBe('数据加载');
    expect(requestStatusTip(loading)).toBe('正在加载 3 项，已完成 62%。点击查看明细');
    expect(requestStatusTip({ kind: 'done' })).toBe('地图数据已加载完成。点击查看明细');
    expect(requestStatusTip({ kind: 'idle' })).toBe('查看数据加载的明细');
  });
});

describe('nextRequestDisplay', () => {
  it('没在显示时，有加载超过 0.8 秒的才开始，只超过行内转圈的 0.4 秒不开始；快的不开始', () => {
    expect(INLINE_DELAY).toBe(400);
    expect(CHIP_DELAY).toBe(800);
    expect(nextRequestDisplay(null, [at(0)], INLINE_DELAY + 1)).toBeNull();
    expect(nextRequestDisplay(null, [at(0)], CHIP_DELAY)).toBeNull();
    expect(nextRequestDisplay(null, [at(0)], CHIP_DELAY + 1)).toStrictEqual({ settledAt: null });
    expect(nextRequestDisplay(null, [at(0, 300)], 5000)).toBeNull();
    expect(nextRequestDisplay(null, [], 5000)).toBeNull();
  });

  it('加载都结束以后"已加载完成"留 1.5 秒才结束，所以出现以后至少留 1.5 秒；留着的时候不换对象', () => {
    const shown = required(nextRequestDisplay(null, [at(0)], 1000), '开始的显示');
    const settled = required(nextRequestDisplay(shown, [at(0, 1050)], 1100), '结束后的显示');
    expect(settled).toStrictEqual({ settledAt: 1100 });
    expect(nextRequestDisplay(settled, [at(0, 1050)], 1100 + DONE_HOLD - 1)).toBe(settled);
    expect(nextRequestDisplay(settled, [at(0, 1050)], 1100 + DONE_HOLD)).toBeNull();
    // 显示着的时候项都移走了：同样留满
    expect(nextRequestDisplay(shown, [], 1000)).toStrictEqual({ settledAt: 1000 });
  });

  it('显示着、"已加载完成"留着的时候又开始的加载算同一次：直接回到加载中，不先隐藏，也不等 0.8 秒；结束后再留 1.5 秒', () => {
    const settled = { settledAt: 1100 };
    const next = nextRequestDisplay(settled, [at(1500)], 1500);
    expect(next).toStrictEqual({ settledAt: null });
    expect(requestSummary([at(1500)], next)).toMatchObject({ kind: 'loading' });
    // 过了"已加载完成"留着的时间才开始的：重新等 0.8 秒
    expect(nextRequestDisplay(null, [at(3000)], 3000)).toBeNull();

    const again = required(nextRequestDisplay(next, [at(1500, 1700)], 1750), '又结束后的显示');
    expect(again).toStrictEqual({ settledAt: 1750 });
    expect(nextRequestDisplay(again, [at(1500, 1700)], 1750 + DONE_HOLD - 1)).toBe(again);
  });

  it('结束后留着的是失败：又开始的加载不算同一次，照样等 0.8 秒，失败不跟着每一轮闪（2026-11-22 在产物上发现）', () => {
    const settled = { settledAt: 1100 };
    // 上一轮失败、这一轮刚开始：带着上一轮的失败
    const retry = tiles('a', { startedAt: 1500, previousFailed: 2 });
    expect(nextRequestDisplay(settled, [retry], 1600)).toBe(settled);
    expect(requestSummary([retry], settled)).toStrictEqual({ kind: 'failed', count: 1 });
    // 别的项结束了、有失败的也一样
    const broken = tiles('b', { failed: 1, finishedAt: 1100 });
    expect(nextRequestDisplay(settled, [broken, at(1500)], 1600)).toBe(settled);
    // 超过 0.8 秒的照样显示加载中
    expect(nextRequestDisplay(settled, [retry], 1500 + CHIP_DELAY + 1)).toStrictEqual({ settledAt: null });
    // 留够了就结束
    const late = tiles('a', { startedAt: 2000, previousFailed: 2 });
    expect(nextRequestDisplay(settled, [late], 1100 + DONE_HOLD)).toBeNull();
  });
});

describe('失败留到下一轮结束（nextFailureMemory、withPreviousFailures）', () => {
  it('结束的一轮有失败时记下；下一轮还在加载时带着它，明细、行内都算有失败；下一轮结束后按它更新', () => {
    const first = step(new Map(), [tiles('a', { loaded: 8, failed: 2, finishedAt: 500 })]);
    expect([...first.memory]).toStrictEqual([['a', 2]]);

    const pending = tiles('a', { startedAt: 900, failed: 1 });
    const second = step(first.memory, [pending]);
    expect(second.memory).toBe(first.memory);
    const [carried] = second.items;
    expect(carried).toMatchObject({ previousFailed: 2, failed: 1, finishedAt: null });
    expect(failedRequestKeys(second.items)).toStrictEqual(new Set(['a']));
    // 加载中、有失败两组里都有：有失败一组写上一轮的张数
    const groups = requestGroups(second.items);
    expect([groups.loading, groups.failed].map(group => group.map(({ key }) => key))).toStrictEqual([['a'], ['a']]);
    expect(failedRowText(required(carried, '带着失败的项'), 1000)).toStrictEqual({
      text: '2 张失败',
      progress: null,
      tone: 'error',
      waited: null
    });
    // 加载中一组写这一轮的进度
    expect(requestRowText(required(carried, '带着失败的项'), 1000).text).toBe('1/10 张');

    const fixed = step(second.memory, [tiles('a', { loaded: 10, startedAt: 900, finishedAt: 1200 })]);
    expect(fixed.memory.size).toBe(0);
    expect(failedRequestKeys(fixed.items).size).toBe(0);
    const worse = step(second.memory, [tiles('a', { loaded: 7, failed: 3, startedAt: 900, finishedAt: 1200 })]);
    expect([...worse.memory]).toStrictEqual([['a', 3]]);
    expect(worse.items[0]).toMatchObject({ previousFailed: 0 });
  });

  it('瓦片集的块也留；模型读索引失败后的重试不留，读完以后的块从头算；不在了的项忘掉', () => {
    const blocks = step(new Map(), [tiles('model:m', { kind: 'blocks', failed: 3, finishedAt: 500 })]);
    const pendingBlocks = step(blocks.memory, [tiles('model:m', { kind: 'blocks', startedAt: 900 })]);
    expect(pendingBlocks.items[0]).toMatchObject({ previousFailed: 3 });
    expect(failedRowText(required(pendingBlocks.items[0], '块的项'), 1000).text).toBe('3 块失败');

    const broken = step(blocks.memory, [model('model:m', { failed: 1, finishedAt: 600 })]);
    expect(broken.memory.size).toBe(0);
    const retry = step(broken.memory, [model('model:m', { startedAt: 900 })]);
    expect(retry.items[0]).toMatchObject({ previousFailed: 0 });
    expect(hasFailure(required(retry.items[0], '重试的模型'))).toBe(false);

    expect(step(blocks.memory, []).memory.size).toBe(0);
  });
});

describe('requestGroups 和 requestRowText', () => {
  it('分加载中、有失败、已完成三组，组内按开始的先后', () => {
    const items = [
      tiles('later', { startedAt: 50 }),
      tiles('done', { loaded: 10, finishedAt: 80 }),
      tiles('first', { startedAt: 10 }),
      model('broken', { failed: 1, finishedAt: 90 })
    ];
    const { loading, failed, done } = requestGroups(items);
    expect([loading, failed, done].map(group => group.map(({ key }) => key))).toStrictEqual([
      ['first', 'later'],
      ['broken'],
      ['done']
    ]);
  });

  it('瓦片：加载中写张数和进度，超过 5 秒写等了几秒；失败写几张失败；完成写张数。模型：读取中、失败、完成', () => {
    expect(requestRowText(tiles('a', { loaded: 3, failed: 1 }), 1000)).toStrictEqual({
      text: '4/10 张',
      progress: 0.4,
      tone: 'normal',
      waited: null
    });
    expect(requestRowText(tiles('a'), 7400)).toMatchObject({ tone: 'slow', waited: 7 });
    expect(requestRowText(tiles('a', { loaded: 8, failed: 2, finishedAt: 10 }), 20)).toMatchObject({
      text: '2 张失败',
      tone: 'error',
      progress: null
    });
    expect(requestRowText(tiles('a', { loaded: 10, finishedAt: 10 }), 20).text).toBe('10 张');
    expect(requestRowText(model('m'), 20).text).toBe('读取模型…');
    expect(requestRowText(model('m', { failed: 1, finishedAt: 10 }), 20)).toMatchObject({ text: '加载失败', tone: 'error' });
    expect(requestRowText(model('m', { loaded: 1, finishedAt: 10 }), 20).text).toBe('已完成');
    // 结束了的失败在有失败一组里写法相同
    expect(failedRowText(model('m', { failed: 1, finishedAt: 10 }), 20).text).toBe('加载失败');
  });

  it('瓦片集按块写，高斯泼溅写当前视角细节的百分比和进度；都超过 5 秒写等了几秒（ADR 0162）', () => {
    expect(requestRowText(tiles('b', { kind: 'blocks', requested: 40, loaded: 12 }), 1000)).toMatchObject({
      text: '12/40 块',
      progress: 0.3
    });
    expect(requestRowText(tiles('b', { kind: 'blocks', requested: 40, loaded: 40, finishedAt: 10 }), 20).text).toBe(
      '40 块'
    );
    const detail = tiles('d', { kind: 'detail', requested: 0, detail: 0.624 });
    expect(requestRowText(detail, 1000)).toStrictEqual({
      text: '当前视角细节 62%',
      progress: 0.624,
      tone: 'normal',
      waited: null
    });
    expect(requestRowText(detail, 6000)).toMatchObject({ tone: 'slow', waited: 6 });
    expect(requestRowText({ ...detail, finishedAt: 10 }, 20)).toMatchObject({ text: '已完成', progress: null });
  });
});

const base = { key: 'model:m', name: '模型', icon: 'model-3d' } as const;
const blocks = (startedAt: number, finishedAt: number | null = null): SceneActivity => ({
  kind: 'blocks',
  requested: 8,
  loaded: 3,
  failed: 0,
  startedAt,
  finishedAt
});
// 100 开始读索引，1100 读完
const ready: ModelPhase = { state: 'ready', startedAt: 100, finishedAt: 1100 };

describe('按类显示（ADR 0167）', () => {
  const NOW = 10_000;
  const slow = tiles('slow', { startedAt: NOW - 2000 });
  const broken = tiles('broken', { failed: 2, loaded: 8, finishedAt: NOW - 100 });
  const recent = tiles('recent', { loaded: 10, startedAt: NOW - 2000, finishedAt: NOW - 100 });
  // 还在加载、这一轮已有失败的；还在加载、带着上一轮失败的
  const pendingWithFailure = tiles('pending', { failed: 1, startedAt: NOW - 2000 });
  const carried = tiles('carried', { previousFailed: 2, startedAt: NOW - 2000 });

  it('关掉加载中：条目不显示加载中，接着看失败；明细没有加载中一组', () => {
    const kinds = { loading: false, failed: true, done: true };
    expect(requestSummary([slow, broken], SHOWING, false, kinds)).toStrictEqual({ kind: 'failed', count: 1 });
    expect(requestGroups([slow, broken], kinds).loading).toStrictEqual([]);
    // 这一轮的失败等结束才算；还有在加载的时也不说完成，明细开着时同样
    expect(requestSummary([pendingWithFailure, recent], SETTLED, false, kinds)).toStrictEqual({ kind: 'idle' });
    expect(requestSummary([pendingWithFailure, recent], SETTLED, true, kinds)).toStrictEqual({ kind: 'idle' });
    expect(requestGroups([pendingWithFailure], kinds).failed).toStrictEqual([]);
    // 带着上一轮失败的照样在有失败一组，和行内一致
    expect(requestSummary([carried], SHOWING, false, kinds)).toStrictEqual({ kind: 'failed', count: 1 });
    expect(requestGroups([carried], kinds).failed).toStrictEqual([carried]);
  });

  it('关掉加载失败：条目不说失败、加载中不带红点，有失败的项也不算完成；明细没有有失败一组', () => {
    const kinds = { loading: true, failed: false, done: true };
    expect(requestSummary([slow, broken, carried], SHOWING, false, kinds)).toStrictEqual({
      kind: 'loading',
      count: 2,
      ratio: 0,
      withFailures: 0
    });
    expect(requestSummary([broken], SETTLED, false, kinds)).toStrictEqual({ kind: 'idle' });
    expect(requestSummary([broken, recent], SETTLED, false, kinds)).toStrictEqual({ kind: 'done' });
    expect(requestGroups([broken, recent], kinds)).toStrictEqual({ loading: [], failed: [], done: [recent] });
    // 明细开着、项都以失败结束：空闲，按钮照样在
    expect(requestSummary([broken], null, true, kinds)).toStrictEqual({ kind: 'idle' });
    expect(requestSummary([], null, true, kinds)).toStrictEqual({ kind: 'idle' });
  });

  it('关掉加载完成：没有"已加载完成"，是空闲；明细没有已完成一组', () => {
    const kinds = { loading: true, failed: true, done: false };
    expect(requestSummary([recent], SETTLED, false, kinds)).toStrictEqual({ kind: 'idle' });
    expect(requestSummary([recent], SETTLED, true, kinds)).toStrictEqual({ kind: 'idle' });
    expect(requestGroups([recent, broken], kinds).done).toStrictEqual([]);
  });

  it('都关掉时按钮不显示，明细三组都是空的', () => {
    const kinds = { loading: false, failed: false, done: false };
    expect(requestSummary([slow, broken, recent], SHOWING, true, kinds)).toStrictEqual({ kind: 'hidden' });
    expect(requestSummary([], null, false, kinds)).toStrictEqual({ kind: 'hidden' });
    expect(requestGroups([slow, broken, recent], kinds)).toStrictEqual({ loading: [], failed: [], done: [] });
  });

  it('有失败的项：行内的加载失败用它，这一轮才有失败、还在加载的不算，带着上一轮失败的算', () => {
    expect(failedRequestKeys([slow, broken, recent, pendingWithFailure, carried])).toStrictEqual(
      new Set(['broken', 'carried'])
    );
  });
});

describe('modelRequestItem', () => {
  it('读索引、失败按读索引的阶段', () => {
    expect(modelRequestItem(base, { state: 'loading', startedAt: 100, finishedAt: null }, blocks(0), 500)).toMatchObject({
      kind: 'model',
      startedAt: 100,
      finishedAt: null
    });
    expect(modelRequestItem(base, { state: 'failed', startedAt: 100, finishedAt: 900 }, null, 1000)).toMatchObject({
      kind: 'model',
      failed: 1,
      finishedAt: 900
    });
  });

  it('读完索引后紧接着请求的块和读索引算同一段，从读索引开始；隔得久的一轮从自己开始', () => {
    expect(modelRequestItem(base, ready, blocks(1100 + MODEL_SETTLE), 1500)).toMatchObject({
      kind: 'blocks',
      requested: 8,
      loaded: 3,
      startedAt: 100,
      finishedAt: null
    });
    expect(modelRequestItem(base, ready, blocks(9000), 9100)).toMatchObject({ kind: 'blocks', startedAt: 9000 });
    const detail: SceneActivity = { kind: 'detail', progress: 0.4, startedAt: 1050, finishedAt: 3000 };
    expect(modelRequestItem(base, ready, detail, 4000)).toMatchObject({
      kind: 'detail',
      detail: 0.4,
      startedAt: 100,
      finishedAt: 3000
    });
  });

  it('读完、还没请求时等一会儿再算结束；这一段开始以前就结束的一轮是上次显示时的，不算', () => {
    expect(modelRequestItem(base, ready, null, 1100 + MODEL_SETTLE - 1)).toMatchObject({ kind: 'model', finishedAt: null });
    expect(modelRequestItem(base, ready, null, 1100 + MODEL_SETTLE)).toMatchObject({ kind: 'model', finishedAt: 1100 });
    expect(modelRequestItem(base, ready, blocks(0, 50), 2000)).toMatchObject({ kind: 'model', finishedAt: 1100 });
  });

  it('等块不越过读索引还没到的门槛：不到 0.4 秒读完的最多等到 0.4 秒，0.4～0.8 秒读完的最多等到 0.8 秒（不因为等这一下显示出来）', () => {
    const quick: ModelPhase = { state: 'ready', startedAt: 0, finishedAt: 300 };
    expect(modelRequestItem(base, quick, null, 350)).toMatchObject({ finishedAt: null });
    expect(modelRequestItem(base, quick, null, INLINE_DELAY)).toMatchObject({ finishedAt: 300 });
    expect(modelRequestItem(base, quick, null, 500)).toMatchObject({ finishedAt: 300 });
    // 读得更快的照样等满 MODEL_SETTLE
    const quicker: ModelPhase = { state: 'ready', startedAt: 0, finishedAt: 50 };
    expect(modelRequestItem(base, quicker, null, 50 + MODEL_SETTLE - 1)).toMatchObject({ finishedAt: null });

    // 行内已经转圈、条目还没出现的：等到 0.8 秒为止
    const inline: ModelPhase = { state: 'ready', startedAt: 0, finishedAt: 700 };
    expect(modelRequestItem(base, inline, null, CHIP_DELAY - 1)).toMatchObject({ finishedAt: null });
    expect(modelRequestItem(base, inline, null, CHIP_DELAY)).toMatchObject({ finishedAt: 700 });
    // 条目已经出现的：等满 MODEL_SETTLE
    const shown: ModelPhase = { state: 'ready', startedAt: 0, finishedAt: 900 };
    expect(modelRequestItem(base, shown, null, 900 + MODEL_SETTLE - 1)).toMatchObject({ finishedAt: null });
  });
});

describe('mergedActivity', () => {
  it('几个数据源合成一项：张数相加，从最早开始，都结束时才结束；没有数据源时为 null', () => {
    expect(mergedActivity([])).toBeNull();
    const done = { requested: 4, loaded: 4, failed: 0, startedAt: 100, finishedAt: 300 };
    const pending = { requested: 6, loaded: 1, failed: 1, startedAt: 50, finishedAt: null };
    expect(mergedActivity([done, pending])).toStrictEqual({
      requested: 10,
      loaded: 5,
      failed: 1,
      startedAt: 50,
      finishedAt: null
    });
    expect(mergedActivity([done, { ...done, finishedAt: 500 }])?.finishedAt).toBe(500);
  });

  it('只算最近的一轮：上一轮早已结束、结果还留着的数据源不拉早开始时间，张数也不算进来（2026-11-15 审查发现）', () => {
    // 底图 2 秒时就加载完了，10 分钟后打开地名，只有地名开始新的一轮
    const basemap = { requested: 20, loaded: 20, failed: 0, startedAt: 0, finishedAt: 2000 };
    const labels = { requested: 6, loaded: 1, failed: 0, startedAt: 600_000, finishedAt: null };
    expect(mergedActivity([basemap, labels])).toStrictEqual(labels);

    // 地名几十毫秒就画完：合成项从地名开始，没超过显示门槛
    const quick = { ...labels, loaded: 6, finishedAt: 600_050 };
    expect(mergedActivity([basemap, quick])).toStrictEqual(quick);

    // 较早一段的失败还算：底图上一轮缺了 3 张，地名加载完以后仍然报失败
    const brokenBasemap = { ...basemap, loaded: 17, failed: 3 };
    expect(mergedActivity([brokenBasemap, quick])).toStrictEqual({ ...quick, failed: 3 });

    // 同一轮里先结束的照样算
    const early = { requested: 4, loaded: 4, failed: 0, startedAt: 600_010, finishedAt: 600_020 };
    expect(mergedActivity([basemap, labels, early])).toStrictEqual({
      requested: 10,
      loaded: 5,
      failed: 0,
      startedAt: 600_000,
      finishedAt: null
    });
  });
});
