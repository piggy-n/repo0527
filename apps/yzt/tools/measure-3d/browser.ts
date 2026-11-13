import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { type Browser, chromium } from 'playwright';
import type { Options } from './options.ts';

// 启动浏览器和读 GPU、系统信息（来自 ADR 0147 的 PoC）

const run = promisify(execFile);

function chromeArgs({ viewport, allowSoftware }: Options): string[] {
  return [
    // 解除 vsync 和帧率上限：否则帧时间封顶在显示器刷新率，看不出余量
    '--disable-gpu-vsync',
    '--disable-frame-rate-limit',
    // 双显卡时要独显；Windows 的"图形设置"优先级更高
    '--force_high_performance_gpu',
    '--ignore-gpu-blocklist',
    '--enable-precise-memory-info',
    // 窗口被挡住或失去焦点时不降频
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    '--disable-features=CalculateNativeWinOcclusion',
    `--window-size=${viewport.width + 16},${viewport.height + 120}`,
    '--window-position=0,0',
    ...(allowSoftware ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [])
  ];
}

export interface LaunchedBrowser {
  readonly browser: Browser;
  readonly kind: string;
}

/** 优先用本机的 Chrome、Edge，没有再用 Playwright 自带的；都没有时抛出能看懂的错误 */
export async function launchBrowser(options: Options): Promise<LaunchedBrowser> {
  const launchOptions = { headless: options.headless, args: chromeArgs(options), handleSIGINT: false };
  // 无头时用 Playwright 自带的就够了：本机的 Chrome、Edge 主要是为了真实显卡
  const channels = options.headless ? [] : ['chrome', 'msedge'];
  for (const channel of channels) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- 按顺序试
      return { browser: await chromium.launch({ ...launchOptions, channel }), kind: channel };
    } catch {
      // 这台机器没有这个浏览器，试下一个
    }
  }
  try {
    return { browser: await chromium.launch(launchOptions), kind: 'playwright-chromium' };
  } catch (error) {
    throw new Error(
      `找不到可用的浏览器。请安装 Chrome 或 Edge，或运行 pnpm --filter yzt exec playwright install chromium。\n原始错误：${String(error).split('\n')[0]}`,
      { cause: error }
    );
  }
}

export interface RendererInfo {
  readonly webgl2: boolean;
  readonly renderer: string;
  readonly timerQuery: boolean;
  /** 不等 fence、最多 1 帧在路上、最多 2 帧在路上时空页面的帧间隔（毫秒） */
  readonly floorMs: Readonly<Record<string, number | null>>;
}

// 在空页面上读渲染器，并校准帧间隔的下限：只清屏，不同的等待方式各跑一小段。按字符串注入，在浏览器里运行
const CALIBRATE = `(async () => {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  document.body.append(canvas);
  const gl = canvas.getContext('webgl2', { powerPreference: 'high-performance' });
  if (!gl) {
    return { webgl2: false, renderer: '', timerQuery: false, floorMs: {} };
  }
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  const floor = limit =>
    new Promise(resolve => {
      const times = [];
      const fences = [];
      const start = performance.now();
      const step = () => {
        const now = performance.now();
        while (fences.length > 0 && gl.getSyncParameter(fences[0], gl.SYNC_STATUS) === gl.SIGNALED) {
          gl.deleteSync(fences.shift());
        }
        if (limit === 0 || fences.length < limit) {
          times.push(now);
          gl.clearColor(Math.random(), 0, 0, 1);
          gl.clear(gl.COLOR_BUFFER_BIT);
          if (limit > 0) {
            fences.push(gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0));
            gl.flush();
          }
        }
        if (now - start < 1500) {
          requestAnimationFrame(step);
        } else {
          const intervals = times.slice(1).map((time, index) => time - times[index]).sort((a, b) => a - b);
          resolve(intervals[Math.floor(intervals.length / 2)] ?? null);
        }
      };
      requestAnimationFrame(step);
    });
  const floorMs = { 'pacing-0': await floor(0), 'pacing-1': await floor(1), 'pacing-2': await floor(2) };
  return {
    webgl2: true,
    renderer: gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
    timerQuery: Boolean(gl.getExtension('EXT_disjoint_timer_query_webgl2')),
    floorMs
  };
})()`;

export async function probeRenderer(options: Options): Promise<RendererInfo & { readonly browser: string }> {
  const { browser, kind } = await launchBrowser(options);
  try {
    const page = await browser.newPage();
    const info = (await page.evaluate(CALIBRATE)) as RendererInfo;
    return { ...info, browser: `${kind} ${browser.version()}` };
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function powershell(command: string, timeoutMs = 15000): Promise<string> {
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], {
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024
  });
  return stdout.trim();
}

function rowsOf(json: string): Record<string, unknown>[] {
  if (!json) {
    return [];
  }
  const parsed = JSON.parse(json) as Record<string, unknown> | Record<string, unknown>[];
  return Array.isArray(parsed) ? parsed : [parsed];
}

const text = (value: unknown) => (typeof value === 'string' ? value : '未知');

/** 系统里的显卡；非 Windows 或读不到时返回空数组 */
export async function listAdapters(): Promise<string[]> {
  if (process.platform !== 'win32') {
    return [];
  }
  try {
    const json = await powershell(
      '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion | ConvertTo-Json -Compress'
    );
    return rowsOf(json).map(item => `${text(item.Name)}（驱动 ${text(item.DriverVersion)}）`);
  } catch {
    return [];
  }
}

/** 浏览器的进程：GPU 进程的显存才是引擎用掉的；渲染进程里有页面和它的 Worker（泼溅库在 Worker 里解码） */
export interface BrowserProcesses {
  readonly gpu: number | null;
  readonly renderers: readonly number[];
}

/** 页面打开以后再读：渲染进程是打开页面时才有的 */
export async function browserProcesses(browser: Browser): Promise<BrowserProcesses> {
  try {
    const client = await browser.newBrowserCDPSession();
    const { processInfo } = (await client.send('SystemInfo.getProcessInfo')) as {
      processInfo: readonly { readonly id: number; readonly type: string }[];
    };
    await client.detach();
    return {
      gpu: processInfo.find(item => /gpu/i.test(item.type))?.id ?? null,
      renderers: processInfo.filter(item => item.type === 'renderer').map(item => item.id)
    };
  } catch {
    return { gpu: null, renderers: [] };
  }
}

/** GPU 进程的专用显存，和共享 GPU 内存（专用的放不下时 Windows 用系统内存补上，涨了说明显存超了） */
export type GpuMemory = { readonly dedicatedMB: number; readonly sharedMB: number } | { readonly unavailable: string };

export interface MemorySample {
  readonly gpu: GpuMemory;
  /** 渲染进程（全部，备用的空进程只有几十 MB）、GPU 进程的私有内存（MB，提交的字节）；读不到时为 null */
  readonly rendererPrivateMB: number | null;
  readonly gpuProcessPrivateMB: number | null;
}

const NO_PROCESS_MEMORY = { rendererPrivateMB: null, gpuProcessPrivateMB: null } as const;

function privateMB(rows: readonly Record<string, unknown>[], pids: readonly number[]): number | null {
  const matched = rows.filter(row => pids.includes(Number(row.Id)));
  return matched.length > 0 ? matched.reduce((total, row) => total + Number(row.PrivateMemorySize64 ?? 0), 0) / 1048576 : null;
}

/**
 * 一次 PowerShell 读三样：\GPU Process Memory(*)\Dedicated Usage、Shared Usage（经 WMI：中文系统上计数器的路径是本地化的，Get-Counter 用不了），
 * 渲染进程和 GPU 进程的私有内存（Get-Process）。泼溅的 CPU 内存（ADR 0149 第 5 节）看渲染进程
 */
export async function sampleMemory({ gpu, renderers }: BrowserProcesses): Promise<MemorySample> {
  if (process.platform !== 'win32') {
    return { gpu: { unavailable: '不是 Windows，没有 GPU Process Memory 计数器' }, ...NO_PROCESS_MEMORY };
  }
  const pids = [...renderers, ...(gpu === null ? [] : [gpu])];
  const gpuQuery =
    gpu === null
      ? '$gpu = $null'
      : `try { $gpu = @(Get-CimInstance -ClassName Win32_PerfFormattedData_GPUPerformanceCounters_GPUProcessMemory -Filter "Name LIKE 'pid_${gpu}_%'" -ErrorAction Stop | Select-Object DedicatedUsage,SharedUsage) } catch { $gpu = 'failed' }`;
  const processQuery =
    pids.length === 0 ? '$processes = @()' : `$processes = @(Get-Process -Id ${pids.join(',')} -ErrorAction SilentlyContinue | Select-Object Id,PrivateMemorySize64)`;
  try {
    const parsed = JSON.parse(await powershell(`${gpuQuery}; ${processQuery}; @{ gpu = $gpu; processes = $processes } | ConvertTo-Json -Compress -Depth 4`)) as {
      readonly gpu: unknown;
      readonly processes: unknown;
    };
    const processes = Array.isArray(parsed.processes) ? (parsed.processes as Record<string, unknown>[]) : [];
    const memory = {
      rendererPrivateMB: privateMB(processes, renderers),
      gpuProcessPrivateMB: gpu === null ? null : privateMB(processes, [gpu])
    };
    if (gpu === null) {
      return { gpu: { unavailable: '找不到 GPU 进程的 pid' }, ...memory };
    }
    if (parsed.gpu === 'failed') {
      return { gpu: { unavailable: 'WMI 查询失败' }, ...memory };
    }
    const rows = Array.isArray(parsed.gpu) ? (parsed.gpu as Record<string, unknown>[]) : [];
    const sum = (key: string) => rows.reduce((total, row) => total + Number(row[key] ?? 0), 0) / 1048576;
    return rows.length > 0
      ? { gpu: { dedicatedMB: sum('DedicatedUsage'), sharedMB: sum('SharedUsage') }, ...memory }
      : { gpu: { unavailable: 'GPU 进程没有计数器实例（软件渲染时常见）' }, ...memory };
  } catch {
    return { gpu: { unavailable: 'PowerShell 查询失败' }, ...NO_PROCESS_MEMORY };
  }
}
