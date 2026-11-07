import type { SceneInspection } from '@mx/map-cesium';
import {
  type CameraState,
  type PreparedTileset,
  prepareTileset,
  type TilesetLighting,
  type Unsubscribe
} from '@mx/map-core';
import type { MapRuntimeLoader } from '@mx/map-vue';
import { onScopeDispose, ref, shallowRef } from 'vue';
import {
  buildProbeReport,
  type ProbeEnvironment,
  type ProbeEvent,
  type ProbeEventKind,
  type ProbeMode,
  type ProbeModel,
  type ProbePoseRecord,
  type ProbeReportFiles,
  type ProbeSample,
  type ProbeSession,
  summarizeInspection
} from './probe-report';
import { type ProbePose, probePoses } from './probe-sequence';

// 瓦片集加载诊断的全部逻辑：建场景、加瓦片集、按序列定位相机、每 250 毫秒读一次读数，停止时生成报告；不渲染

/** 诊断用到的场景能力：真实的是 CesiumScene，测试注入假场景 */
export interface ProbeScene extends Disposable {
  jumpTo(camera: CameraState): void;
  readCamera(): CameraState | null;
  addTileset(
    id: string,
    tileset: PreparedTileset,
    options: { readonly show: boolean; readonly lighting: TilesetLighting; readonly maximumScreenSpaceError: number },
    signal: AbortSignal
  ): Promise<CameraState>;
  inspect(): SceneInspection;
  setRendering(active: boolean): void;
  resize(): void;
  on(event: 'tilesetfailed', callback: (id: string, error: unknown) => void): Unsubscribe;
}

export type ProbePhase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'starting' }
  | { readonly kind: 'running' }
  | { readonly kind: 'stopping' }
  | { readonly kind: 'done' }
  | { readonly kind: 'failed'; readonly error: unknown };

/** 一次记录的设置：瓦片集的屏幕误差（像素，Cesium 默认 16） */
export interface ProbeSettings {
  readonly maximumScreenSpaceError: number;
}

/** 每个姿态停多久：至少 minMs；瓦片都就绪且调整后误差 stableMs 没变就换下一个；到 maxMs 强制换 */
export interface ProbeHold {
  readonly minMs: number;
  readonly maxMs: number;
  readonly stableMs: number;
}

export interface TilesetProbeOptions {
  /** app 通过 MAP_RUNTIME 提供的运行时加载；没有时一开始就失败 */
  readonly loadRuntime: MapRuntimeLoader | null;
  /** 建场景；默认加载运行时和 map-cesium 后创建真实场景，测试换成假场景 */
  readonly createScene?: (container: HTMLElement) => Promise<ProbeScene>;
  /** 读并整理索引；默认用 fetch 下载 */
  readonly prepare?: (url: string, signal: AbortSignal) => Promise<PreparedTileset>;
  readonly now?: () => number;
  readonly sampleIntervalMs?: number;
  readonly hold?: ProbeHold;
}

const DEFAULT_HOLD: ProbeHold = { minMs: 8_000, maxMs: 45_000, stableMs: 3_000 };
const SAMPLE_INTERVAL_MS = 250;
// 一条事件消息最多留这么多字符
const MESSAGE_LIMIT = 500;

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

// 记录中的会话：数组和姿态、事件可以改，交给报告时按只读的 ProbeSession 读
interface SessionDraft extends Omit<ProbeSession, 'poses' | 'samples' | 'events'> {
  readonly poses: Mutable<ProbePoseRecord>[];
  readonly samples: ProbeSample[];
  readonly events: Mutable<ProbeEvent>[];
}

interface Run {
  readonly controller: AbortController;
  readonly mode: ProbeMode;
  readonly model: ProbeModel;
  /** 开始的时刻（now 的读数），采样和事件的时间都相对它 */
  readonly originMs: number;
  readonly startedAt: string;
  readonly cleanups: (() => void)[];
  readonly events: Mutable<ProbeEvent>[];
  scene: ProbeScene | null;
  session: SessionDraft | null;
  timer: ReturnType<typeof setInterval> | null;
  poses: readonly ProbePose[];
  poseIndex: number;
  poseOpen: boolean;
  /** 调整后误差最后一次变化的时刻；lastSse 为 null 表示这个姿态还没采过样 */
  sseChangedAt: number;
  lastSse: number | null;
  longTasks: { count: number; maxMs: number };
}

async function loadJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`索引下载失败（${response.status}）：${url}`);
  }
  return response.json();
}

// 和 map-vue 的 createCesiumView 一样：运行时和 map-cesium 一起加载，都到了再建场景（基础地址要先设好）
async function createRealScene(container: HTMLElement, loadRuntime: MapRuntimeLoader): Promise<ProbeScene> {
  const [{ createCesiumScene }] = await Promise.all([import('@mx/map-cesium'), loadRuntime('3d')]);
  return createCesiumScene(container);
}

function describeValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof Error) {
    return value.message;
  }
  if (typeof value === 'object' && value !== null) {
    try {
      return JSON.stringify(value);
    } catch {
      return '[object]';
    }
  }
  return String(value);
}

function describeArgs(args: readonly unknown[]): string {
  return args.map(describeValue).join(' ').slice(0, MESSAGE_LIMIT);
}

// Chrome 独有的 performance.memory；其他浏览器没有
function heapBytes(): number | undefined {
  const { memory } = performance as Performance & { readonly memory?: { readonly usedJSHeapSize?: unknown } };
  const used = memory?.usedJSHeapSize;
  return typeof used === 'number' ? used : undefined;
}

// 长任务的观察；浏览器不支持时不观察
function observeLongTasks(onTask: (durationMs: number) => void): (() => void) | null {
  if (typeof PerformanceObserver !== 'function') {
    return null;
  }
  try {
    const observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        onTask(entry.duration);
      }
    });
    observer.observe({ entryTypes: ['longtask'] });
    return () => observer.disconnect();
  } catch {
    return null;
  }
}

function environmentOf(inspection: SceneInspection, settings: ProbeSettings): ProbeEnvironment {
  const tileset = inspection.tilesets.at(0);
  return {
    requestedScreenSpaceError: settings.maximumScreenSpaceError,
    userAgent: navigator.userAgent,
    renderer: inspection.renderer,
    devicePixelRatio: inspection.devicePixelRatio,
    drawingBuffer: { width: inspection.drawingBufferWidth, height: inspection.drawingBufferHeight },
    screen: { width: window.screen.width, height: window.screen.height },
    window: { width: window.innerWidth, height: window.innerHeight },
    cacheBytes: tileset?.cacheBytes ?? null,
    maximumCacheOverflowBytes: tileset?.maximumCacheOverflowBytes ?? null,
    maximumScreenSpaceError: tileset?.maximumScreenSpaceError ?? null
  };
}

/** 瓦片集加载诊断：start 建场景、加瓦片集并开始记录，stop 收尾并生成报告；作用域销毁时停止 */
export function useTilesetProbe(options: TilesetProbeOptions) {
  const {
    loadRuntime,
    createScene = container =>
      loadRuntime
        ? createRealScene(container, loadRuntime)
        : Promise.reject(new Error('没有地图运行时：这一页要用 withMapRuntime 注册')),
    prepare = (url, signal) => prepareTileset(url, loadJson, signal),
    now = () => performance.now(),
    sampleIntervalMs = SAMPLE_INTERVAL_MS,
    hold = DEFAULT_HOLD
  } = options;

  const phase = shallowRef<ProbePhase>({ kind: 'idle' });
  const poseLabel = ref('');
  const elapsedS = ref(0);
  const sampleCount = ref(0);
  const latest = shallowRef<SceneInspection | null>(null);
  const report = shallowRef<ProbeReportFiles | null>(null);
  let current: Run | null = null;

  // 连续相同的事件只记一条、累计次数
  const record = (run: Run, kind: ProbeEventKind, message: string) => {
    const last = run.events.at(-1);
    if (last && last.kind === kind && last.message === message) {
      last.count++;
      return;
    }
    run.events.push({ atMs: now() - run.originMs, kind, message, count: 1 });
  };

  // 接住记录期间的告警、错误、上下文丢失、瓦片加载失败和长任务；stop 时按登记的顺序倒着撤掉
  const capture = (run: Run, container: HTMLElement, scene: ProbeScene) => {
    const original = { warn: console.warn, error: console.error };
    console.warn = (...args: unknown[]) => {
      record(run, 'warn', describeArgs(args));
      original.warn(...args);
    };
    console.error = (...args: unknown[]) => {
      record(run, 'error', describeArgs(args));
      original.error(...args);
    };
    run.cleanups.push(() => {
      console.warn = original.warn;
      console.error = original.error;
    });
    const canvas = container.querySelector('canvas');
    if (canvas) {
      const onLost = () => record(run, 'contextlost', 'webglcontextlost');
      canvas.addEventListener('webglcontextlost', onLost);
      run.cleanups.push(() => canvas.removeEventListener('webglcontextlost', onLost));
    }
    run.cleanups.push(scene.on('tilesetfailed', (id, error) => record(run, 'tilesetfailed', `${id}：${describeValue(error)}`)));
    const stopObserving = observeLongTasks(durationMs => {
      run.longTasks = { count: run.longTasks.count + 1, maxMs: Math.max(run.longTasks.maxMs, durationMs) };
    });
    if (stopObserving) {
      run.cleanups.push(stopObserving);
    }
  };

  // 收尾不抛错：一步出错不影响后面的释放
  const teardown = (run: Run) => {
    if (run.timer !== null) {
      clearInterval(run.timer);
      run.timer = null;
    }
    const { scene } = run;
    run.scene = null;
    const steps = [...run.cleanups.splice(0).toReversed(), () => scene?.[Symbol.dispose]()];
    for (const step of steps) {
      try {
        step();
      } catch (error) {
        console.error('瓦片集诊断收尾出错', error);
      }
    }
  };

  const finishPose = (run: Run, session: SessionDraft, atMs: number) => {
    const pose = session.poses.at(-1);
    if (pose && run.poseOpen) {
      pose.endedMs = atMs;
      run.poseOpen = false;
    }
  };

  const stop = (): void => {
    const run = current;
    if (!run) {
      return;
    }
    current = null;
    phase.value = { kind: 'stopping' };
    run.controller.abort();
    const { session } = run;
    if (session) {
      finishPose(run, session, now() - run.originMs);
    }
    teardown(run);
    if (session) {
      report.value = buildProbeReport(session);
      phase.value = { kind: 'done' };
    } else {
      phase.value = { kind: 'idle' };
    }
  };

  const beginPose = (run: Run, scene: ProbeScene, session: SessionDraft, pose: ProbePose, atMs: number) => {
    scene.jumpTo(pose.camera);
    session.poses.push({ label: pose.label, camera: pose.camera, startedMs: atMs, endedMs: atMs });
    run.poseOpen = true;
    run.lastSse = null;
    run.sseChangedAt = atMs;
    poseLabel.value = pose.label;
  };

  // 每次采样后判断当前姿态能不能换：停够 minMs，且瓦片都就绪、调整后误差 stableMs 没变；到 maxMs 强制换；最后一个结束就停止
  const advanceSequence = (run: Run, scene: ProbeScene, session: SessionDraft, sample: ProbeSample) => {
    const pose = session.poses.at(-1);
    if (!pose || !run.poseOpen) {
      return;
    }
    const totals = summarizeInspection(sample.inspection);
    if (run.lastSse === null || totals.sse !== run.lastSse) {
      run.lastSse = totals.sse;
      run.sseChangedAt = sample.atMs;
    }
    const inPose = sample.atMs - pose.startedMs;
    const stable = totals.tilesLoaded && sample.atMs - run.sseChangedAt >= hold.stableMs;
    if (inPose < hold.minMs || (!stable && inPose < hold.maxMs)) {
      return;
    }
    finishPose(run, session, sample.atMs);
    const next = run.poses.at(run.poseIndex + 1);
    if (!next) {
      stop();
      return;
    }
    run.poseIndex++;
    beginPose(run, scene, session, next, sample.atMs);
  };

  const takeSample = (run: Run, scene: ProbeScene, session: SessionDraft, inspection: SceneInspection) => {
    const atMs = now() - run.originMs;
    const heap = heapBytes();
    const sample: ProbeSample = {
      atMs,
      poseIndex: run.mode === 'sequence' ? run.poseIndex : -1,
      camera: scene.readCamera(),
      inspection,
      ...(heap === undefined ? {} : { heapBytes: heap }),
      longTasks: run.longTasks
    };
    run.longTasks = { count: 0, maxMs: 0 };
    session.samples.push(sample);
    latest.value = inspection;
    elapsedS.value = atMs / 1000;
    sampleCount.value = session.samples.length;
    if (run.mode === 'sequence') {
      advanceSequence(run, scene, session, sample);
    }
  };

  /** 在容器里建场景、加载模型并开始记录；进行中时不重复开始。被 stop 中止的加载不算失败 */
  const start = async (
    container: HTMLElement,
    model: ProbeModel,
    mode: ProbeMode,
    settings: ProbeSettings
  ): Promise<void> => {
    if (current) {
      return;
    }
    const run: Run = {
      controller: new AbortController(),
      mode,
      model,
      originMs: now(),
      startedAt: new Date().toISOString(),
      cleanups: [],
      events: [],
      scene: null,
      session: null,
      timer: null,
      poses: [],
      poseIndex: 0,
      poseOpen: false,
      sseChangedAt: 0,
      lastSse: null,
      longTasks: { count: 0, maxMs: 0 }
    };
    current = run;
    phase.value = { kind: 'starting' };
    report.value = null;
    latest.value = null;
    poseLabel.value = '';
    elapsedS.value = 0;
    sampleCount.value = 0;
    const { signal } = run.controller;
    try {
      const scene = await createScene(container);
      if (signal.aborted) {
        scene[Symbol.dispose]();
        return;
      }
      run.scene = scene;
      scene.setRendering(true);
      scene.resize();
      capture(run, container, scene);
      const prepared = await prepare(model.url, signal);
      signal.throwIfAborted();
      const fit = await scene.addTileset(
        model.id,
        prepared,
        { show: true, lighting: 'sun', maximumScreenSpaceError: settings.maximumScreenSpaceError },
        signal
      );
      signal.throwIfAborted();
      const first = scene.inspect();
      const session: SessionDraft = {
        startedAt: run.startedAt,
        mode,
        model,
        environment: environmentOf(first, settings),
        poses: [],
        samples: [],
        events: run.events
      };
      run.session = session;
      const atMs = now() - run.originMs;
      if (mode === 'sequence') {
        run.poses = probePoses(fit.center);
        const firstPose = run.poses.at(0);
        if (firstPose) {
          beginPose(run, scene, session, firstPose, atMs);
        }
      } else {
        // 手动记录先让整个模型进入画布，用户从这里开始操作
        scene.jumpTo(fit);
      }
      phase.value = { kind: 'running' };
      takeSample(run, scene, session, first);
      // 第一次采样就可能结束序列（停留时间为 0 时）
      if (current !== run) {
        return;
      }
      run.timer = setInterval(() => takeSample(run, scene, session, scene.inspect()), sampleIntervalMs);
    } catch (error) {
      // stop 中止的：它已经收尾
      if (signal.aborted) {
        return;
      }
      teardown(run);
      current = null;
      phase.value = { kind: 'failed', error };
    }
  };

  onScopeDispose(stop);

  return { phase, poseLabel, elapsedS, sampleCount, latest, report, start, stop };
}
