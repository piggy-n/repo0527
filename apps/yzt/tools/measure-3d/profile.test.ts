// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { summarizeProfile } from './profile.ts';

const NODES = [
  { id: 1, callFrame: { functionName: '(idle)', url: '' } },
  { id: 2, callFrame: { functionName: 'render', url: 'http://127.0.0.1:5283/assets/three-AbCdEf12.js' } },
  { id: 3, callFrame: { functionName: 'linkProgram', url: '' } },
  { id: 4, callFrame: { functionName: 'update', url: 'http://127.0.0.1:5283/assets/map-three-Xy12Ab_-.js?v=1' } },
  { id: 5, callFrame: { functionName: '(garbage collector)', url: '' } }
];

describe('summarizeProfile', () => {
  it('连续忙碌的一段按模块拆开：分块的名字去掉哈希，原生调用用函数名', () => {
    const summary = summarizeProfile({
      nodes: NODES,
      samples: [2, 3, 3, 4, 5, 1, 1, 1],
      timeDeltas: [20000, 30000, 30000, 10000, 10000, 5000, 5000, 5000]
    });
    expect(summary.totalBusyMs).toBe(100);
    expect(summary.longest).toEqual([
      {
        durationMs: 100,
        modules: [
          { name: 'linkProgram', ms: 60 },
          { name: 'three', ms: 20 },
          { name: 'map-three', ms: 10 },
          { name: '(garbage collector)', ms: 10 }
        ]
      }
    ]);
  });

  it('空闲超过 2 毫秒才算断开；不到 50 毫秒的段不算长任务', () => {
    const summary = summarizeProfile({
      nodes: NODES,
      samples: [2, 1, 2, 1, 2],
      // 30 毫秒、空闲 1 毫秒、30 毫秒、空闲 10 毫秒、40 毫秒
      timeDeltas: [30000, 1000, 30000, 10000, 40000]
    });
    expect(summary.longest.map(segment => segment.durationMs)).toEqual([60]);
    expect(summary.modules).toEqual([{ name: 'three', ms: 60 }]);
  });

  it('长任务按长度排，最多给 topSegments 段', () => {
    const summary = summarizeProfile(
      {
        nodes: NODES,
        samples: [2, 1, 3, 1, 4],
        timeDeltas: [60000, 5000, 90000, 5000, 70000]
      },
      2
    );
    expect(summary.longest.map(segment => segment.durationMs)).toEqual([90, 70]);
  });

  it('没有采样', () => {
    expect(summarizeProfile({ nodes: [] })).toEqual({ totalBusyMs: 0, longest: [], modules: [] });
  });
});
