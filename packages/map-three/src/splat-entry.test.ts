// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { Group } from 'three';
import { FrameMath } from './frame';
import { SplatEntry, type SplatLibrary } from './splat-entry';
import { retriedByLibrary } from './splat-errors';

// 库的调度器换成假的：只留构造时要用的，记下交给它的 onError
class FakeScheduler {
  static last: FakeScheduler | null = null;
  readonly group = new Group();
  readonly options: { readonly onError?: (error: unknown, url: string) => void };

  constructor(options: FakeScheduler['options']) {
    this.options = options;
    FakeScheduler.last = this;
  }

  setCamera(): boolean {
    return true;
  }

  dispose(): void {}
}

const library = { Lcc2StreamScheduler: FakeScheduler } as unknown as SplatLibrary;

function entry() {
  const failed = vi.fn<(error: unknown) => void>();
  const splat = new SplatEntry({
    library,
    source: { url: 'https://maps.test/3dt/a/a.lcc2', placement: { lng: 117, lat: 34, height: 0, heading: 0 } },
    options: { show: true },
    math: new FrameMath(),
    budget: 1000,
    events: { failed, repaint: () => undefined }
  });
  const onError = FakeScheduler.last?.options.onError;
  if (!onError) {
    throw new Error('没有交给调度器 onError');
  }
  return { splat, failed, onError };
}

const named = (name: string, message = name) => Object.assign(new Error(message), { name });

describe('retriedByLibrary', () => {
  it('同 gaussian-splat-lite 1.6.1 的 streamRetryAt：408、425、429、5xx、网络错误、Worker 被终止会重试，其余不会', () => {
    const retried = [
      new Error('HTTP 503 loading https://maps.test/a.sog'),
      new Error('HTTP 408 loading x'),
      new Error('HTTP 425 loading x'),
      new Error('HTTP 429 loading x'),
      new Error('HTTP 500 loading x'),
      new TypeError('Failed to fetch'),
      named('NetworkError'),
      named('WorkerTerminatedError', 'HTTP 404 worker died')
    ];
    const final = [
      new Error('HTTP 404 loading x'),
      new Error('HTTP 403 loading x'),
      new Error('invalid SOG header'),
      Object.assign(new Error('HTTP 503 loading x'), { fatal: true }),
      'HTTP 400'
    ];

    expect(retried.filter(error => !retriedByLibrary(error))).toStrictEqual([]);
    expect(final.filter(error => retriedByLibrary(error))).toStrictEqual([]);
  });
});

describe('SplatEntry 的数据块错误', () => {
  it('库会自己重试的不报告失败，不会重试的报告一次，带上地址和原因', () => {
    const { splat, failed, onError } = entry();

    onError(new Error('HTTP 503 loading https://maps.test/3dt/a/data/3dgs/0.sog'), 'https://maps.test/3dt/a/data/3dgs/0.sog');
    onError(new TypeError('Failed to fetch'), 'https://maps.test/3dt/a/data/3dgs/1.sog');
    expect(failed).not.toHaveBeenCalled();

    const broken = new Error('invalid SOG header');
    onError(broken, 'https://maps.test/3dt/a/data/3dgs/2.sog');
    expect(failed).toHaveBeenCalledOnce();
    const [reported] = failed.mock.calls[0] ?? [];
    expect(reported).toBeInstanceOf(Error);
    expect(String(reported)).toContain('2.sog');
    expect((reported as Error).cause).toBe(broken);
    splat[Symbol.dispose]();
  });
});
