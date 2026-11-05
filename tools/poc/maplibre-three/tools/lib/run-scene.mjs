// 跑一个场景：每次一个新浏览器进程和空缓存，显存、堆、磁盘缓存都从零开始
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gpuProcessId, launchBrowser, sampleGpuMemory } from './browser.mjs';
import { redact } from './redact.mjs';

const PROBE_SOURCE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'probe.js'), 'utf8');

const NORMAL = { warmupMs: 1000, staticMs: 6000, flightMs: 15000, settleMs: 20000, basemapMs: 10000, glWatchMs: 5000, memoryEveryMs: 5000 };
const QUICK = { warmupMs: 300, staticMs: 2000, flightMs: 4000, settleMs: 5000, basemapMs: 3000, glWatchMs: 1500, memoryEveryMs: 5000 };

// 模型覆盖的像素比例低于这个值，就算模型没有画出来
const MIN_MODEL_COVERAGE_PCT = 0.2;
const GL_ERROR = /GL_INVALID|GL_OUT_OF_MEMORY|CONTEXT_LOST|too many errors/i;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function shotName(run, repeat) {
  const base = run.id.replace(/[\\/]/g, '__');
  return repeat > 0 ? `${base}-r${repeat + 1}` : base;
}

function rejectAfter(ms, message) {
  let timer;
  const promise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return { promise, cancel: () => clearTimeout(timer) };
}

/** 结果对象随时可以写盘：出错时已经测到的部分还在 */
export async function runScene(run, repeat, { options, baseUrl, screenshotsDir, progress }) {
  const times = options.quick ? QUICK : NORMAL;
  const result = {
    id: run.id,
    scene: run.scene.id,
    variant: run.variant.id,
    repeat,
    startedAt: new Date().toISOString(),
    status: 'ok',
    notes: [],
    memory: { heap: {}, gpu: {} },
    log: { glErrors: 0, glSamples: [], consoleErrors: 0, consoleSamples: [], pageErrors: [] }
  };
  const { log, memory } = result;
  const startedAtMs = Date.now();
  let launched = null;
  let samplerTimer = null;
  const guard = rejectAfter(run.loadTimeoutMs + 300000, '单个场景超过时间上限，已中止');
  let crash;
  const crashed = new Promise((_, reject) => {
    crash = reject;
  });

  const body = async () => {
    launched = await launchBrowser(options);
    const { browser } = launched;
    browser.on('disconnected', () => crash(new Error('浏览器进程退出了')));
    result.browser = { kind: launched.kind, version: browser.version() };
    const gpuPid = await gpuProcessId(browser);
    const context = await browser.newContext({ viewport: options.viewport, deviceScaleFactor: options.dpr });
    await context.addInitScript({ content: PROBE_SOURCE });
    const page = await context.newPage();
    page.on('crash', () => crash(new Error('页面崩溃（可能是显存或内存不够）')));
    page.on('pageerror', error => {
      if (log.pageErrors.length < 10) {
        log.pageErrors.push(redact(error.message).slice(0, 400));
      }
    });
    page.on('console', message => {
      const text = message.text();
      if (GL_ERROR.test(text)) {
        log.glErrors += 1;
        if (log.glSamples.length < 5) {
          log.glSamples.push(redact(text).slice(0, 200));
        }
      } else if (message.type() === 'error') {
        log.consoleErrors += 1;
        if (log.consoleSamples.length < 5) {
          log.consoleSamples.push(redact(text).slice(0, 200));
        }
      }
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');

    const readMetrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(item => [item.name, item.value]));

    let memoryBusy = false;
    const sampleMemory = async label => {
      if (memoryBusy) {
        return;
      }
      memoryBusy = true;
      try {
        const metrics = await readMetrics().catch(() => null);
        if (metrics) {
          const heapMB = metrics.JSHeapUsedSize / 1048576;
          memory.heap.peakMB = Math.max(memory.heap.peakMB ?? 0, heapMB);
          if (label) {
            memory.heap[label] = heapMB;
          }
        }
        const gpu = await sampleGpuMemory(gpuPid);
        if (gpu.unavailable) {
          memory.gpu.unavailable = gpu.unavailable;
        } else {
          memory.gpu.source = gpu.source;
          memory.gpu.peakMB = Math.max(memory.gpu.peakMB ?? 0, gpu.dedicatedMB);
          if (label) {
            memory.gpu[label] = gpu.dedicatedMB;
            memory.gpu[`${label}SharedMB`] = gpu.sharedMB;
          }
        }
      } finally {
        memoryBusy = false;
      }
    };

    // ---------- 加载 ----------
    progress('加载');
    samplerTimer = setInterval(() => void sampleMemory(null), times.memoryEveryMs);
    await page.goto(baseUrl + run.path, { waitUntil: 'commit', timeout: 60000 });
    try {
      await page.waitForFunction('window.benchReady === true', null, { polling: 250, timeout: run.loadTimeoutMs });
    } catch (error) {
      throw new Error(`页面没有就绪：${log.pageErrors[0] ?? error.message.split('\n')[0]}`);
    }
    result.setup = await page.evaluate(() => ({ ...window.__probe.attach(), engine: window.bench.engine, config: window.bench.config }));
    const stable = await page.evaluate(
      ({ timeoutMs, streak }) => window.__probe.waitStable(timeoutMs, streak),
      { timeoutMs: run.loadTimeoutMs, streak: run.stableStreak ?? 5 }
    );
    clearInterval(samplerTimer);
    samplerTimer = null;
    const loadStartedAt = await page.evaluate(() => window.bench.loadStartedAt);
    result.load = {
      stable: stable.stable,
      ttStableMs: stable.at - loadStartedAt,
      ttFromNavigationMs: stable.at,
      longTasks: await page.evaluate(to => window.__probe.longTasks(0, to + 1), stable.at)
    };
    if (!stable.stable) {
      result.notes.push(`等了 ${Math.round(run.loadTimeoutMs / 1000)} 秒模型还没稳定，后面的数字是没加载完的状态`);
    }
    result.engineAtStable = await page.evaluate(() => window.bench.stats());
    await sampleMemory('atStable');

    result.basemap = await page.evaluate(timeoutMs => window.__probe.waitBasemap(timeoutMs), times.basemapMs);

    // ---------- 静止：每帧都重画，帧时间就是完整一帧的成本 ----------
    progress('静止帧');
    await page.evaluate(() => window.bench.setContinuous(true));
    await sleep(times.warmupMs);
    result.static = await page.evaluate(ms => window.__probe.record(ms), times.staticMs);
    result.draws = await page.evaluate(() => window.__probe.countDraws(10));
    result.engineStatic = await page.evaluate(() => window.bench.stats());
    await sampleMemory('afterStatic');

    // ---------- 截图：隐藏模型再拍一张，比较后才知道模型是不是真的画出来了 ----------
    progress('截图');
    const name = shotName(run, repeat);
    const screenshot = extra => page.screenshot({ timeout: 120000, animations: 'allow', ...extra });
    const shown = await screenshot({ type: 'png' });
    writeFileSync(join(screenshotsDir, `${name}.jpg`), await screenshot({ type: 'jpeg', quality: 85 }));
    await page.evaluate(() => window.bench.setModelVisible(false));
    await page.evaluate(() => window.__probe.waitFrames(3));
    await sleep(300);
    const hidden = await screenshot({ type: 'png' });
    await page.evaluate(() => window.bench.setModelVisible(true));
    await page.evaluate(() => window.__probe.waitFrames(3));
    result.image = await page.evaluate(
      ([withModel, withoutModel]) => window.__probe.analyzeShots(withModel, withoutModel),
      [shown.toString('base64'), hidden.toString('base64')]
    );
    if (result.image.blank) {
      writeFileSync(join(screenshotsDir, `${name}-hidden.jpg`), await screenshot({ type: 'jpeg', quality: 70 }));
    }

    // ---------- 飞行：第一遍要边走边下载解析，第二遍大多在缓存里 ----------
    const bench = await page.evaluate(() => ({ defaultCenter: window.bench.defaultCenter }));
    const keyframes = run.flight(bench);
    progress('飞行（第一遍）');
    result.flightCold = await page.evaluate(([frames, ms]) => window.__probe.flight(frames, ms), [keyframes, times.flightMs]);
    progress('等瓦片补齐');
    const settleStart = await page.evaluate(() => window.__probe.now());
    const settle = await page.evaluate(
      ({ timeoutMs, streak }) => window.__probe.waitStable(timeoutMs, streak),
      { timeoutMs: times.settleMs, streak: run.stableStreak ?? 5 }
    );
    result.settle = {
      stable: settle.stable,
      ms: settle.waitedMs,
      longTasks: await page.evaluate(([from, to]) => window.__probe.longTasks(from, to + 1), [settleStart, settle.at])
    };
    await sampleMemory('afterFlight');
    progress('飞行（第二遍）');
    result.flightWarm = await page.evaluate(([frames, ms]) => window.__probe.flight(frames, ms), [keyframes, times.flightMs]);
    result.engineEnd = await page.evaluate(() => window.bench.stats());
    await sampleMemory('end');
    writeFileSync(join(screenshotsDir, `${name}-end.jpg`), await screenshot({ type: 'jpeg', quality: 85 }));

    if (run.needsLcc) {
      progress('gl-watch');
      result.glWatch = await page.evaluate(([frames, ms]) => window.__probe.glWatch(frames, ms), [keyframes, times.glWatchMs]);
    }
    const metrics = await readMetrics();
    result.mainThread = { taskDurationS: metrics.TaskDuration, scriptDurationS: metrics.ScriptDuration, wallS: (Date.now() - startedAtMs) / 1000 };
    result.pageErrors = (await page.evaluate(() => window.bench.errors.slice(0, 20))).map(item => redact(item).slice(0, 300));
    result.pageErrorCount = await page.evaluate(() => window.bench.errors.length);
  };

  try {
    await Promise.race([body(), guard.promise, crashed]);
  } catch (error) {
    result.status = 'failed';
    result.error = redact(error.message).split('\n')[0].slice(0, 500);
  } finally {
    guard.cancel();
    if (samplerTimer) {
      clearInterval(samplerTimer);
    }
    if (launched) {
      launched.browser.removeAllListeners('disconnected');
      await Promise.race([launched.browser.close().catch(() => {}), sleep(15000)]);
    }
  }

  result.durationS = (Date.now() - startedAtMs) / 1000;
  classify(run, result);
  return result;
}

/** 模型没画出来的场景，帧率再高也没有意义 */
function classify(run, result) {
  const invalid = [];
  const { image, static: staticPhase } = result;
  if (image?.blank) {
    invalid.push('画面空白');
  } else if (image && image.modelCoveragePct < MIN_MODEL_COVERAGE_PCT) {
    invalid.push(`模型没有画出来（隐藏前后只差 ${image.modelCoveragePct.toFixed(2)}% 的像素）`);
  }
  if (staticPhase && staticPhase.frames > 0 && staticPhase.renders / staticPhase.frames < 0.5) {
    invalid.push(`引擎只画了 ${staticPhase.renders} 次，rAF 走了 ${staticPhase.frames} 次，帧时间不代表完整渲染`);
  }
  // 第一人称的相机是平视的；不是的话说明相机没有落到位，帧时间测的不是这个场景
  const pitch = result.engineStatic?.cameraPitch;
  if (run.scene.kind === 'indoor' && typeof pitch === 'number' && Math.abs(pitch - 90) > 1) {
    invalid.push(`相机没有落到位：俯仰 ${pitch.toFixed(1)}°，应该是 90°`);
  }
  result.invalid = invalid;
  if (staticPhase && staticPhase.frames < 5) {
    result.notes.push(`静止段只有 ${staticPhase.frames} 帧，分位数没有意义，看平均值`);
  }
  // 缓存满了以后队列也是空的：看起来稳定了，其实是不再加载。这种"到稳定"不能和别的方案直接比
  const refused = result.engineAtStable?.tilesRefused;
  if (typeof refused === 'number' && refused > 0) {
    result.load.refusedAtStable = refused;
    result.notes.push(`到稳定时还有 ${refused} 块瓦片因为缓存满了没有加载，"到稳定"的时间不能和其他方案直接比，要结合 refused 和截图看`);
  }
  const fenceTimeouts = Math.max(result.flightWarm?.fenceTimeouts ?? 0, result.flightCold?.fenceTimeouts ?? 0, staticPhase?.fenceTimeouts ?? 0);
  if (fenceTimeouts > 0) {
    result.notes.push(`有 ${fenceTimeouts} 次等 GPU 超过 15 秒，帧时间可能失真`);
  }
  if (result.status !== 'failed') {
    if (invalid.length > 0) {
      result.status = 'invalid';
    } else if (result.load && !result.load.stable) {
      result.status = 'timeout';
    }
  }
}
