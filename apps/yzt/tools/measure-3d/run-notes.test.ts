// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { BenchStats } from './bench-api.ts';
import type { ZoomResult, ZoomStep } from './results.ts';
import { runNotes, zoomNotes, zoomUnsettled } from './run-notes.ts';

const JKQ = 'wuxi/3dtiles/经开区/tileset.json';

describe('runNotes', () => {
  it('都正常时没有说明', () => {
    expect(runNotes({ models: { [JKQ]: { state: 'ready', error: null } }, context: { lost: 0, restored: 0 }, proxy: { timeouts: 0, failures: 0 } })).toEqual([]);
    expect(runNotes({})).toEqual([]);
  });

  it('模型一直在加载、加载失败：分开写，用模型的目录名', () => {
    expect(runNotes({ models: { [JKQ]: { state: 'loading', error: null } } })).toEqual(['模型 经开区 一直在加载（整理索引或根节点的请求没有回来）']);
    expect(runNotes({ models: { [JKQ]: { state: 'failed', error: 'HTTP 504' } } })).toEqual(['模型 经开区 加载失败：HTTP 504']);
  });

  it('上下文丢了、代理出错都写出次数', () => {
    expect(runNotes({ context: { lost: 2, restored: 1 }, proxy: { timeouts: 3, failures: 0 } })).toEqual([
      'WebGL 上下文丢了 2 次（恢复 1 次）',
      '经代理的请求超时 3 次、失败 0 次'
    ]);
  });
});

// 说明只看稳定没有，读数用不上
const step = (stable: boolean): ZoomStep => ({
  settle: {
    stable,
    ms: 4200,
    longTasks: { count: 0, maxMs: 0, totalMs: 0, over100: 0, over200: 0, over500: 0, contextMs: 0, maxWithoutContextMs: 0 },
    trace: []
  },
  at: {} as BenchStats,
  shot: 'shots/x.png'
});
const zoom = (zoomed: ZoomStep | null, nudged: ZoomStep | null): ZoomResult => ({
  before: {} as BenchStats,
  camera: { center: [120, 31], zoom: 19, pitch: 55, bearing: 0 },
  zoomed,
  nudged
});

describe('zoomNotes', () => {
  it('两步都稳定、没跑 --zoom-in 时没有说明，也不算超时', () => {
    expect(zoomNotes(zoom(step(true), step(true)))).toEqual([]);
    expect(zoomNotes(undefined)).toEqual([]);
    expect(zoomUnsettled(zoom(step(true), step(true)))).toBe(false);
    expect(zoomUnsettled(undefined)).toBe(false);
  });

  it('放大没做完、放大后没稳定：照旧写', () => {
    expect(zoomNotes(zoom(null, null))).toEqual(['放大一级那一步没做完（页面崩溃、超时或截图出错），没有放大后的读数']);
    expect(zoomNotes(zoom(step(false), null))).toEqual(['放大一级以后没等到稳定，没有移开再移回']);
    expect(zoomUnsettled(zoom(step(false), null))).toBe(true);
  });

  it('移开再移回以后没稳定：写明这一步，不判断，算超时', () => {
    expect(zoomNotes(zoom(step(true), step(false)))).toEqual(['移开再移回以后没等到稳定，不判断放大后锁粗了没有']);
    expect(zoomUnsettled(zoom(step(true), step(false)))).toBe(true);
  });
});
