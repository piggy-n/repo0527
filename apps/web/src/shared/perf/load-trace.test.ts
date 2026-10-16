// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { LoadTrace, type Timeline } from './load-trace';

// 记下每次调用的时间线；markThrows 为真时 mark 抛错
function recordingTimeline() {
  const calls: string[] = [];
  let markThrows = false;
  const timeline: Timeline = {
    mark: name => {
      if (markThrows) {
        throw new Error('mark 出错');
      }
      calls.push(`mark ${name}`);
    },
    measure: (name, start) => calls.push(`measure ${name} from ${start}`),
    clearMarks: name => calls.push(`clearMarks ${name}`),
    clearMeasures: name => calls.push(`clearMeasures ${name}`)
  };
  return {
    timeline,
    calls,
    failMarks: () => {
      markThrows = true;
    }
  };
}

describe('LoadTrace', () => {
  afterEach(() => {
    performance.clearMarks();
    performance.clearMeasures();
  });

  it('没开始时什么也不记', () => {
    const { timeline, calls } = recordingTimeline();
    const trace = new LoadTrace('t', ['a', 'b'], timeline);

    trace.mark('a');

    expect(calls).toStrictEqual([]);
    expect(trace.recording).toBe(false);
  });

  it('开始时清掉上一轮的标记和 measure，再记下开始的时刻', () => {
    const { timeline, calls } = recordingTimeline();
    const trace = new LoadTrace('t', ['a', 'b'], timeline);

    trace.begin();

    expect(calls).toStrictEqual([
      'clearMarks t:start',
      'clearMeasures t:start',
      'clearMarks t:a',
      'clearMeasures t:a',
      'clearMarks t:b',
      'clearMeasures t:b',
      'mark t:start'
    ]);
    expect(trace.recording).toBe(true);
  });

  it('每个步骤只记第一次，从开始量起；记到最后一个步骤时这一轮结束', () => {
    const { timeline, calls } = recordingTimeline();
    const trace = new LoadTrace('t', ['a', 'b'], timeline);
    trace.begin();
    calls.length = 0;

    trace.mark('a');
    trace.mark('a');
    trace.mark('b');
    trace.mark('a');

    expect(calls).toStrictEqual(['mark t:a', 'measure t:a from t:start', 'mark t:b', 'measure t:b from t:start']);
    expect(trace.recording).toBe(false);
  });

  it('步骤可以跳过：没记到最后一个步骤时这一轮不结束', () => {
    const { timeline, calls } = recordingTimeline();
    const trace = new LoadTrace('t', ['a', 'b', 'c'], timeline);
    trace.begin();
    calls.length = 0;

    trace.mark('b');

    expect(calls).toStrictEqual(['mark t:b', 'measure t:b from t:start']);
    expect(trace.recording).toBe(true);
  });

  it('重新开始后同一个步骤可以再记一次', () => {
    const { timeline, calls } = recordingTimeline();
    const trace = new LoadTrace('t', ['a', 'b'], timeline);
    trace.begin();
    trace.mark('a');
    trace.begin();
    calls.length = 0;

    trace.mark('a');

    expect(calls).toStrictEqual(['mark t:a', 'measure t:a from t:start']);
  });

  it('时间线抛错时不抛给调用方，这一轮照常进行', () => {
    const { timeline, calls, failMarks } = recordingTimeline();
    const trace = new LoadTrace('t', ['a', 'b'], timeline);
    failMarks();

    expect(() => trace.begin()).not.toThrow();
    expect(() => trace.mark('a')).not.toThrow();
    expect(trace.recording).toBe(true);
    expect(calls.filter(call => call.startsWith('mark') || call.startsWith('measure'))).toStrictEqual([]);
  });

  it('真实的 performance：measure 从开始的标记量起，名称同标记名', () => {
    const trace = new LoadTrace('real', ['a', 'b']);

    trace.begin();
    trace.mark('a');
    trace.mark('b');

    const measures = performance.getEntriesByType('measure').filter(({ name }) => name.startsWith('real:'));
    const [start] = performance.getEntriesByName('real:start', 'mark');
    expect(measures.map(({ name }) => name)).toStrictEqual(['real:a', 'real:b']);
    expect(measures.every(({ startTime }) => startTime === start?.startTime)).toBe(true);
  });

  it('真实的 performance：开始的标记被别处清掉时只少一条记录，不抛错', () => {
    const trace = new LoadTrace('cleared', ['a', 'b']);
    trace.begin();
    performance.clearMarks('cleared:start');

    expect(() => trace.mark('a')).not.toThrow();
    expect(performance.getEntriesByName('cleared:a', 'measure')).toStrictEqual([]);
  });
});
