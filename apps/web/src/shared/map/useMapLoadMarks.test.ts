// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { effectScope } from 'vue';
import { LoadTrace, type Timeline } from '../perf/load-trace';
import { LOGIN_TO_MAP_STEPS, type LoginToMapStep } from '../perf/login-to-map';
import { useMapLoadMarks } from './useMapLoadMarks';

// 只记下标记了哪些步骤
function traceOf(marks: string[]): LoadTrace<LoginToMapStep> {
  const timeline: Timeline = {
    mark: name => marks.push(name),
    measure: () => undefined,
    clearMarks: () => undefined,
    clearMeasures: () => undefined
  };
  return new LoadTrace<LoginToMapStep>('trace', LOGIN_TO_MAP_STEPS, timeline);
}

// 由测试决定何时就绪、何时稳定的地图：ready、settle 结束当前的等待，fail 让它失败；中止时以 AbortError 结束，并记下收到的 signal
function fakeMap() {
  const signals: AbortSignal[] = [];
  const control: { ready: () => void; settle: () => void; fail: (reason: unknown) => void } = {
    ready: () => undefined,
    settle: () => undefined,
    fail: () => undefined
  };
  const wait = (key: 'ready' | 'settle') => (signal?: AbortSignal) => {
    if (signal) {
      signals.push(signal);
    }
    return new Promise<void>((resolve, reject) => {
      control[key] = resolve;
      control.fail = reject;
      signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
  };
  return { map: { whenReady: wait('ready'), whenSettled: wait('settle') }, control, signals };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('useMapLoadMarks', () => {
  it('在一轮里时依次记下地图页、视图就绪、画面稳定', async () => {
    const marks: string[] = [];
    const trace = traceOf(marks);
    trace.begin();
    const { map, control } = fakeMap();
    const scope = effectScope();

    scope.run(() => useMapLoadMarks(map, trace));
    expect(marks).toStrictEqual(['trace:start', 'trace:page']);
    control.ready();
    await flush();
    expect(marks.at(-1)).toBe('trace:view-ready');
    control.settle();
    await flush();

    expect(marks).toStrictEqual(['trace:start', 'trace:page', 'trace:view-ready', 'trace:settled']);
    expect(trace.recording).toBe(false);
    scope.stop();
  });

  it('不在一轮里时不等待视图', () => {
    const marks: string[] = [];
    const { map, signals } = fakeMap();
    const scope = effectScope();

    scope.run(() => useMapLoadMarks(map, traceOf(marks)));

    expect(marks).toStrictEqual([]);
    expect(signals).toStrictEqual([]);
    scope.stop();
  });

  it('视图失败时停在已经记下的步骤，不抛出', async () => {
    const marks: string[] = [];
    const trace = traceOf(marks);
    trace.begin();
    const { map, control } = fakeMap();
    const scope = effectScope();

    scope.run(() => useMapLoadMarks(map, trace));
    control.fail(new Error('引擎失败'));
    await flush();

    expect(marks).toStrictEqual(['trace:start', 'trace:page']);
    scope.stop();
  });

  it('页面卸载时中止等待，之后不再记录', async () => {
    const marks: string[] = [];
    const trace = traceOf(marks);
    trace.begin();
    const { map, control, signals } = fakeMap();
    const scope = effectScope();
    scope.run(() => useMapLoadMarks(map, trace));
    control.ready();
    await flush();

    scope.stop();
    control.settle();
    await flush();

    expect(signals.every(signal => signal.aborted)).toBe(true);
    expect(marks).toStrictEqual(['trace:start', 'trace:page', 'trace:view-ready']);
  });
});
