import type { CesiumScene, SceneInspection } from '@mx/map-cesium';
import type { CameraState, PreparedTileset } from '@mx/map-core';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { effectScope } from 'vue';
import { required } from '@/shared/testing/required';
import { type ProbeScene, type TilesetProbeOptions, useTilesetProbe } from './useTilesetProbe';

const MB = 1024 * 1024;
const MODEL = { id: 'jkq', name: '经开区', url: 'http://example.test/3dt/jkq/tileset.json' };
const FIT: CameraState = { center: [120.3, 31.5], zoom: 14, bearing: 0, pitch: 55 };
const PREPARED: PreparedTileset = {
  geometricError: 100,
  root: { geometricError: 50, boundingVolume: { sphere: [0, 0, 0, 1] } }
};
// 测试用的停留：至少 500 毫秒，误差 250 毫秒没变就换，最多 2 秒
const HOLD = { minMs: 500, maxMs: 2000, stableMs: 250 };
const SETTINGS = { maximumScreenSpaceError: 16 };

/** 假场景的读数怎么随 inspect 的次数变：帧每次加 2、tick 加 3、累计加载加 1、卸载每两次加 1、显存每次加 10 MB */
interface Readings {
  tilesLoaded: boolean;
  readonly selected: (calls: number) => number;
  readonly sse: (calls: number) => number;
}

const STEADY: Readings = { tilesLoaded: true, selected: () => 30, sse: () => 16 };

function inspectionOf(calls: number, readings: Readings): SceneInspection {
  return {
    ticks: calls * 3,
    frames: calls * 2,
    renderErrors: 0,
    cameraChanges: calls,
    cameraIdles: 0,
    drawingBufferWidth: 1920,
    drawingBufferHeight: 1080,
    devicePixelRatio: 1,
    renderer: 'NVIDIA GeForce RTX 3060',
    tilesets: [
      {
        id: MODEL.id,
        show: true,
        cacheBytes: 1024 * MB,
        maximumCacheOverflowBytes: 512 * MB,
        maximumScreenSpaceError: 16,
        screenSpaceErrorFloor: null,
        memoryAdjustedScreenSpaceError: readings.sse(calls),
        totalMemoryUsageInBytes: calls * 10 * MB,
        tilesLoaded: readings.tilesLoaded,
        statistics: {
          selected: readings.selected(calls),
          visited: readings.selected(calls) * 2,
          numberOfAttemptedRequests: 0,
          numberOfPendingRequests: readings.tilesLoaded ? 0 : 5,
          numberOfTilesProcessing: 0,
          numberOfTilesWithContentReady: calls,
          numberOfTilesTotal: 100,
          numberOfLoadedTilesTotal: calls
        },
        selection: null,
        loaded: calls,
        unloaded: Math.floor(calls / 2),
        failed: 0
      }
    ]
  };
}

function fakeScene(readings: Readings) {
  let calls = 0;
  const jumps: CameraState[] = [];
  const failures: ((id: string, error: unknown) => void)[] = [];
  const dispose = vi.fn<() => void>();
  const setRendering = vi.fn<ProbeScene['setRendering']>();
  const addTileset = vi.fn<ProbeScene['addTileset']>(() => Promise.resolve(FIT));
  const scene: ProbeScene = {
    jumpTo: camera => {
      jumps.push(camera);
    },
    readCamera: () => jumps.at(-1) ?? null,
    addTileset,
    inspect: () => {
      calls++;
      return inspectionOf(calls, readings);
    },
    setRendering,
    resize: vi.fn<ProbeScene['resize']>(),
    on: (_event, callback) => {
      failures.push(callback);
      return () => undefined;
    },
    [Symbol.dispose]: dispose
  };
  return { scene, jumps, failures, dispose, setRendering, addTileset };
}

function setup(overrides: Partial<TilesetProbeOptions> = {}, readings: Readings = { ...STEADY }) {
  const fake = fakeScene(readings);
  const scope = effectScope();
  const probe = scope.run(() =>
    useTilesetProbe({
      loadRuntime: () => Promise.resolve(),
      createScene: () => Promise.resolve(fake.scene),
      prepare: (_url, signal) => {
        signal.throwIfAborted();
        return Promise.resolve(PREPARED);
      },
      now: () => Date.now(),
      sampleIntervalMs: 250,
      hold: HOLD,
      ...overrides
    })
  );
  return { probe: required(probe, '诊断的组合式函数'), fake, scope, container: document.createElement('div') };
}

describe('useTilesetProbe', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('真实的 CesiumScene 满足诊断用的窄接口', () => {
    expectTypeOf<CesiumScene>().toExtend<ProbeScene>();
  });

  it('自动序列：定到第一个姿态开始记录，每个姿态停够最短时间、误差稳定后换下一个，最后一个结束后自动停止并出报告', async () => {
    const { probe, fake, container } = setup();

    await probe.start(container, MODEL, 'sequence', { maximumScreenSpaceError: 24 });

    expect(probe.phase.value).toEqual({ kind: 'running' });
    expect(fake.setRendering).toHaveBeenCalledWith(true);
    expect(fake.addTileset.mock.calls[0]?.[2]).toEqual({ show: true, lighting: 'sun', maximumScreenSpaceError: 24 });
    expect(fake.jumps).toEqual([{ center: FIT.center, zoom: 15, bearing: 0, pitch: 0 }]);
    expect(probe.poseLabel.value).toBe('z15 俯视');

    await vi.advanceTimersByTimeAsync(5000);

    expect(probe.phase.value).toEqual({ kind: 'done' });
    expect(fake.jumps.map(({ zoom, pitch }) => [zoom, pitch])).toEqual([
      [15, 0],
      [15, 55],
      [16, 0],
      [16, 55],
      [16.5, 0],
      [16.5, 55],
      [17, 0],
      [17, 55],
      [18, 0],
      [18, 55]
    ]);
    expect(fake.dispose).toHaveBeenCalledTimes(1);
    expect(probe.elapsedS.value).toBe(5);
    expect(probe.sampleCount.value).toBe(21);

    const { json, markdown } = required(probe.report.value, '报告');
    // 每 250 毫秒一次采样：第一个姿态 0、250、500，之后每个姿态两次
    expect(json.session.samples.map(({ poseIndex }) => poseIndex)).toEqual([
      0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9
    ]);
    expect(json.poses.map(({ label, durationS }) => [label, durationS])).toEqual([
      ['z15 俯视', 0.5],
      ['z15 倾斜', 0.5],
      ['z16 俯视', 0.5],
      ['z16 倾斜', 0.5],
      ['z16.5 俯视', 0.5],
      ['z16.5 倾斜', 0.5],
      ['z17 俯视', 0.5],
      ['z17 倾斜', 0.5],
      ['z18 俯视', 0.5],
      ['z18 倾斜', 0.5]
    ]);
    // 累计计数按差值：第一个姿态从自己的第一次采样起算，其余从上一个姿态的最后一次采样起算，每个姿态都隔两次 inspect
    expect(json.poses.map(({ loaded }) => loaded)).toEqual(Array<number>(10).fill(2));
    expect(json.poses.map(({ unloaded }) => unloaded)).toEqual(Array<number>(10).fill(1));
    expect(json.poses.map(({ frames }) => frames)).toEqual(Array<number>(10).fill(4));
    expect(json.poses.map(({ ticks }) => ticks)).toEqual(Array<number>(10).fill(6));
    expect(json.poses.map(({ memoryEndMB }) => memoryEndMB)).toEqual([30, 50, 70, 90, 110, 130, 150, 170, 190, 210]);
    expect(json.poses.every(({ tilesLoadedEnd }) => tilesLoadedEnd)).toBe(true);
    expect(json.session.environment.renderer).toBe('NVIDIA GeForce RTX 3060');
    expect(json.session.environment.cacheBytes).toBe(1024 * MB);
    expect(json.session.environment.requestedScreenSpaceError).toBe(24);
    expect(markdown).toContain(
      '| z18 倾斜 | 0.5 | 4 / 6 | 210 / 210 | 16 / 16 / 16 | — | 2 / 1 / 0 | 30 | 0 + 0 | 是 | 0 / 0 | — / — / — | — | — px / — m | 0 | 0 |'
    );
  });

  it('瓦片一直没就绪时，每个姿态到上限才换', async () => {
    const { probe, container } = setup({}, { ...STEADY, tilesLoaded: false });
    await probe.start(container, MODEL, 'sequence', SETTINGS);

    await vi.advanceTimersByTimeAsync(20_000);

    expect(probe.phase.value).toEqual({ kind: 'done' });
    const { json } = required(probe.report.value, '报告');
    expect(json.poses.map(({ durationS }) => durationS)).toEqual(Array<number>(10).fill(2));
    expect(json.poses.every(({ tilesLoadedEnd }) => !tilesLoadedEnd)).toBe(true);
  });

  it('调整后误差还在变时不换姿态，稳定够久才换；行里记下误差的最小、最大和结束值', async () => {
    // 前 5 次 inspect 误差每次都变（17～21），之后停在 21
    const { probe, container } = setup({}, { ...STEADY, sse: calls => Math.min(16 + calls, 21) });
    await probe.start(container, MODEL, 'sequence', SETTINGS);

    await vi.advanceTimersByTimeAsync(1250);

    expect(probe.poseLabel.value).toBe('z15 倾斜');
    probe.stop();
    const { json } = required(probe.report.value, '报告');
    expect(json.poses.map(({ label, durationS, sseMin, sseMax, sseEnd }) => [label, durationS, sseMin, sseMax, sseEnd])).toEqual([
      ['z15 俯视', 1.3, 17, 21, 21],
      ['z15 倾斜', 0, 0, 0, 0]
    ]);
  });

  it('手动记录：定到整个模型后只采样、不换姿态，停止后报告是一行', async () => {
    const { probe, fake, container } = setup();
    await probe.start(container, MODEL, 'manual', SETTINGS);

    await vi.advanceTimersByTimeAsync(1000);
    expect(fake.jumps).toEqual([FIT]);
    expect(probe.phase.value).toEqual({ kind: 'running' });

    probe.stop();

    expect(probe.phase.value).toEqual({ kind: 'done' });
    expect(fake.dispose).toHaveBeenCalledTimes(1);
    const { json } = required(probe.report.value, '报告');
    expect(json.session.mode).toBe('manual');
    expect(json.session.samples.map(({ poseIndex }) => poseIndex)).toEqual([-1, -1, -1, -1, -1]);
    expect(json.poses.map(({ label, durationS, loaded }) => [label, durationS, loaded])).toEqual([['手动记录', 1, 4]]);
  });

  it('准备期间停止：中止加载、释放场景、撤掉 console 的捕获，不算失败，也不出报告', async () => {
    const warn = console.warn;
    const { probe, fake, container } = setup({
      prepare: (_url, signal) =>
        new Promise<PreparedTileset>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('已中止', 'AbortError')));
        })
    });

    const started = probe.start(container, MODEL, 'sequence', SETTINGS);
    await vi.advanceTimersByTimeAsync(0);
    expect(probe.phase.value).toEqual({ kind: 'starting' });
    expect(console.warn).not.toBe(warn);

    probe.stop();
    await started;

    expect(probe.phase.value).toEqual({ kind: 'idle' });
    expect(probe.report.value).toBeNull();
    expect(fake.dispose).toHaveBeenCalledTimes(1);
    expect(console.warn).toBe(warn);
  });

  it('索引下载失败时进入失败并释放场景，console 恢复', async () => {
    const warn = console.warn;
    const error = new Error('索引下载失败（404）');
    const { probe, fake, container } = setup({ prepare: () => Promise.reject(error) });

    await probe.start(container, MODEL, 'sequence', SETTINGS);

    expect(probe.phase.value).toEqual({ kind: 'failed', error });
    expect(fake.dispose).toHaveBeenCalledTimes(1);
    expect(console.warn).toBe(warn);
  });

  it('记录期间接住 console.warn 和瓦片加载失败，连续相同的只记一条并计数，原来的 console.warn 照常调用', async () => {
    const original = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { probe, fake, container } = setup();
    await probe.start(container, MODEL, 'sequence', SETTINGS);

    console.warn('瓦片慢', 3);
    console.warn('瓦片慢', 3);
    console.warn(new Error('贴图太大'));
    for (const callback of fake.failures) {
      callback(MODEL.id, new Error('瓦片集 jkq 的瓦片加载失败'));
    }
    await vi.advanceTimersByTimeAsync(250);
    probe.stop();

    expect(console.warn).toBe(original);
    expect(original).toHaveBeenCalledTimes(3);
    const { json, markdown } = required(probe.report.value, '报告');
    expect(json.session.events.map(({ kind, message, count }) => [kind, message, count])).toEqual([
      ['warn', '瓦片慢 3', 2],
      ['warn', '贴图太大', 1],
      ['tilesetfailed', 'jkq：瓦片集 jkq 的瓦片加载失败', 1]
    ]);
    expect(markdown).toContain('[console.warn] ×2：瓦片慢 3');
  });

  it('作用域销毁时停止记录、清掉定时器并释放场景', async () => {
    const { probe, fake, scope, container } = setup();
    await probe.start(container, MODEL, 'sequence', SETTINGS);
    await vi.advanceTimersByTimeAsync(250);

    scope.stop();

    expect(probe.phase.value).toEqual({ kind: 'done' });
    expect(fake.dispose).toHaveBeenCalledTimes(1);
    const samples = required(probe.report.value, '报告').json.session.samples.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(probe.report.value?.json.session.samples).toHaveLength(samples);
  });
});
