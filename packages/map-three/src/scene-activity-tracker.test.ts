// @vitest-environment node
import type { TileOutcome } from '@mx/map-core';
import { describe, expect, it } from 'vitest';
import { SceneActivityTracker } from './scene-activity-tracker';

// 时间和变化次数由用例控制
function setup() {
  let time = 100;
  let changes = 0;
  const tracker = new SceneActivityTracker(
    () => changes++,
    () => time
  );
  return {
    tracker,
    tick: (ms: number) => (time += ms),
    changes: () => changes
  };
}

// 一块瓦片：结果由用例改，sweep 时按它结算
function tile(outcome: TileOutcome | null = null) {
  const state = { outcome };
  return { tile: {}, state, probe: () => state.outcome };
}

describe('SceneActivityTracker', () => {
  it('瓦片集按块记：sweep 时按瓦片的状态结算，被淘汰的不算请求；都有结果时结束，保留到下一轮', () => {
    const { tracker, tick } = setup();
    const a = tile();
    const b = tile();
    const c = tile();
    tracker.requested('station', a.tile, a.probe);
    tracker.requested('station', b.tile, b.probe);
    tracker.requested('station', c.tile, c.probe);
    tracker.requested('station', a.tile, a.probe);
    expect(tracker.activities.get('station')).toStrictEqual({
      kind: 'blocks',
      requested: 3,
      loaded: 0,
      failed: 0,
      startedAt: 100,
      finishedAt: null
    });

    a.state.outcome = 'loaded';
    c.state.outcome = 'aborted';
    tracker.sweep();
    expect(tracker.activities.get('station')).toMatchObject({ requested: 2, loaded: 1, finishedAt: null });

    tick(500);
    b.state.outcome = 'failed';
    tracker.sweep();
    expect(tracker.activities.get('station')).toMatchObject({ requested: 2, loaded: 1, failed: 1, finishedAt: 600 });

    // 下一轮从头数
    const d = tile();
    tracker.requested('station', d.tile, d.probe);
    expect(tracker.activities.get('station')).toMatchObject({ requested: 1, loaded: 0, failed: 0, startedAt: 600 });
  });

  it('高斯泼溅按帧报：变成加载中时开始新的一轮，比例跟着最近一帧，不再加载时结束', () => {
    const { tracker, tick } = setup();
    tracker.detail('splat', false, 1);
    expect(tracker.activities.size).toBe(0);

    tracker.detail('splat', true, 0.2);
    tick(300);
    tracker.detail('splat', true, 0.6);
    expect(tracker.activities.get('splat')).toStrictEqual({
      kind: 'detail',
      progress: 0.6,
      startedAt: 100,
      finishedAt: null
    });

    tick(200);
    tracker.detail('splat', false, 1);
    expect(tracker.activities.get('splat')).toMatchObject({ progress: 0.6, startedAt: 100, finishedAt: 600 });

    tick(1000);
    tracker.detail('splat', true, 0.1);
    expect(tracker.activities.get('splat')).toMatchObject({ progress: 0.1, startedAt: 1600, finishedAt: null });
  });

  it('没有变化时快照是同一个对象、不通知；移除后忘掉', () => {
    const { tracker, changes } = setup();
    const a = tile();
    tracker.requested('station', a.tile, a.probe);
    tracker.detail('splat', true, 0.5);
    const before = changes();
    const snapshot = tracker.activities;
    tracker.sweep();
    tracker.detail('splat', true, 0.5);
    tracker.detail('other', false, 1);
    expect(changes()).toBe(before);
    expect(tracker.activities).toBe(snapshot);

    tracker.forget('station');
    tracker.forget('splat');
    expect(changes()).toBe(before + 2);
    expect(tracker.activities.size).toBe(0);
  });
});
