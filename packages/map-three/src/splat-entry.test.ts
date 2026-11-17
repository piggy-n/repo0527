// @vitest-environment node
import type { SceneFrame, SceneSurface } from '@mx/map-core';
import { describe, expect, it, vi } from 'vitest';
import { Group, Matrix4, type WebGLRenderer } from 'three';
import { FrameMath } from './frame';
import { SplatEntry, type SplatLibrary } from './splat-entry';
import { retriedByLibrary } from './splat-errors';

// 库的调度器换成假的：只留构造、画一帧时要用的，记下交给它的 onError；统计由用例改
class FakeScheduler {
  static last: FakeScheduler | null = null;
  readonly group = new Group();
  stats = { loadingChunks: 0, loadProgress: 1 };
  readonly options: { readonly onError?: (error: unknown, url: string) => void };

  constructor(options: FakeScheduler['options']) {
    this.options = options;
    FakeScheduler.last = this;
  }

  setCamera(): boolean {
    return true;
  }

  update(): void {}

  dispose(): void {}
}

// 库的绘制对象：挂进场景、能释放就够了
class FakeSplatRenderer extends Group {
  dispose(): void {}
}

const library = { Lcc2StreamScheduler: FakeScheduler, GaussianSplatRenderer: FakeSplatRenderer } as unknown as SplatLibrary;

// 墨卡托下的一帧：相机在原点上方、朝下看；锚点矩阵是单位阵
const projection = new Matrix4().makePerspective(-5, 5, 5, -5, 10, 1000);
const FRAME: SceneFrame = {
  mainMatrix: Float64Array.from(projection.clone().multiply(new Matrix4().makeTranslation(0, 0, -500)).elements),
  fallbackMatrix: Float64Array.from(projection.elements),
  projectionMatrix: Float64Array.from(projection.elements),
  transition: 0,
  clippingPlane: [0, 0, 0, 0]
};
const IDENTITY = Float64Array.from(new Matrix4().elements);
const SURFACE = {
  requestRepaint: () => undefined,
  anchor: () => ({ mercator: IDENTITY, globe: IDENTITY })
} as unknown as SceneSurface;

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

describe('SplatEntry 这一帧的加载（ADR 0162）', () => {
  it('没画不算；画了时有在路上的数据块、或细节的比例在 0 和 1 之间算加载中；比例为 0 且没有在路上的是什么也没选中，不算', () => {
    const { splat } = entry();
    const scheduler = FakeScheduler.last;
    if (!scheduler) {
      throw new Error('没有创建调度器');
    }
    const load = (loadingChunks: number, loadProgress: number) => {
      scheduler.stats = { loadingChunks, loadProgress };
      return splat.detailLoad();
    };
    // 没有绘制对象时画不了
    expect(splat.prepare(FRAME, SURFACE)).toBe(false);
    expect(load(2, 0.5)).toStrictEqual({ loading: false, progress: 1 });

    splat.setRenderer({} as WebGLRenderer);
    expect(splat.prepare(FRAME, SURFACE)).toBe(true);
    expect(load(2, 0.5)).toStrictEqual({ loading: true, progress: 0.5 });
    expect(load(1, 0)).toStrictEqual({ loading: true, progress: 0 });
    expect(load(0, 0.3)).toStrictEqual({ loading: true, progress: 0.3 });
    expect(load(0, 0)).toStrictEqual({ loading: false, progress: 0 });
    expect(load(0, 1)).toStrictEqual({ loading: false, progress: 1 });

    // 抬高别的模型时这一帧不画
    splat.skipFrame();
    expect(load(2, 0.5)).toStrictEqual({ loading: false, progress: 1 });
    splat[Symbol.dispose]();
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
