import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CDPSession, Page } from 'playwright';
import type {
  BenchCamera,
  BenchStats,
  ContextEvents,
  ModelState,
  SceneSample,
  LongTaskStats,
  LongTaskWindow,
  PageSetup,
  PhaseResult,
  ShotCoverage,
  StableResult
} from './bench-api.ts';
import { type BrowserProcesses, browserProcesses, launchBrowser, type LaunchedBrowser, type MemorySample, sampleMemory } from './browser.ts';
import type { Options } from './options.ts';
import { type CpuProfile, summarizeProfile } from './profile.ts';
import type { ProxyStats } from './server.ts';
import type { QualityResult, RunResult, SettleResult } from './results.ts';
import { runNotes } from './run-notes.ts';
import { aerialFlight, type Run } from './scenes.ts';
import type { SplatModel } from './splat-models.ts';
import { blurEvents, type SharpnessGrid } from './sharpness.ts';

// 跑一遍：每遍一个新的浏览器进程和空缓存，显存、堆、磁盘缓存都从零开始

const NORMAL = { warmupMs: 1000, staticMs: 6000, flightMs: 15000, settleMs: 20000, afterSettleMs: 3000, basemapMs: 10000, memoryEveryMs: 5000, holdSeconds: 30, holdEveryMs: 1000 };
const QUICK = { warmupMs: 300, staticMs: 2000, flightMs: 4000, settleMs: 8000, afterSettleMs: 1000, basemapMs: 3000, memoryEveryMs: 5000, holdSeconds: 4, holdEveryMs: 1000 };

// 模型覆盖的像素比例低于这个值，就算模型没有画出来
const MIN_MODEL_COVERAGE_PCT = 0.2;
const GL_ERROR = /GL_INVALID|GL_OUT_OF_MEMORY|CONTEXT_LOST|too many errors/i;
const STABLE_STREAK = 5;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// 浏览器里的代码用字符串调用：这边的 tsconfig 没有 DOM，页面一侧的类型在 page/ 里
const call = <T>(page: Page, expression: string) => page.evaluate<T>(expression);

export interface RunContext {
  readonly options: Options;
  /** 场景里的泼溅：清单里读到的地址和摆放（cli 启动时按 ID 取好） */
  readonly splats: ReadonlyMap<string, SplatModel>;
  readonly baseUrl: string;
  readonly outDir: string;
  readonly redact: (text: string) => string;
  readonly progress: (phase: string) => void;
  /** 代理累计的超时、失败次数（server.ts）；没有代理时为 null */
  readonly proxyStats: () => ProxyStats | null;
}

/** 测量页的地址：场景的相机、模型和方案的参数（--look 也用它） */
export function pageUrl({ scene, variant }: Pick<Run, 'scene' | 'variant'>, { baseUrl, options, splats }: Pick<RunContext, 'baseUrl' | 'options' | 'splats'>): string {
  const { center, zoom, pitch, bearing } = scene.camera;
  const params = new URLSearchParams({
    models: scene.models.map(model => model.path).join(','),
    splats: JSON.stringify(
      scene.splats.map(id => {
        const model = splats.get(id);
        if (!model) {
          throw new Error(`清单里没有取到泼溅 ${id}`);
        }
        return model;
      })
    ),
    basemap: options.basemap,
    pacing: String(options.pacing),
    zoom: String(zoom),
    pitch: String(pitch),
    bearing: String(bearing)
  });
  if (center) {
    params.set('center', center.join(','));
  }
  if (variant.uploadMB !== undefined) {
    params.set('uploadMB', variant.uploadMB === null ? 'off' : String(variant.uploadMB));
  }
  if (variant.cullWindow !== undefined) {
    params.set('cullWindow', variant.cullWindow === null ? 'off' : String(variant.cullWindow));
  }
  if (variant.splatBudget !== undefined) {
    params.set('splatBudget', String(variant.splatBudget));
  }
  if (variant.cacheGB !== undefined) {
    params.set('cacheGB', String(variant.cacheGB));
  }
  if (variant.releaseImages) {
    params.set('releaseImages', '1');
  }
  if (options.fps !== null) {
    params.set('fps', String(options.fps));
  }
  if (options.antialias) {
    params.set('antialias', '1');
  }
  return `${baseUrl}/index.html?${params.toString()}`;
}

const fileName = (id: string) => id.replaceAll(/[\\/]/g, '__');

// 模型没画出来的场景，帧率再高也没有意义；缓存满了以后队列也是空的，"到稳定"不能直接比
function classify(result: RunResult): void {
  result.notes.push(...runNotes(result));
  const invalid: string[] = [];
  if (result.image?.blank) {
    invalid.push('画面空白');
  } else if (result.image && result.image.modelCoveragePct < MIN_MODEL_COVERAGE_PCT) {
    invalid.push(`模型没有画出来（隐藏前后只差 ${result.image.modelCoveragePct.toFixed(2)}% 的像素）`);
  }
  const refused = result.atStable?.refused ?? 0;
  if (refused > 0) {
    result.notes.push(`到稳定时还有 ${refused} 块瓦片因为缓存满了没有加载`);
  }
  if ((result.flightCold?.fenceTimeouts ?? 0) > 0) {
    result.notes.push('有等 GPU 超过 15 秒的帧，帧时间可能失真');
  }
  result.notes.push(...invalid);
  if (result.status !== 'failed') {
    if (invalid.length > 0) {
      result.status = 'invalid';
    } else if (result.load && !result.load.stable) {
      result.status = 'timeout';
    }
  }
}

interface Session {
  readonly page: Page;
  readonly cdp: CDPSession;
  readonly launched: LaunchedBrowser;
  readonly processes: BrowserProcesses;
}

async function open(result: RunResult, { options, redact }: RunContext): Promise<Session> {
  const launched = await launchBrowser(options);
  const context = await launched.browser.newContext({ viewport: options.viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  // 渲染进程在打开页面以后才有
  const processes = await browserProcesses(launched.browser);
  const pageErrors: string[] = [];
  let glErrors = 0;
  page.on('pageerror', error => {
    if (pageErrors.length < 10) {
      pageErrors.push(redact(error.message).slice(0, 400));
    }
    result.pageErrors = pageErrors;
  });
  page.on('console', message => {
    if (GL_ERROR.test(message.text())) {
      glErrors++;
      result.glErrors = glErrors;
    }
  });
  const cdp = await context.newCDPSession(page);
  return { page, cdp, launched, processes };
}

async function loadPage(run: Run, ctx: RunContext, { page }: Session, result: RunResult): Promise<StableResult> {
  await page.goto(pageUrl(run, ctx), { waitUntil: 'commit', timeout: 60000 });
  const { loadTimeoutMs } = ctx.options;
  try {
    await page.waitForFunction('window.benchReady === true', null, { polling: 250, timeout: loadTimeoutMs });
  } catch (error) {
    throw new Error(`页面没有就绪：${result.pageErrors?.[0] ?? String(error).split('\n')[0]}`, { cause: error });
  }
  result.setup = await call<PageSetup & { config: Record<string, unknown> }>(
    page,
    '({ ...window.benchProbe.attach(), config: window.bench.config })'
  );
  const stable = await waitStable(page, loadTimeoutMs);
  const loadStartedAt = await call<number>(page, 'window.bench.loadStartedAt');
  result.load = {
    stable: stable.stable,
    ttStableMs: stable.at - loadStartedAt,
    ttFromNavigationMs: stable.at,
    longTasks: await longTasks(page, 0, stable.at)
  };
  if (!stable.stable) {
    result.notes.push(`等了 ${Math.round(loadTimeoutMs / 1000)} 秒模型还没稳定`);
  }
  result.models = await call<Record<string, ModelState>>(page, 'window.bench.models()');
  result.atStable = await stats(page);
  return stable;
}

const waitStable = (page: Page, timeoutMs: number) =>
  call<StableResult>(page, `window.benchProbe.waitStable(${timeoutMs}, ${STABLE_STREAK})`);
// 飞行结束以后等到稳定：先画几帧，引擎才知道相机停了（动着的时候有的瓦片不请求，这时看起来什么都不缺）。
// 从飞行结束的时刻算（from）：统计飞行的结果还要等一会儿，等的这段也是用户看到的。稳定后再看 watchMs，看画面还变不变
async function waitSettled(page: Page, from: number, timeoutMs: number, watchMs: number): Promise<SettleResult> {
  await call(page, 'window.benchProbe.waitFrames(5)');
  const { stable, at } = await waitStable(page, timeoutMs);
  const trace = await call<SceneSample[]>(page, `window.benchProbe.finishFillTrace(${watchMs})`);
  return { stable, ms: at - from, longTasks: await longTasks(page, from, at), trace };
}

const longTasks = (page: Page, from: number, to: number) => call<LongTaskStats>(page, `window.benchProbe.longTasks(${from}, ${to + 1})`);
const stats = (page: Page) => call<BenchStats>(page, 'window.bench.stats()');
const flight = (page: Page, keyframes: readonly BenchCamera[], ms: number) =>
  call<PhaseResult>(page, `window.benchProbe.flight(${JSON.stringify(keyframes)}, ${ms})`);

// 飞行的路径：各个方案要相同，所以按场景的相机算；模型只在服务器上时中心是建议相机给的，只能读回来
async function flightPath(page: Page, { scene }: Run, options: Options): Promise<BenchCamera[]> {
  const { center } = scene.camera;
  const camera = center ? { ...scene.camera, center } : await call<BenchCamera>(page, 'window.bench.camera()');
  return aerialFlight(camera, options.viewport.height);
}

async function setModelVisible(page: Page, visible: boolean): Promise<void> {
  await call(page, `window.bench.setModelVisible(${visible})`);
  await call(page, 'window.benchProbe.waitFrames(3)');
  await sleep(300);
}

const screenshot = (page: Page, type: 'png' | 'jpeg' = 'png') =>
  page.screenshot({ timeout: 120000, animations: 'allow', type, ...(type === 'jpeg' ? { quality: 85 } : {}) });

// 采样的最大值；这次没读到时不变
const peak = (current: number | null, value: number | null) => (value === null ? current : Math.max(current ?? 0, value));

async function runPerf(run: Run, ctx: RunContext, session: Session, result: RunResult): Promise<void> {
  const times = ctx.options.quick ? QUICK : NORMAL;
  const { page, cdp, processes } = session;
  await cdp.send('Performance.enable');
  let peakGpu: number | null = null;
  let peakShared: number | null = null;
  let gpuUnavailable: string | null = null;
  let heapPeak: number | null = null;
  let rendererPeak: number | null = null;
  let gpuProcessPeak: number | null = null;
  const read = async (): Promise<MemorySample> => {
    const metrics = await cdp.send('Performance.getMetrics').catch(() => null);
    const heap = metrics?.metrics.find(item => item.name === 'JSHeapUsedSize')?.value;
    if (heap !== undefined) {
      heapPeak = Math.max(heapPeak ?? 0, heap / 1048576);
    }
    const memory = await sampleMemory(processes);
    rendererPeak = peak(rendererPeak, memory.rendererPrivateMB);
    gpuProcessPeak = peak(gpuProcessPeak, memory.gpuProcessPrivateMB);
    if ('unavailable' in memory.gpu) {
      gpuUnavailable = memory.gpu.unavailable;
    } else {
      peakGpu = Math.max(peakGpu ?? 0, memory.gpu.dedicatedMB);
      peakShared = Math.max(peakShared ?? 0, memory.gpu.sharedMB);
    }
    return memory;
  };
  // 同一时间只读一次：定时的那次还没读完就跳过；fresh 时等它读完再读一次（稳定时的读数要在稳定以后）
  let inflight: Promise<MemorySample> | null = null;
  const sample = async (fresh = false): Promise<MemorySample | null> => {
    if (inflight && !fresh) {
      return null;
    }
    await inflight?.catch(() => undefined);
    inflight = read();
    try {
      return await inflight;
    } finally {
      inflight = null;
    }
  };
  ctx.progress('加载');
  const sampler = setInterval(() => void sample(), times.memoryEveryMs);
  try {
    await loadPage(run, ctx, session, result);
  } finally {
    clearInterval(sampler);
  }
  const atStable = await sample(true);
  await call(page, `window.benchProbe.waitBasemap(${times.basemapMs})`);

  ctx.progress('静止帧');
  await call(page, 'window.bench.setContinuous(true)');
  await sleep(times.warmupMs);
  result.static = await call<PhaseResult>(page, `window.benchProbe.record(${times.staticMs})`);
  await call(page, 'window.bench.setContinuous(false)');

  ctx.progress('截图');
  const shown = (await screenshot(page)).toString('base64');
  await setModelVisible(page, false);
  const hidden = (await screenshot(page)).toString('base64');
  await setModelVisible(page, true);
  result.image = await call<ShotCoverage>(page, `window.benchProbe.analyzeShots(${JSON.stringify(shown)}, ${JSON.stringify(hidden)})`);
  // 隐藏再显示以后等一下，飞行从稳定的状态开始
  await waitStable(page, times.settleMs);

  const keyframes = await flightPath(page, run, ctx.options);
  ctx.progress('飞行（第一遍）');
  result.flightCold = await flight(page, keyframes, times.flightMs);
  ctx.progress('等瓦片补齐');
  result.settle = await waitSettled(page, result.flightCold.endedAt, times.settleMs, times.afterSettleMs);
  await sample();
  ctx.progress('飞行（第二遍）');
  result.flightWarm = await flight(page, keyframes, times.flightMs);
  ctx.progress('等画面恢复');
  result.recovery = await waitSettled(page, result.flightWarm.endedAt, times.settleMs, times.afterSettleMs);
  result.atRecovered = await stats(page);
  await sample();
  result.memory = {
    heapPeakMB: heapPeak,
    gpuAtStableMB: atStable && 'dedicatedMB' in atStable.gpu ? atStable.gpu.dedicatedMB : null,
    gpuPeakMB: peakGpu,
    gpuSharedPeakMB: peakShared,
    gpuUnavailable,
    rendererAtStableMB: atStable?.rendererPrivateMB ?? null,
    rendererPeakMB: rendererPeak,
    gpuProcessPeakMB: gpuProcessPeak
  };
}

async function runQuality(run: Run, ctx: RunContext, session: Session, result: RunResult): Promise<void> {
  const times = ctx.options.quick ? QUICK : NORMAL;
  const { page } = session;
  const name = fileName(run.id);
  const save = async (suffix: string): Promise<{ file: string; base64: string }> => {
    const data = await screenshot(page);
    const file = `shots/${name}${suffix}.png`;
    writeFileSync(join(ctx.outDir, file), data);
    return { file, base64: data.toString('base64') };
  };
  ctx.progress('加载');
  await loadPage(run, ctx, session, result);
  await call(page, `window.benchProbe.waitBasemap(${times.basemapMs})`);
  await sleep(times.warmupMs);

  // 静止观察：瓦片不该再加载、卸载，画面也不该变糊。截图时不量帧时间，所以和 perf 分开跑
  ctx.progress(`静止观察 ${times.holdSeconds} 秒`);
  const before = await stats(page);
  const grids: SharpnessGrid[] = [];
  for (let second = 0; second < times.holdSeconds; second++) {
    const startedAt = Date.now();
    // oxlint-disable-next-line no-await-in-loop -- 一秒一张
    const shot = (await screenshot(page)).toString('base64');
    // oxlint-disable-next-line no-await-in-loop -- 一秒一张
    grids.push(await call<SharpnessGrid>(page, `window.bench.sharpnessOf(${JSON.stringify(shot)})`));
    // oxlint-disable-next-line no-await-in-loop -- 一秒一张
    await sleep(Math.max(0, times.holdEveryMs - (Date.now() - startedAt)));
  }
  const after = await stats(page);

  ctx.progress('截图');
  const shot = await save('');
  await setModelVisible(page, false);
  const hidden = await save('-no-model');
  await setModelVisible(page, true);
  await waitStable(page, times.settleMs);
  result.image = await call<ShotCoverage>(page, `window.benchProbe.analyzeShots(${JSON.stringify(shot.base64)}, ${JSON.stringify(hidden.base64)})`);

  ctx.progress('飞一圈回来再拍');
  await flight(page, await flightPath(page, run, ctx.options), times.flightMs);
  const settled = await waitStable(page, times.settleMs);
  await call(page, 'window.benchProbe.finishFillTrace(0)');
  const end = settled.stable ? await save('-after-flight') : null;
  const quality: QualityResult = {
    shot: shot.file,
    shotWithoutModel: hidden.file,
    shotAfterFlight: end?.file ?? null,
    hold: {
      seconds: times.holdSeconds,
      loaded: after.loaded - before.loaded,
      unloaded: after.unloaded - before.unloaded,
      blurEvents: blurEvents(grids)
    }
  };
  result.quality = quality;
}

async function runProfile(run: Run, ctx: RunContext, session: Session, result: RunResult): Promise<void> {
  const times = ctx.options.quick ? QUICK : NORMAL;
  const { page, cdp } = session;
  const name = fileName(run.id);
  const stop = async (suffix: string) => {
    const endedAt = await call<number>(page, 'window.benchProbe.now()');
    const { profile } = (await cdp.send('Profiler.stop')) as unknown as { profile: CpuProfile };
    writeFileSync(join(ctx.outDir, `profiles/${name}-${suffix}.cpuprofile`), ctx.redact(JSON.stringify(profile)));
    // longtask 的回调要到下一个任务才来
    await sleep(150);
    return summarizeProfile(profile, await call<LongTaskWindow[]>(page, 'window.benchProbe.longTaskWindows()'), endedAt);
  };
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
  ctx.progress('加载（CPU 采样）');
  await cdp.send('Profiler.start');
  await loadPage(run, ctx, session, result);
  const load = await stop('load');
  await call(page, `window.benchProbe.waitBasemap(${times.basemapMs})`);
  ctx.progress('飞行（CPU 采样）');
  await cdp.send('Profiler.start');
  await flight(page, await flightPath(page, run, ctx.options), times.flightMs);
  await call(page, 'window.benchProbe.finishFillTrace(0)');
  const flying = await stop('flight');
  result.profile = { load, flight: flying };
}

/** 结果对象随时可以写盘：出错时已经测到的部分还在 */
export async function runOnce(run: Run, ctx: RunContext): Promise<RunResult> {
  const result: RunResult = {
    id: run.id,
    scene: run.scene.id,
    variant: run.variant.id,
    kind: run.kind,
    repeat: run.repeat,
    status: 'ok',
    notes: []
  };
  const startedAt = Date.now();
  const proxyBefore = ctx.proxyStats();
  let session: Session | null = null;
  try {
    session = await open(result, ctx);
    const opened = session;
    const body = run.kind === 'perf' ? runPerf : run.kind === 'quality' ? runQuality : runProfile;
    await Promise.race([
      body(run, ctx, opened, result),
      new Promise<never>((_, reject) => {
        opened.page.on('crash', () => reject(new Error('页面崩溃（可能是显存或内存不够）')));
        opened.launched.browser.on('disconnected', () => reject(new Error('浏览器进程退出了')));
      }),
      new Promise<never>((_, reject) => {
        const limit = ctx.options.loadTimeoutMs + 300000;
        setTimeout(() => reject(new Error('单遍超过时间上限，已中止')), limit).unref();
      })
    ]);
    result.context = await call<ContextEvents>(opened.page, 'window.benchProbe.contextEvents()');
    result.pageErrors = [...(result.pageErrors ?? []), ...(await call<string[]>(opened.page, 'window.bench.errors.slice(0, 20)')).map(item => ctx.redact(item).slice(0, 300))];
  } catch (error) {
    result.status = 'failed';
    result.error = ctx.redact(String(error instanceof Error ? error.message : error)).split('\n')[0]?.slice(0, 500);
  } finally {
    if (session) {
      session.launched.browser.removeAllListeners('disconnected');
      await Promise.race([session.launched.browser.close().catch(() => undefined), sleep(15000)]);
    }
  }
  result.durationS = (Date.now() - startedAt) / 1000;
  const proxyAfter = ctx.proxyStats();
  if (proxyBefore && proxyAfter) {
    result.proxy = { timeouts: proxyAfter.timeouts - proxyBefore.timeouts, failures: proxyAfter.failures - proxyBefore.failures };
  }
  classify(result);
  return result;
}
