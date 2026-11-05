// 启动浏览器和读 GPU、系统信息
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

// 软件渲染的标志；硬件名字里不会有这些
export const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|basic render|software adapter|microsoft basic|gdi generic|mesa offscreen/i;
// 常见的集显；只用来提醒，判断不准时不影响运行
export const INTEGRATED_RENDERER = /intel.*(uhd|iris|hd graphics)|radeon\(tm\) graphics|radeon graphics|vega \d+ graphics/i;

function chromeArgs(options) {
  const { width, height } = options.viewport;
  if (options.manual) {
    // 人工检查要看真实的手感，保留 vsync
    return [
      '--force_high_performance_gpu',
      '--ignore-gpu-blocklist',
      '--start-maximized',
      ...(options.allowSoftware ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [])
    ];
  }
  return [
    // 解除 vsync 和帧率上限：否则帧时间封顶在显示器刷新率，看不出余量
    '--disable-gpu-vsync',
    '--disable-frame-rate-limit',
    // 双显卡时要独显；Windows 的"图形设置"优先级更高，README 里有说明
    '--force_high_performance_gpu',
    '--ignore-gpu-blocklist',
    '--enable-precise-memory-info',
    // 窗口被挡住或失去焦点时不降频
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    '--disable-features=CalculateNativeWinOcclusion',
    `--window-size=${width + 16},${height + 120}`,
    '--window-position=0,0',
    ...(options.allowSoftware ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [])
  ];
}

/** 优先用本机 Chrome，没有再用 Playwright 自带的；两个都没有时抛出能看懂的错误 */
export async function launchBrowser(options, extraArgs = []) {
  const { chromium } = await import('playwright');
  const args = [...chromeArgs(options), ...extraArgs];
  // Ctrl+C 由 measure.mjs 处理：先把报告写完再退出
  const launchOptions = { headless: options.headless, args, handleSIGINT: false };
  try {
    const browser = await chromium.launch({ ...launchOptions, channel: 'chrome' });
    return { browser, kind: 'chrome' };
  } catch (chromeError) {
    try {
      const browser = await chromium.launch(launchOptions);
      return { browser, kind: 'playwright-chromium' };
    } catch {
      throw new Error(
        `找不到可用的浏览器。请安装 Chrome，或运行 pnpm exec playwright install chromium。\n原始错误：${String(chromeError.message).split('\n')[0]}`
      );
    }
  }
}

// 在空页面上读渲染器，并校准 rAF：判断 vsync 有没有解除
const PROBE_RENDERER = async () => {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  document.body.append(canvas);
  const gl = canvas.getContext('webgl2', { powerPreference: 'high-performance' });
  if (!gl) {
    return { webgl2: false };
  }
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  const times = [];
  await new Promise(resolve => {
    const start = performance.now();
    const step = () => {
      gl.clearColor(Math.random(), 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      times.push(performance.now());
      if (performance.now() - start < 2000) {
        requestAnimationFrame(step);
      } else {
        resolve();
      }
    };
    requestAnimationFrame(step);
  });
  const intervals = times.slice(1).map((time, index) => time - times[index]).sort((a, b) => a - b);
  return {
    webgl2: true,
    renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
    version: gl.getParameter(gl.VERSION),
    timerQuery: Boolean(gl.getExtension('EXT_disjoint_timer_query_webgl2')),
    rafMedianMs: intervals[Math.floor(intervals.length / 2)] ?? null,
    rafSamples: intervals.length,
    screen: [screen.width, screen.height]
  };
};

export async function probeRenderer(options) {
  const { browser, kind } = await launchBrowser(options);
  try {
    const page = await browser.newPage();
    const info = await page.evaluate(PROBE_RENDERER);
    return { ...info, browserKind: kind, browserVersion: browser.version() };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function powershell(command, timeoutMs = 15000) {
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], {
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024
  });
  return stdout.trim();
}

function asArray(json) {
  if (!json) {
    return [];
  }
  const parsed = JSON.parse(json);
  return Array.isArray(parsed) ? parsed : [parsed];
}

/** 系统里的显卡；非 Windows 或读不到时返回空数组 */
export async function listAdapters() {
  if (process.platform !== 'win32') {
    return [];
  }
  try {
    const json = await powershell(
      "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion,CurrentRefreshRate | ConvertTo-Json -Compress"
    );
    return asArray(json).map(item => ({ name: item.Name, driver: item.DriverVersion, refreshRate: item.CurrentRefreshRate }));
  } catch {
    return [];
  }
}

/** GPU 进程的 pid：这个进程的显存才是引擎用掉的 */
export async function gpuProcessId(browser) {
  try {
    const client = await browser.newBrowserCDPSession();
    const { processInfo } = await client.send('SystemInfo.getProcessInfo');
    await client.detach();
    return processInfo.find(item => /gpu/i.test(item.type))?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * \GPU Process Memory(*)\Dedicated Usage。优先经 WMI 读同一个计数器，因为中文系统上计数器的路径是本地化的，
 * 英文路径的 Get-Counter 会失败；两个都失败才算取不到
 */
export async function sampleGpuMemory(pid) {
  if (process.platform !== 'win32') {
    return { unavailable: '不是 Windows，没有 GPU Process Memory 计数器' };
  }
  if (!pid) {
    return { unavailable: '找不到 GPU 进程的 pid（SystemInfo.getProcessInfo 没有返回）' };
  }
  const wmi = `$ErrorActionPreference='Stop'; @(Get-CimInstance -ClassName Win32_PerfFormattedData_GPUPerformanceCounters_GPUProcessMemory -Filter "Name LIKE 'pid_${pid}_%'" | Select-Object DedicatedUsage,SharedUsage) | ConvertTo-Json -Compress`;
  let wmiError;
  try {
    const rows = asArray(await powershell(wmi));
    if (rows.length > 0) {
      const sum = key => rows.reduce((total, row) => total + Number(row[key] ?? 0), 0) / 1048576;
      return { dedicatedMB: sum('DedicatedUsage'), sharedMB: sum('SharedUsage'), source: 'WMI' };
    }
    wmiError = 'WMI 里没有这个进程的实例';
  } catch (error) {
    wmiError = /Invalid class|无效类|Not found|未找到/i.test(String(error.message)) ? '系统没有这个 WMI 类' : 'WMI 查询失败';
  }
  const counter = `$ErrorActionPreference='Stop'; (Get-Counter '\\GPU Process Memory(pid_${pid}_*)\\Dedicated Usage').CounterSamples | Measure-Object -Property CookedValue -Sum | Select-Object -ExpandProperty Sum`;
  try {
    const text = await powershell(counter);
    // 没有匹配的实例时输出是空的，不能当成 0
    if (text !== '' && Number.isFinite(Number(text))) {
      return { dedicatedMB: Number(text) / 1048576, sharedMB: null, source: 'Get-Counter' };
    }
    return { unavailable: `GPU 进程没有计数器实例（软件渲染时常见）；WMI：${wmiError}` };
  } catch {
    // 错误信息是系统语言的，这里不转述
    return { unavailable: `GPU 进程没有计数器实例（软件渲染时常见）；WMI：${wmiError}；Get-Counter 也没有读到` };
  }
}
