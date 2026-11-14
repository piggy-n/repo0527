// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  DONE_HOLD,
  mergedActivity,
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
});
