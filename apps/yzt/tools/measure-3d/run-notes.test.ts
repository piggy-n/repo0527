// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { runNotes } from './run-notes.ts';

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
