// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { required } from '@/shared/testing/required';
import type { ReportCriteria, ReportStatus } from './report';
import {
  isTrackingActive,
  NEW_TASK_WAIT,
  RECOMPUTE_WAIT,
  reportNotice,
  trackAccepted,
  trackObserved,
  trackRejected,
  trackSubmitted
} from './tracking';

const TARGET: ReportCriteria = { year: '2025', table: 'baseTable', level: 'province', baseYear: null };

const report = (change: Partial<ReportStatus['counts']>, progress: number | null = null): ReportStatus => ({
  rows: [],
  counts: { total: 0, completed: 0, failed: 0, processing: 0, notStarted: 0, ...change },
  progress,
  statusText: null,
  tables: [],
  levels: []
});

const EMPTY = report({});
const RUNNING = report({ total: 51, completed: 10, notStarted: 40, processing: 1 });
const DONE = report({ total: 51, completed: 50, failed: 1 }, 100);

const submitted = (recompute: boolean) =>
  required(trackSubmitted([{ target: TARGET, recompute }], 1)[0], '提交的跟踪');

describe('提交后的跟踪', () => {
  it('提交时每个组合一条，记下这次提交一共几项', () => {
    const items = trackSubmitted(
      [
        { target: TARGET, recompute: false },
        { target: { ...TARGET, level: 'city' }, recompute: true }
      ],
      3
    );
    expect(items.map(item => [item.target.level, item.phase, item.count, item.run, item.recompute])).toEqual([
      ['province', 'submitting', 2, 3, false],
      ['city', 'submitting', 2, 3, true]
    ]);
  });

  it('创建成功后开始等：新统计 90 秒，重新统计 15 秒', () => {
    expect(trackAccepted(submitted(false), 1000)).toMatchObject({ phase: 'waiting', deadline: 1000 + NEW_TASK_WAIT });
    expect(trackAccepted(submitted(true), 1000)).toMatchObject({ phase: 'waiting', deadline: 1000 + RECOMPUTE_WAIT });
  });

  it('明确被拒绝时失败；没有明确结果时按可能已提交继续等', () => {
    expect(trackRejected(submitted(false), '已有任务', false, 0)).toMatchObject({ phase: 'failed', message: '已有任务' });
    expect(trackRejected(submitted(false), '网络异常', true, 0)).toMatchObject({
      phase: 'waiting',
      uncertain: true,
      deadline: NEW_TASK_WAIT
    });
  });

  it('新统计：查到在处理就是处理中，查到结果就结束', () => {
    const waiting = trackAccepted(submitted(false), 0);
    const processing = trackObserved(waiting, RUNNING, 1000);
    expect(processing?.phase).toBe('processing');
    expect(trackObserved(waiting, DONE, 1000)).toBeNull();
  });

  it('重新统计：查到的旧结果不算，见过处理中才算本次的；等到截止还没变就超时', () => {
    const waiting = trackAccepted(submitted(true), 0);
    expect(trackObserved(waiting, DONE, 1000)).toBe(waiting);
    const processing = trackObserved(waiting, RUNNING, 2000);
    expect(processing).not.toBeNull();
    expect(trackObserved(required(processing, '处理中的跟踪'), DONE, 3000)).toBeNull();
    expect(trackObserved(waiting, DONE, RECOMPUTE_WAIT + 1)).toMatchObject({ phase: 'timeout' });
  });

  it('新统计等到截止也没查到任务就超时；失败和超时之后不再变化', () => {
    const waiting = trackAccepted(submitted(false), 0);
    expect(trackObserved(waiting, EMPTY, NEW_TASK_WAIT - 1)).toBe(waiting);
    const timeout = trackObserved(waiting, EMPTY, NEW_TASK_WAIT);
    expect(timeout).toMatchObject({ phase: 'timeout' });
    expect(trackObserved(required(timeout, '超时的跟踪'), DONE, NEW_TASK_WAIT + 1)).toBe(timeout);
    expect(isTrackingActive(timeout)).toBe(false);
    expect(isTrackingActive(waiting)).toBe(true);
  });

  it('提示：查询出错优先；提交中、等待、未确认、失败、超时各有说法，处理中不另外提示', () => {
    const waiting = trackAccepted(submitted(false), 0);
    expect(reportNotice(waiting, '查询失败')).toEqual({ type: 'error', text: '查询失败', retry: true });
    expect(reportNotice(submitted(false), null)?.text).toBe('统计请求提交中（基本统计报表 / 省级 / 2025年），请稍候...');
    expect(reportNotice(waiting, null)?.text).toBe(
      '已提交统计分析请求（基本统计报表 / 省级 / 2025年），正在等待任务生成，请稍候...'
    );
    expect(reportNotice(trackAccepted(submitted(true), 0), null)?.text).toBe(
      '已提交重新统计请求（基本统计报表 / 省级 / 2025年），正在刷新处理结果...'
    );
    expect(reportNotice(trackRejected(waiting, '网络异常', true, 0), null)).toMatchObject({ type: 'warning', retry: false });
    expect(reportNotice(trackRejected(waiting, '已有任务', false, 0), null)).toEqual({
      type: 'error',
      text: '已有任务',
      retry: true
    });
    expect(reportNotice(trackObserved(waiting, EMPTY, NEW_TASK_WAIT), null)).toMatchObject({
      type: 'warning',
      retry: true
    });
    expect(reportNotice(trackObserved(waiting, RUNNING, 0), null)).toBeNull();
    expect(reportNotice(null, null)).toBeNull();
  });

  it('提示里写明变化类报表的本底年份和水路网的区县级', () => {
    const [change, water] = trackSubmitted(
      [
        { target: { year: '2025', table: 'baseChangeTable', level: 'city', baseYear: '2023' }, recompute: false },
        { target: { year: '2025', table: 'changeWaterTable', level: 'district', baseYear: '2024' }, recompute: false }
      ],
      1
    );
    expect(reportNotice(required(change, '基本变化的跟踪'), null)?.text).toBe(
      '统计请求提交中（基本变化统计报表 / 市级 / 2025年 / 本底2023年），请稍候...'
    );
    expect(reportNotice(required(water, '水路网变化的跟踪'), null)?.text).toBe(
      '统计请求提交中（水路网变化统计报表 / 区县级 / 2025年 / 本底2024年），请稍候...'
    );
  });
});
