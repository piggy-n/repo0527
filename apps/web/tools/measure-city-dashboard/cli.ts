import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { type BrowserContext, type CDPSession, chromium, type Page } from 'playwright';

// 驾驶舱的加载实测（docs/modules/city-dashboard.md）：node tools/measure-city-dashboard/cli.ts [产物目录] [结果名称] [CPU 倍率]
// 用内网产物；只注入固定的前端会话，不导入应用源码、不访问后端，缓存策略由这里的本地服务器明确给出
const root = resolve(process.argv[2] ?? 'dist');
const label = process.argv[3] ?? 'd3';
const cpu = Number(process.argv[4] ?? 1);
const ROUNDS = 3;
const VIEWPORT = { width: 1920, height: 1080 };
const READY_TIMEOUT = 60_000;

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.otf': 'font/otf',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
};

// 浏览器里的探针：写入测试会话，统计动画帧、WebGL 清屏次数和长任务；只存在于实测的浏览器
const PROBE = `(() => {
  const encode = value => btoa(JSON.stringify(value)).replaceAll('=', '').replaceAll('+', '-').replaceAll('/', '_');
  const token = encode({ alg: 'HS256' }) + '.' + encode({ exp: Math.floor(Date.now() / 1000) + 3600 }) + '.test';
  localStorage.setItem('yzt.session', JSON.stringify({ token, user: { loginName: 'measure', role: 'user' } }));
  const data = globalThis.dashboardProbe = { frames: 0, clears: 0, longTasks: [] };
  const raf = requestAnimationFrame;
  globalThis.requestAnimationFrame = callback => raf.call(globalThis, time => {
    data.frames++;
    callback(time);
  });
  const clear = WebGL2RenderingContext.prototype.clear;
  WebGL2RenderingContext.prototype.clear = function (...args) {
    data.clears++;
    return Reflect.apply(clear, this, args);
  };
  new PerformanceObserver(list => {
    data.longTasks.push(...list.getEntries().map(({ startTime, duration }) => ({ startTime, duration })));
  }).observe({ type: 'longtask', buffered: true });
})();`;

// 浏览器里取一次样：探针的计数、User Timing 标记、资源和字体的下载
const SAMPLE = `(() => {
  const probe = globalThis.dashboardProbe;
  const resources = performance.getEntriesByType('resource');
  const measures = performance.getEntriesByType('measure').filter(entry => entry.name.startsWith('city-dashboard:'));
  return {
    now: performance.now(),
    ...probe,
    canvases: document.querySelectorAll('canvas').length,
    navigation: performance.getEntriesByType('navigation')[0]?.toJSON() ?? {},
    marks: Object.fromEntries(performance.getEntriesByType('mark').map(entry => [entry.name, entry.startTime])),
    resources: resources.map(entry => ({
      name: new URL(entry.name).pathname,
      start: entry.startTime,
      response: entry.responseStart,
      end: entry.responseEnd,
      transfer: entry.transferSize
    })),
    measures: Object.fromEntries(measures.map(entry => [entry.name, entry.duration])),
    fonts: resources.filter(entry => entry.name.includes('/fonts/')).map(entry => ({
      name: entry.name.split('/').at(-1),
      duration: entry.duration,
      transfer: entry.transferSize,
      bytes: entry.decodedBodySize
    })),
    transferred: resources.reduce((sum, entry) => sum + entry.transferSize, 0)
  };
})()`;

// 地图就绪（D2 的终点）和统一入场完成（D3 的终点）分开记录
const MAP_READY = `document.querySelector('[data-state]')?.getAttribute('data-state') === 'ready'`;
const PAGE_READY = `(() => {
  const shell = document.querySelector('[data-dashboard-phase]');
  return !shell || shell.getAttribute('data-dashboard-phase') === 'ready';
})()`;

interface Sample {
  now: number;
  frames: number;
  clears: number;
  canvases: number;
  transferred: number;
  measures: Record<string, number>;
  navigation: Record<string, unknown>;
  marks: Record<string, number>;
  resources: { name: string; start: number; response: number; end: number; transfer: number }[];
  longTasks: { startTime: number; duration: number }[];
  fonts: { name: string; duration: number; transfer: number; bytes: number }[];
}

/** 只提供产物里的静态文件；HTML 不缓存、其他文件缓存一小时，后端地址一律 404 */
function startServer(): Promise<{ server: Server; baseURL: string }> {
  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    const file = resolve(root, `.${extname(pathname) ? pathname : '/index.html'}`);
    if (!file.startsWith(root + sep) || pathname.startsWith('/backend')) {
      response.writeHead(404).end();
      return;
    }
    void readFile(file).then(
      bytes => {
        response.writeHead(200, {
          'Content-Type': MIME_TYPES[extname(file)] ?? 'application/octet-stream',
          'Cache-Control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600',
          'Content-Security-Policy': "connect-src 'self'; font-src 'self'; img-src 'self' data: blob:"
        });
        return response.end(bytes);
      },
      () => response.writeHead(404).end()
    );
  });
  return new Promise((done, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('预览端口不可用'));
        return;
      }
      done({ server, baseURL: `http://127.0.0.1:${address.port}` });
    });
  });
}

function sample(page: Page): Promise<Sample> {
  return page.evaluate<Sample>(SAMPLE);
}

/** 一次加载：冷缓存是新上下文的第一次打开，暖缓存是同一标签页刷新（包含上一份文档的卸载） */
async function measureLoad(page: Page, cdp: CDPSession, url: string, cache: 'cold' | 'warm', errors: string[]) {
  if (cache === 'cold') {
    await page.goto(url);
  } else {
    await page.reload();
  }
  await page.waitForFunction(MAP_READY, undefined, { timeout: READY_TIMEOUT });
  const map = await sample(page);
  await page.waitForFunction(PAGE_READY, undefined, { timeout: READY_TIMEOUT });
  const ready = await sample(page);
  // 字体就绪才算完整；不拿后备字体的显示当成最终结果
  await page.evaluate('document.fonts.ready.then(() => undefined)');
  // 首次画完卡片之后，取 2 秒的空闲窗口统计多余的渲染
  await page.waitForTimeout(1000);
  const idleStart = await sample(page);
  await page.waitForTimeout(2000);
  const idleEnd = await sample(page);
  // 强制回收后的堆量只用来看同条件下的趋势
  await cdp.send('HeapProfiler.collectGarbage');
  const heap = await cdp.send('Runtime.getHeapUsage');
  return {
    cache,
    mapMs: map.now,
    readyMs: ready.now,
    mapMeasures: map.measures,
    readyMeasures: ready.measures,
    navigation: idleEnd.navigation,
    marks: idleEnd.marks,
    resources: idleEnd.resources,
    fonts: idleEnd.fonts,
    transferred: idleEnd.transferred,
    idle: {
      ms: idleEnd.now - idleStart.now,
      frames: idleEnd.frames - idleStart.frames,
      clears: idleEnd.clears - idleStart.clears
    },
    canvases: idleEnd.canvases,
    heapBytes: heap.usedSize,
    longTasks: idleEnd.longTasks,
    errors: [...errors]
  };
}

/** 一轮：新的浏览器上下文先测冷缓存，再刷新测暖缓存；页面报错或请求了产物以外的地址时这一轮失败 */
async function measureRound(context: BrowserContext, baseURL: string, round: number) {
  await context.addInitScript(PROBE);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const url = request.url();
    if (!url.startsWith(baseURL) && !url.startsWith('data:')) {
      errors.push(`外部请求 ${url}`);
    }
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  const results = [];
  for (const cache of ['cold', 'warm'] as const) {
    // oxlint-disable-next-line no-await-in-loop -- 暖缓存要在冷缓存之后的同一标签页上测
    const result = await measureLoad(page, cdp, `${baseURL}/city-dashboard`, cache, errors);
    const timing = `map ${Math.round(result.mapMs)}ms, ready ${Math.round(result.readyMs)}ms`;
    console.log(`${label} ${round} ${cache}: ${timing}, idle renders ${result.idle.clears}`);
    if (errors.length > 0) {
      throw new Error(errors.join('\n'));
    }
    results.push({ round, ...result });
  }
  return results;
}

const { server, baseURL } = await startServer();
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
try {
  const results = [];
  for (let round = 1; round <= ROUNDS; round++) {
    // 每轮新的上下文测冷启动；轮与轮依次进行，不并行争抢渲染资源
    // oxlint-disable-next-line no-await-in-loop -- 同上
    const context = await browser.newContext({
      viewport: VIEWPORT,
      reducedMotion: 'no-preference',
      serviceWorkers: 'block'
    });
    try {
      // oxlint-disable-next-line no-await-in-loop -- 同上
      results.push(...(await measureRound(context, baseURL, round)));
    } finally {
      // oxlint-disable-next-line no-await-in-loop -- 结束这一轮再开始下一轮
      await context.close();
    }
  }
  const output = resolve(import.meta.dirname, 'results.local');
  await mkdir(output, { recursive: true });
  const report = {
    label,
    cpu,
    renderer: 'Chromium SwiftShader',
    viewport: `${VIEWPORT.width}x${VIEWPORT.height}`,
    cache: '测试服务器 max-age=3600，非部署服务器；暖缓存为原标签页 reload',
    results
  };
  await writeFile(resolve(output, `${label}.json`), JSON.stringify(report, null, 2), 'utf8');
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise<void>((done, reject) => server.close(error => (error ? reject(error) : done())));
}
