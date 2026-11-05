// 测量探针：在页面脚本之前注入。两个引擎用同一份代码量，只依赖 rAF、PerformanceObserver 和 WebGL，不碰引擎内部
(() => {
  if (window.__probe) {
    return;
  }
  const nativeRaf = window.requestAnimationFrame.bind(window);
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const MAX_FRAMES = 200000;
  // 等上一帧的 fence 最多等这么久，上下文丢失或驱动异常时不至于卡死页面
  const FENCE_TIMEOUT_MS = 15000;

  const frames = {
    intervals: new Float32Array(MAX_FRAMES),
    js: new Float32Array(MAX_FRAMES),
    count: 0,
    total: 0,
    lastStart: 0,
    jsAccum: 0,
    recording: false
  };
  const gpu = { gl: null, ext: null, reason: '没有绑定 WebGL 上下文', active: null, pending: [], pool: [], ms: [], collecting: false };

  // 页面最后创建的 WebGL2 上下文就是引擎用的；attach 之后以 bench.gl 为准
  let latestContext = null;
  const nativeGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const context = nativeGetContext.call(this, type, ...rest);
    if (type === 'webgl2' && context) {
      latestContext = context;
    }
    return context;
  };

  function collectGpuResults() {
    const { gl, ext } = gpu;
    while (gpu.pending.length > 0) {
      const query = gpu.pending[0];
      if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) {
        break;
      }
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
      const nanoseconds = gl.getQueryParameter(query, gl.QUERY_RESULT);
      gpu.pending.shift();
      gpu.pool.push(query);
      if (!disjoint && gpu.collecting) {
        gpu.ms.push(nanoseconds / 1e6);
      }
    }
  }

  // 只包住这一帧的回调：命令是成批提交的，这样基本是 GPU 的执行时间。回调外的 GL 调用（如异步上传）不算在内
  function gpuFrameStart() {
    const { gl, ext } = gpu;
    if (!gl || !ext) {
      return;
    }
    try {
      collectGpuResults();
      if (frames.recording && gpu.pending.length < 16) {
        const query = gpu.pool.pop() ?? gl.createQuery();
        gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
        gpu.active = query;
      }
    } catch (error) {
      gpu.reason = `GPU 计时出错：${String(error).slice(0, 120)}`;
      gpu.ext = null;
    }
  }

  function gpuFrameEnd() {
    const { gl, ext, active } = gpu;
    if (!gl || !ext || !active) {
      return;
    }
    try {
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      gpu.pending.push(active);
    } catch (error) {
      gpu.reason = `GPU 计时出错：${String(error).slice(0, 120)}`;
      gpu.ext = null;
    }
    gpu.active = null;
  }

  function frameBoundary(now) {
    if (frames.recording && frames.lastStart > 0 && frames.count < MAX_FRAMES) {
      frames.intervals[frames.count] = now - frames.lastStart;
      frames.js[frames.count] = frames.jsAccum;
      frames.count += 1;
    }
    frames.total += 1;
    frames.jsAccum = 0;
    frames.lastStart = now;
  }

  // 解除 vsync 以后，JS 提交得比 GPU 执行得快时命令会堆积：一串帧只有几毫秒，然后主线程被堵几秒，
  // 帧时间的分位数和 long task 都失真。所以等上一帧在 GPU 上执行完才开始下一帧，
  // 这样帧时间等于 JS 加 GPU，long task 也只反映主线程自己的工作。两个引擎同样处理
  const fence = { sync: null, gl: null, since: 0, timeouts: 0 };

  function previousFrameDone() {
    if (!fence.sync) {
      return true;
    }
    const { gl, sync } = fence;
    let done;
    try {
      done = gl.isContextLost() || gl.getSyncParameter(sync, gl.SYNC_STATUS) === gl.SIGNALED;
    } catch {
      done = true;
    }
    if (!done && performance.now() - fence.since > FENCE_TIMEOUT_MS) {
      fence.timeouts += 1;
      done = true;
    }
    if (done) {
      try {
        gl.deleteSync(sync);
      } catch {
        // 上下文丢失时删除会失败，不影响后面
      }
      fence.sync = null;
    }
    return done;
  }

  function placeFence() {
    const gl = gpu.gl ?? latestContext;
    if (!gl || gl.isContextLost()) {
      return;
    }
    fence.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    fence.gl = gl;
    fence.since = performance.now();
    gl.flush();
  }

  let queue = [];
  let nextCallbackId = 1;
  let tickScheduled = false;

  function scheduleTick() {
    if (!tickScheduled) {
      tickScheduled = true;
      nativeRaf(tick);
    }
  }

  function tick(stamp) {
    tickScheduled = false;
    if (queue.length === 0) {
      return;
    }
    if (!previousFrameDone()) {
      scheduleTick();
      return;
    }
    const callbacks = queue;
    queue = [];
    const start = performance.now();
    frameBoundary(start);
    gpuFrameStart();
    for (const { callback } of callbacks) {
      try {
        callback(stamp);
      } catch (error) {
        reportError(error);
      }
    }
    gpuFrameEnd();
    frames.jsAccum = performance.now() - start;
    placeFence();
    if (queue.length > 0) {
      scheduleTick();
    }
  }

  window.requestAnimationFrame = callback => {
    const id = nextCallbackId;
    nextCallbackId += 1;
    queue.push({ id, callback });
    scheduleTick();
    return id;
  };
  window.cancelAnimationFrame = id => {
    queue = queue.filter(item => item.id !== id);
  };

  const longTasks = [];
  const loafs = [];
  const unsupported = {};
  function observe(type, store) {
    try {
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          if (store.length < 20000) {
            store.push(entry);
          }
        }
      }).observe({ type, buffered: true });
    } catch (error) {
      unsupported[type] = String(error).slice(0, 120);
    }
  }
  observe('longtask', longTasks);
  observe('long-animation-frame', loafs);

  function percentile(sorted, p) {
    if (sorted.length === 0) {
      return null;
    }
    return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
  }

  function summarize(values) {
    if (values.length === 0) {
      return null;
    }
    const sorted = Float64Array.from(values).sort();
    const sum = sorted.reduce((total, value) => total + value, 0);
    return {
      samples: sorted.length,
      mean: sum / sorted.length,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
      max: sorted[sorted.length - 1]
    };
  }

  function chunkName(url) {
    if (!url) {
      return '（没有归属）';
    }
    const file = url.split('?')[0].split('/').pop() ?? url;
    return file.replace(/-[A-Za-z0-9_-]{8}\.js$/, '').replace(/\.js$/, '') || url;
  }

  // 一段时间内的 long task；起点落在区间内才算
  function longTaskStats(from, to) {
    const inRange = longTasks.filter(entry => entry.startTime >= from && entry.startTime < to);
    const durations = inRange.map(entry => entry.duration);
    const total = durations.reduce((sum, value) => sum + value, 0);
    const byChunk = new Map();
    const byFunction = new Map();
    let loafCount = 0;
    for (const loaf of loafs) {
      if (loaf.startTime < from || loaf.startTime >= to) {
        continue;
      }
      loafCount += 1;
      for (const script of loaf.scripts ?? []) {
        // 帧回调都从探针进入，归不到具体的库；promise、XHR 这类入口（下载后的解析）归得到
        const chunk = script.invoker === 'FrameRequestCallback' ? '帧回调（渲染和纹理上传）' : chunkName(script.sourceURL);
        byChunk.set(chunk, (byChunk.get(chunk) ?? 0) + script.duration);
        const key = `${chunk}:${script.sourceFunctionName || script.invoker || '匿名'}`;
        byFunction.set(key, (byFunction.get(key) ?? 0) + script.duration);
      }
    }
    const top = (map, n) =>
      [...map.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([name, ms]) => ({ name, ms: Math.round(ms) }));
    return {
      count: inRange.length,
      maxMs: durations.length ? Math.max(...durations) : 0,
      totalMs: total,
      blockingMs: durations.reduce((sum, value) => sum + Math.max(0, value - 50), 0),
      over100: durations.filter(value => value >= 100).length,
      over200: durations.filter(value => value >= 200).length,
      over500: durations.filter(value => value >= 500).length,
      over1000: durations.filter(value => value >= 1000).length,
      longAnimationFrames: unsupported['long-animation-frame'] ? null : loafCount,
      topChunks: top(byChunk, 6),
      topFunctions: top(byFunction, 6)
    };
  }

  let phase = null;

  function beginPhase() {
    frames.count = 0;
    frames.lastStart = 0;
    gpu.ms = [];
    gpu.collecting = true;
    frames.recording = true;
    phase = { start: performance.now(), renders: window.bench?.renders?.() ?? 0 };
    const keepAlive = () => {
      if (frames.recording) {
        window.requestAnimationFrame(keepAlive);
      }
    };
    window.requestAnimationFrame(keepAlive);
  }

  async function endPhase() {
    const end = performance.now();
    const renders = (window.bench?.renders?.() ?? 0) - phase.renders;
    frames.recording = false;
    const intervals = frames.intervals.slice(0, frames.count);
    const js = frames.js.slice(0, frames.count);
    // 等已经结束的 GPU 查询出结果，longtask 的回调也要到下一个任务才来
    const deadline = performance.now() + 400;
    while (performance.now() < deadline && gpu.pending.length + (gpu.active ? 1 : 0) > 0) {
      await new Promise(resolve => window.requestAnimationFrame(resolve));
    }
    gpu.collecting = false;
    await sleep(120);
    const durationMs = end - phase.start;
    const count = (limit) => intervals.reduce((n, value) => n + (value >= limit ? 1 : 0), 0);
    return {
      durationMs,
      frames: intervals.length,
      renders,
      fps: intervals.length / (durationMs / 1000),
      frame: summarize(intervals),
      js: summarize(js),
      gpu: gpu.ext ? summarize(gpu.ms) : null,
      gpuUnavailable: gpu.ext ? (gpu.ms.length === 0 ? '计时查询没有返回结果' : null) : gpu.reason,
      fenceTimeouts: fence.timeouts,
      overBudget: { ms33: count(33.3), ms50: count(50), ms100: count(100), ms200: count(200), ms500: count(500) },
      longTasks: longTaskStats(phase.start, end + 1)
    };
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function interpolate(from, to, t) {
    if (from.center) {
      return {
        center: [lerp(from.center[0], to.center[0], t), lerp(from.center[1], to.center[1], t)],
        zoom: lerp(from.zoom, to.zoom, t),
        bearing: lerp(from.bearing, to.bearing, t),
        pitch: lerp(from.pitch, to.pitch, t)
      };
    }
    return {
      lng: lerp(from.lng, to.lng, t),
      lat: lerp(from.lat, to.lat, t),
      height: lerp(from.height, to.height, t),
      heading: lerp(from.heading, to.heading, t),
      pitch: lerp(from.pitch, to.pitch, t)
    };
  }

  // 按时间走，慢的引擎丢帧但走的路一样，下载和解析的压力也一样
  function fly(keyframes, durationMs) {
    return new Promise((resolve, reject) => {
      const start = performance.now();
      const last = keyframes.length - 1;
      const step = () => {
        try {
          const progress = (performance.now() - start) / durationMs;
          if (progress >= 1) {
            window.bench.setCamera(keyframes[last]);
            resolve();
            return;
          }
          const position = progress * last;
          const index = Math.floor(position);
          window.bench.setCamera(interpolate(keyframes[index], keyframes[index + 1], position - index));
          window.requestAnimationFrame(step);
        } catch (error) {
          reject(error);
        }
      };
      window.requestAnimationFrame(step);
    });
  }

  async function waitFrames(count, timeoutMs = 20000) {
    const target = frames.total + count;
    const start = performance.now();
    while (frames.total < target && performance.now() - start < timeoutMs) {
      window.bench?.tick?.();
      await new Promise(resolve => {
        const timer = setTimeout(resolve, 200);
        window.requestAnimationFrame(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    return frames.total >= target;
  }

  const DRAW_CALLS = ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements'];

  function primitives(mode, count) {
    if (mode === 4) {
      return count / 3;
    }
    if (mode === 5 || mode === 6) {
      return Math.max(0, count - 2);
    }
    return 0;
  }

  window.__probe = {
    attach() {
      const { gl } = window.bench;
      gpu.gl = gl;
      gpu.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      gpu.reason = gpu.ext ? null : '浏览器没有提供 EXT_disjoint_timer_query_webgl2';
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      const canvas = gl.canvas;
      return {
        renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
        drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
        cssSize: [canvas.clientWidth, canvas.clientHeight],
        devicePixelRatio: window.devicePixelRatio,
        samples: gl.getParameter(gl.SAMPLES),
        attributes: gl.getContextAttributes(),
        gpuTimer: Boolean(gpu.ext),
        longAnimationFrame: !unsupported['long-animation-frame']
      };
    },

    // 模型队列连续 streak 次都是空的才算稳定；到稳定的时刻取这一串的第一次
    async waitStable(timeoutMs, streak = 5, intervalMs = 200) {
      const start = performance.now();
      let hits = 0;
      let first = 0;
      while (performance.now() - start < timeoutMs) {
        window.bench.tick();
        if (window.bench.isStable()) {
          if (hits === 0) {
            first = performance.now();
          }
          hits += 1;
          if (hits >= streak) {
            return { stable: true, at: first, waitedMs: first - start };
          }
        } else {
          hits = 0;
        }
        await sleep(intervalMs);
      }
      return { stable: false, at: performance.now(), waitedMs: performance.now() - start };
    },

    async waitBasemap(timeoutMs) {
      const start = performance.now();
      while (performance.now() - start < timeoutMs) {
        window.bench.tick();
        if (window.bench.basemapIdle()) {
          return { idle: true, waitedMs: performance.now() - start };
        }
        await sleep(200);
      }
      return { idle: false, waitedMs: performance.now() - start };
    },

    waitFrames,

    longTasks: (from, to) => longTaskStats(from, to),

    now: () => performance.now(),

    async record(durationMs) {
      beginPhase();
      await sleep(durationMs);
      return endPhase();
    },

    async flight(keyframes, durationMs) {
      beginPhase();
      await fly(keyframes, durationMs);
      return endPhase();
    },

    // 只在这段时间包一层计数：包在实例上，结束后删掉，不影响帧时间的测量
    async countDraws(frameCount = 10) {
      const { gl } = window.bench;
      const tally = { calls: 0, primitives: 0 };
      for (const name of DRAW_CALLS) {
        const original = gl[name];
        gl[name] = function (...args) {
          tally.calls += 1;
          if (name === 'drawArrays') {
            tally.primitives += primitives(args[0], args[2]);
          } else if (name === 'drawElements') {
            tally.primitives += primitives(args[0], args[1]);
          } else if (name === 'drawArraysInstanced') {
            tally.primitives += primitives(args[0], args[2]) * args[3];
          } else if (name === 'drawElementsInstanced') {
            tally.primitives += primitives(args[0], args[1]) * args[4];
          } else {
            tally.primitives += primitives(args[0], args[3]);
          }
          return original.apply(this, args);
        };
      }
      const before = frames.total;
      await waitFrames(frameCount);
      const counted = frames.total - before;
      for (const name of DRAW_CALLS) {
        delete gl[name];
      }
      return {
        frames: counted,
        callsPerFrame: counted ? tally.calls / counted : null,
        primitivesPerFrame: counted ? tally.primitives / counted : null
      };
    },

    // gl-watch：统计渲染回调外的 GL 调用和纹理调用后的错误。getError 会同步等 GPU，所以只在这段时间开。
    // 要在相机动的时候看：相机不动时不排序，库几乎不调 GL
    async glWatch(keyframes, durationMs) {
      const { gl, isRendering } = window.bench;
      const names = ['bindTexture', 'activeTexture', 'bindFramebuffer', 'useProgram', 'bindBuffer', 'texSubImage2D', 'texImage2D', 'texSubImage3D', 'texStorage2D', 'drawArrays', 'drawElements', 'readPixels', 'fenceSync', 'getBufferSubData', 'viewport', 'enable', 'disable', 'blendFunc'];
      const outside = {};
      const failures = [];
      let insideMapLibre = 0;
      for (const name of names) {
        const original = gl[name];
        gl[name] = function (...args) {
          if (isRendering && !isRendering()) {
            const stack = new Error().stack ?? '';
            if (/gaussian-splat-lite|3d-tiles-renderer/.test(stack)) {
              outside[name] = (outside[name] ?? 0) + 1;
            } else {
              insideMapLibre += 1;
            }
          }
          const result = original.apply(this, args);
          if (name.startsWith('tex')) {
            const error = gl.getError();
            if (error) {
              failures.push({ name, error, rendering: isRendering ? isRendering() : null });
            }
          }
          return result;
        };
      }
      await fly(keyframes, durationMs);
      for (const name of names) {
        delete gl[name];
      }
      return { durationMs, outside, otherOutsideCalls: insideMapLibre, textureErrors: failures.length, firstFailures: failures.slice(0, 5) };
    },

    // 判断画面是否空白、模型占了多少：比较显示模型和隐藏模型的两张截图
    async analyzeShots(withModel, withoutModel) {
      const decode = async base64 => {
        const blob = await (await fetch(`data:image/png;base64,${base64}`)).blob();
        const bitmap = await createImageBitmap(blob);
        const canvas = new OffscreenCanvas(Math.ceil(bitmap.width / 2), Math.ceil(bitmap.height / 2));
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        return context.getImageData(0, 0, canvas.width, canvas.height).data;
      };
      const a = await decode(withModel);
      const b = await decode(withoutModel);
      const pixels = a.length / 4;
      let changed = 0;
      let sum = 0;
      let squares = 0;
      const bins = new Map();
      for (let i = 0; i < a.length; i += 4) {
        const luminance = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2];
        sum += luminance;
        squares += luminance * luminance;
        const bin = (a[i] >> 5) | ((a[i + 1] >> 5) << 3) | ((a[i + 2] >> 5) << 6);
        bins.set(bin, (bins.get(bin) ?? 0) + 1);
        if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 24) {
          changed += 1;
        }
      }
      const mean = sum / pixels;
      const stddev = Math.sqrt(Math.max(0, squares / pixels - mean * mean));
      const colorBins = [...bins.values()].filter(count => count > pixels * 0.001).length;
      return {
        stddev,
        colorBins,
        blank: stddev < 4 || colorBins <= 2,
        modelCoveragePct: (changed / pixels) * 100
      };
    }
  };
})();
