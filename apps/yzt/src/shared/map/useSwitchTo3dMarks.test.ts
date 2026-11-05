// @vitest-environment node
import type { ViewKind } from '@yzt/map-core';
import { describe, expect, it } from 'vitest';
import { effectScope, shallowRef } from 'vue';
import { LoadTrace, type Timeline } from '../perf/load-trace';
import { SWITCH_TO_3D_STEPS, type SwitchTo3dStep } from '../perf/switch-to-3d';
import { useSwitchTo3dMarks } from './useSwitchTo3dMarks';

// 只记下标记了哪些步骤
function traceOf(marks: string[]): LoadTrace<SwitchTo3dStep> {
  const timeline: Timeline = {
    mark: name => marks.push(name),
    measure: () => undefined,
    clearMarks: () => undefined,
    clearMeasures: () => undefined
  };
  return new LoadTrace<SwitchTo3dStep>('trace', SWITCH_TO_3D_STEPS, timeline);
}

// 由测试决定何时就绪、何时稳定的地图；中止时以 AbortError 结束，并记下收到的 signal
function fakeMap() {
  const signals: AbortSignal[] = [];
  const control = { ready: () => undefined as void, settle: () => undefined as void };
  const wait = (key: 'ready' | 'settle') => (signal?: AbortSignal) => {
    if (signal) {
      signals.push(signal);
    }
    return new Promise<void>((resolve, reject) => {
      control[key] = resolve;
      signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
  };
  const dimension = shallowRef<ViewKind>('2d');
  return { map: { dimension, whenReady: wait('ready'), whenSettled: wait('settle') }, control, signals };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('useSwitchTo3dMarks', () => {
  it('切到三维时开始一轮，依次记下视图就绪、画面稳定', async () => {
    const marks: string[] = [];
    const trace = traceOf(marks);
    const { map, control } = fakeMap();
    const scope = effectScope();
    scope.run(() => useSwitchTo3dMarks(map, trace));
    expect(marks).toStrictEqual([]);

    map.dimension.value = '3d';
    // 同步开始：开始的时刻就是切换的时刻
    expect(marks).toStrictEqual(['trace:start']);
    control.ready();
    await flush();
    control.settle();
    await flush();

    expect(marks).toStrictEqual(['trace:start', 'trace:view-ready', 'trace:settled']);
    expect(trace.recording).toBe(false);
    scope.stop();
  });

  it('还没稳定就切回二维：停止等待，这一轮停在已经记下的步骤；再切过去开始新的一轮', async () => {
    const marks: string[] = [];
    const { map, control, signals } = fakeMap();
    const scope = effectScope();
    scope.run(() => useSwitchTo3dMarks(map, traceOf(marks)));
    map.dimension.value = '3d';
    control.ready();
    await flush();

    map.dimension.value = '2d';
    control.settle();
    await flush();
    expect(signals.every(signal => signal.aborted)).toBe(true);
    expect(marks).toStrictEqual(['trace:start', 'trace:view-ready']);

    map.dimension.value = '3d';
    expect(marks.at(-1)).toBe('trace:start');
    scope.stop();
  });

  it('页面卸载时中止等待，之后不再记录', async () => {
    const marks: string[] = [];
    const { map, control, signals } = fakeMap();
    const scope = effectScope();
    scope.run(() => useSwitchTo3dMarks(map, traceOf(marks)));
    map.dimension.value = '3d';

    scope.stop();
    control.ready();
    await flush();

    expect(signals.every(signal => signal.aborted)).toBe(true);
    expect(marks).toStrictEqual(['trace:start']);
  });
});
