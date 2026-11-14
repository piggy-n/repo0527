// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { isActivityLoading, NO_SOURCE_ACTIVITY, SourceActivityTracker } from './source-activity';

// 时间由用例推进
function setup() {
  let time = 1000;
  const onChange = vi.fn<() => void>();
  const tracker = new SourceActivityTracker(onChange, () => time);
  const advance = (ms: number) => {
    time += ms;
  };
  return { tracker, onChange, advance };
}

describe('SourceActivityTracker', () => {
  it('一轮从第一张瓦片开始，都到了时结束；同一张瓦片不重复算，结果保留到下一轮', () => {
    const { tracker, advance } = setup();
    expect(tracker.activities).toBe(NO_SOURCE_ACTIVITY);

    tracker.started('a', '1');
    tracker.started('a', '2');
    tracker.started('a', '2');
    advance(300);
    tracker.finished('a', '1', 'loaded');
    const loading = tracker.activities.get('a');
    expect(loading).toStrictEqual({ requested: 2, loaded: 1, failed: 0, startedAt: 1000, finishedAt: null });
    expect(loading && isActivityLoading(loading)).toBe(true);

    advance(200);
    tracker.finished('a', '2', 'failed');
    expect(tracker.activities.get('a')).toStrictEqual({
      requested: 2,
      loaded: 1,
      failed: 1,
      startedAt: 1000,
      finishedAt: 1500
    });

    // 下一张瓦片开始新的一轮，上一轮的失败不再算
    advance(1000);
    tracker.started('a', '3');
    expect(tracker.activities.get('a')).toStrictEqual({
      requested: 1,
      loaded: 0,
      failed: 0,
      startedAt: 2500,
      finishedAt: null
    });
  });

  it('取消的瓦片不算请求；全部取消时这一轮不留下；不是这一轮在等的结果不算', () => {
    const { tracker } = setup();
    tracker.started('a', '1');
    tracker.started('a', '2');
    tracker.finished('a', '1', 'aborted');
    tracker.finished('a', '9', 'loaded');
    expect(tracker.activities.get('a')).toMatchObject({ requested: 1, loaded: 0, finishedAt: null });

    tracker.finished('a', '2', 'aborted');
    expect(tracker.activities.has('a')).toBe(false);
    tracker.finished('b', '1', 'loaded');
    expect(tracker.activities).toBe(NO_SOURCE_ACTIVITY);
  });

  it('引擎说数据源没有在请求了：还在等的（404 的空瓦片）算到了，结束这一轮', () => {
    const { tracker } = setup();
    tracker.started('a', '1');
    tracker.started('a', '2');
    tracker.finished('a', '1', 'failed');

    tracker.settled('a');

    expect(tracker.activities.get('a')).toMatchObject({ requested: 2, loaded: 1, failed: 1 });
    expect(tracker.activities.get('a')?.finishedAt).not.toBeNull();

    // 地图空闲时所有数据源一起结束
    tracker.started('a', '3');
    tracker.started('b', '1');
    tracker.settleAll();
    expect([...tracker.activities.values()].map(item => [item.loaded, isActivityLoading(item)])).toStrictEqual([
      [1, false],
      [1, false]
    ]);
  });

  it('每次变化通知一次，快照在变化以后才换；忘掉移除的数据源，不传时全部忘掉', () => {
    const { tracker, onChange } = setup();
    tracker.started('a', '1');
    tracker.started('b', '1');
    expect(onChange).toHaveBeenCalledTimes(2);
    const first = tracker.activities;
    expect(tracker.activities).toBe(first);
    expect(Object.isFrozen(first.get('a'))).toBe(true);

    tracker.settled('a');
    tracker.settled('a');
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(tracker.activities).not.toBe(first);

    tracker.forget(['a', 'c']);
    expect([...tracker.activities.keys()]).toStrictEqual(['b']);
    tracker.forget(['c']);
    expect(onChange).toHaveBeenCalledTimes(4);
    tracker.forget();
    expect(tracker.activities).toBe(NO_SOURCE_ACTIVITY);
  });
});
