// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { SceneActivity } from '@mx/map-core';
import {
  DONE_HOLD,
  failedRequestKeys,
  mergedActivity,
  MODEL_SETTLE,
  type ModelPhase,
  modelRequestItem,
  type RequestItem,
  requestGroups,
  requestRowText,
  requestSummary,
  SHOW_DELAY
} from './request-status';

const tiles = (key: string, extra: Partial<RequestItem> = {}): RequestItem => ({
  key,
  kind: 'tiles',
  name: key,
  icon: 'geometry-polygon',
  requested: 10,
  loaded: 0,
  failed: 0,
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

describe('requestSummary', () => {
  it('空闲、加载不到 0.4 秒时不显示；超过 0.4 秒显示加载中的项数和瓦片完成的比例，有失败时带上', () => {
    expect(requestSummary([], 1000)).toStrictEqual({ kind: 'hidden' });
    const items = [tiles('a', { loaded: 3, failed: 1 }), tiles('b', { loaded: 6 }), model('m')];
    expect(requestSummary(items, SHOW_DELAY)).toStrictEqual({ kind: 'failed', count: 1 });
    expect(requestSummary([tiles('a')], SHOW_DELAY)).toStrictEqual({ kind: 'hidden' });

    expect(requestSummary(items, SHOW_DELAY + 1)).toStrictEqual({
      kind: 'loading',
      count: 3,
      ratio: 0.5,
      withFailures: 1
    });
    // 只有模型在加载时没有比例
    expect(requestSummary([model('m')], 1000)).toStrictEqual({ kind: 'loading', count: 1, ratio: null, withFailures: 0 });
  });

  it('瓦片集的块和二维瓦片按张数、块数合起来算比例；高斯泼溅的细节比例不算进去，只算项数（ADR 0162）', () => {
    const blocks = tiles('b', { kind: 'blocks', requested: 30, loaded: 15 });
    const detail = tiles('d', { kind: 'detail', requested: 0, detail: 0.9 });
    expect(requestSummary([tiles('a', { loaded: 5 }), blocks, detail], 1000)).toMatchObject({ count: 3, ratio: 0.5 });
    expect(requestSummary([detail], 1000)).toMatchObject({ count: 1, ratio: null });
  });

  it('结束后有失败时一直显示几项失败；显示过的加载结束后 1.5 秒内是"已加载完成"，快的不显示；明细开着时至少显示完成', () => {
    const failed = [tiles('a', { loaded: 9, failed: 1, finishedAt: 2000 })];
    expect(requestSummary(failed, 99_000)).toStrictEqual({ kind: 'failed', count: 1 });

    const slow = [tiles('a', { loaded: 10, finishedAt: 2000 })];
    expect(requestSummary(slow, 2000 + DONE_HOLD - 1)).toStrictEqual({ kind: 'done' });
    expect(requestSummary(slow, 2000 + DONE_HOLD)).toStrictEqual({ kind: 'hidden' });
    const fast = [tiles('a', { loaded: 10, finishedAt: SHOW_DELAY })];
    expect(requestSummary(fast, SHOW_DELAY + 10)).toStrictEqual({ kind: 'hidden' });
    expect(requestSummary(fast, SHOW_DELAY + 10, true)).toStrictEqual({ kind: 'done' });
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

  it('关掉加载中：条目不显示加载中，接着看失败；明细没有加载中一组', () => {
    const kinds = { loading: false, failed: true, done: true };
    expect(requestSummary([slow, broken], NOW, false, kinds)).toStrictEqual({ kind: 'failed', count: 1 });
    expect(requestGroups([slow, broken], kinds).loading).toStrictEqual([]);
    // 还在加载、已有失败的不算失败，和明细一致（它不在有失败一组）；还有在加载的时也不说完成，明细开着时同样
    const pendingWithFailure = tiles('pending', { failed: 1, startedAt: NOW - 2000 });
    expect(requestSummary([pendingWithFailure, recent], NOW, false, kinds)).toStrictEqual({ kind: 'hidden' });
    expect(requestSummary([pendingWithFailure, recent], NOW, true, kinds)).toStrictEqual({ kind: 'hidden' });
    expect(requestGroups([pendingWithFailure], kinds).failed).toStrictEqual([]);
  });

  it('关掉加载失败：条目不说失败、加载中不带红点，有失败的项也不算完成；明细没有有失败一组', () => {
    const kinds = { loading: true, failed: false, done: true };
    expect(requestSummary([slow, broken], NOW, false, kinds)).toStrictEqual({
      kind: 'loading',
      count: 1,
      ratio: 0,
      withFailures: 0
    });
    const failedLong = { ...broken, startedAt: NOW - 2000 };
    expect(requestSummary([failedLong], NOW, false, kinds)).toStrictEqual({ kind: 'hidden' });
    expect(requestSummary([failedLong, recent], NOW, false, kinds)).toStrictEqual({ kind: 'done' });
    expect(requestGroups([broken, recent], kinds)).toStrictEqual({ loading: [], failed: [], done: [recent] });
  });

  it('关掉加载完成：没有"已加载完成"，明细开着时也不留；明细没有已完成一组', () => {
    const kinds = { loading: true, failed: true, done: false };
    expect(requestSummary([recent], NOW, false, kinds)).toStrictEqual({ kind: 'hidden' });
    expect(requestSummary([recent], NOW, true, kinds)).toStrictEqual({ kind: 'hidden' });
    expect(requestGroups([recent, broken], kinds).done).toStrictEqual([]);
  });

  it('都关掉时条目不显示，明细三组都是空的', () => {
    const kinds = { loading: false, failed: false, done: false };
    expect(requestSummary([slow, broken, recent], NOW, true, kinds)).toStrictEqual({ kind: 'hidden' });
    expect(requestGroups([slow, broken, recent], kinds)).toStrictEqual({ loading: [], failed: [], done: [] });
  });

  it('有失败、已经结束的项：行内的加载失败用它，加载中的不算', () => {
    const pendingWithFailure = tiles('pending', { failed: 1 });
    expect(failedRequestKeys([slow, broken, recent, pendingWithFailure])).toStrictEqual(new Set(['broken']));
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

  it('读索引不到 0.4 秒就读完的：等块最多等到开始后 0.4 秒，不因为等这一下显示出来（2026-11-16 复核）', () => {
    const quick: ModelPhase = { state: 'ready', startedAt: 0, finishedAt: 300 };
    expect(modelRequestItem(base, quick, null, 350)).toMatchObject({ finishedAt: null });
    expect(modelRequestItem(base, quick, null, SHOW_DELAY)).toMatchObject({ finishedAt: 300 });
    expect(modelRequestItem(base, quick, null, 500)).toMatchObject({ finishedAt: 300 });
    // 读得更快的照样等满 MODEL_SETTLE
    const quicker: ModelPhase = { state: 'ready', startedAt: 0, finishedAt: 50 };
    expect(modelRequestItem(base, quicker, null, 50 + MODEL_SETTLE - 1)).toMatchObject({ finishedAt: null });
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
