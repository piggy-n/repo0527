// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { summarizeProfile } from './profile.ts';

const NODES = [
  { id: 1, callFrame: { functionName: '(idle)', url: '' } },
  { id: 2, callFrame: { functionName: 'render', url: 'http://127.0.0.1:5283/assets/three-AbCdEf12.js' } },
  { id: 3, callFrame: { functionName: 'linkProgram', url: '' } },
  { id: 4, callFrame: { functionName: 'update', url: 'http://127.0.0.1:5283/assets/map-three-Xy12Ab_-.js?v=1' } },
  { id: 5, callFrame: { functionName: '(garbage collector)', url: '' } },
  { id: 6, callFrame: { functionName: 'HTMLCanvasElement.getContext', url: 'http://127.0.0.1:5283/assets/bench-DkDg6FoX.js' } },
  { id: 7, callFrame: { functionName: 'e.<computed>', url: 'http://127.0.0.1:5283/assets/bench-DkDg6FoX.js' } },
  { id: 8, callFrame: { functionName: 'sizeFromArgs', url: 'http://127.0.0.1:5283/assets/bench-DkDg6FoX.js' } }
];

describe('summarizeProfile', () => {
  it('一个长任务按模块拆开：分块的名字去掉哈希，原生调用用函数名', () => {
    const summary = summarizeProfile(
      {
        nodes: NODES,
        samples: [2, 3, 3, 4, 5, 1, 1, 1],
        timeDeltas: [20000, 30000, 30000, 10000, 10000, 5000, 5000, 5000]
      },
      [{ startTime: 1000, duration: 100 }],
      1115
    );
    expect(summary.totalBusyMs).toBe(100);
    expect(summary.longTasks).toBe(1);
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

  it('一帧接一帧没有空闲时也不并成一段：只有页面报的长任务才算', () => {
    // 连续 300 毫秒的忙碌，页面只报了其中 60 毫秒是长任务
    const summary = summarizeProfile(
      { nodes: NODES, samples: Array.from({ length: 30 }, () => 2), timeDeltas: Array.from({ length: 30 }, () => 10000) },
      [{ startTime: 1100, duration: 60 }],
      1300
    );
    expect(summary.totalBusyMs).toBe(300);
    expect(summary.longest.map(task => task.durationMs)).toEqual([60]);
    expect(summary.modules).toEqual([{ name: 'three', ms: 60 }]);
  });

  it('页面没有报长任务时就是没有', () => {
    const summary = summarizeProfile({ nodes: NODES, samples: [2, 2], timeDeltas: [30000, 30000] }, [], 1000);
    expect(summary).toEqual({ totalBusyMs: 60, longTasks: 0, longest: [], modules: [] });
  });

  it('样本按时钟落进各自的长任务，长任务之间的样本不算', () => {
    const summary = summarizeProfile(
      { nodes: NODES, samples: [2, 4, 3], timeDeltas: [60000, 30000, 60000] },
      [
        { startTime: 1000, duration: 60 },
        { startTime: 1090, duration: 60 }
      ],
      1150
    );
    expect(summary.longest).toEqual([
      { durationMs: 60, modules: [{ name: 'three', ms: 60 }] },
      { durationMs: 60, modules: [{ name: 'linkProgram', ms: 60 }] }
    ]);
  });

  it('采样开始之前的长任务不算：加载期的长任务不混进飞行', () => {
    const summary = summarizeProfile(
      { nodes: NODES, samples: [2], timeDeltas: [60000] },
      [
        { startTime: 100, duration: 500 },
        { startTime: 1000, duration: 60 }
      ],
      1060
    );
    expect(summary.longTasks).toBe(1);
    expect(summary.longest.map(task => task.durationMs)).toEqual([60]);
  });

  it('长任务按长度排，最多给 topTasks 个', () => {
    const summary = summarizeProfile(
      { nodes: NODES, samples: [2, 3, 4], timeDeltas: [60000, 90000, 70000] },
      [
        { startTime: 1000, duration: 60 },
        { startTime: 1060, duration: 90 },
        { startTime: 1150, duration: 70 }
      ],
      1220,
      2
    );
    expect(summary.longest.map(task => task.durationMs)).toEqual([90, 70]);
  });

  it('探针包住的调用归到它实际做的事，不算探针自己慢', () => {
    const summary = summarizeProfile(
      { nodes: NODES, samples: [6, 7, 8], timeDeltas: [60000, 30000, 10000] },
      [{ startTime: 1000, duration: 100 }],
      1100
    );
    expect(summary.modules).toEqual([
      { name: '创建 WebGL 上下文', ms: 60 },
      { name: 'GL 上传（经探针）', ms: 30 },
      { name: 'bench', ms: 10 }
    ]);
  });

  it('没有采样', () => {
    expect(summarizeProfile({ nodes: [] }, [], 0)).toEqual({ totalBusyMs: 0, longTasks: 0, longest: [], modules: [] });
  });
});
