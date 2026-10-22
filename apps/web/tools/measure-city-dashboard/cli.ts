import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium, type Page } from 'playwright';

// 独立内网产物实测：node tools/measure-city-dashboard/cli.ts [产物目录] [结果名称] [CPU 倍率]
// 只注入固定前端会话，不导入应用源码、不访问真实后端，缓存策略由本地测试服务器明确提供
const root = resolve(process.argv[2] ?? 'dist');
const label = process.argv[3] ?? 'd3';
const cpu = Number(process.argv[4] ?? 1);
const mime: Readonly<Record<string, string>> = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html',
  '.json': 'application/json', '.woff2': 'font/woff2', '.otf': 'font/otf', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
  const file = resolve(root, `.${extname(pathname) ? pathname : '/index.html'}`);
  if (!file.startsWith(root + sep) || pathname.startsWith('/backend')) { response.writeHead(404).end(); return; }
  void readFile(file).then(bytes => {
    response.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600',
      'Content-Security-Policy': "connect-src 'self'; font-src 'self'; img-src 'self' data: blob:" });
    return response.end(bytes);
  }, () => { response.writeHead(404).end(); });
});
await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
const address = server.address();
if (!address || typeof address === 'string') { throw new Error('预览端口不可用'); }
const baseURL = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
const results: unknown[] = [];

/** 探针仅存在于实测浏览器，生产页面不暴露引擎或调试单例 */
const probe = `(() => {
  const encode = value => btoa(JSON.stringify(value)).replaceAll('=', '').replaceAll('+', '-').replaceAll('/', '_');
  localStorage.setItem('yzt.session', JSON.stringify({token: encode({alg:'HS256'})+'.'+encode({exp:Math.floor(Date.now()/1000)+3600})+'.test',user:{loginName:'measure',role:'user'}}));
  const data = globalThis.dashboardProbe = { frames:0, clears:0, longTasks:[] };
  const raf = requestAnimationFrame;
  globalThis.requestAnimationFrame = callback => raf.call(globalThis, time => { data.frames++; callback(time); });
  const clear = WebGL2RenderingContext.prototype.clear;
  WebGL2RenderingContext.prototype.clear = function(...args) { data.clears++; return Reflect.apply(clear,this,args); };
  new PerformanceObserver(list => data.longTasks.push(...list.getEntries().map(({startTime,duration}) => ({startTime,duration})))).observe({type:'longtask',buffered:true});
})();`;

interface Sample {
  now: number; frames: number; clears: number; canvases: number; transferred: number;
  measures: Record<string, number>;
  navigation: Record<string, unknown>;
  marks: Record<string, number>;
  resources: { name: string; start: number; response: number; end: number; transfer: number }[];
  longTasks: { startTime: number; duration: number }[];
  fonts: { name: string; duration: number; transfer: number; bytes: number }[];
}

async function sample(page: Page): Promise<Sample> {
  return page.evaluate<Sample>(`(() => {
    const probe = globalThis.dashboardProbe;
    const resources = performance.getEntriesByType('resource');
    return { now: performance.now(), ...probe, canvases: document.querySelectorAll('canvas').length,
      navigation: performance.getEntriesByType('navigation')[0]?.toJSON() ?? {},
      marks: Object.fromEntries(performance.getEntriesByType('mark').map(entry => [entry.name, entry.startTime])),
      resources: resources.map(entry => ({ name: new URL(entry.name).pathname, start: entry.startTime, response: entry.responseStart, end: entry.responseEnd, transfer: entry.transferSize })),
      measures: Object.fromEntries(performance.getEntriesByType('measure').filter(entry => entry.name.startsWith('city-dashboard:')).map(entry => [entry.name, entry.duration])),
      fonts: resources.filter(entry => entry.name.includes('/fonts/')).map(entry => ({ name: entry.name.split('/').at(-1), duration: entry.duration, transfer: entry.transferSize, bytes: entry.decodedBodySize })),
      transferred: resources.reduce((sum, entry) => sum + entry.transferSize, 0) };
  })()`);
}

try {
  for (let round = 0; round < 3; round++) {
    // oxlint-disable-next-line no-await-in-loop -- 每轮新上下文测冷启动，再在同一上下文测缓存，不能并行争抢渲染资源
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'no-preference', serviceWorkers: 'block' });
    try {
      // oxlint-disable-next-line no-await-in-loop -- 初始化本轮浏览器和探针
      await context.addInitScript(probe);
      // oxlint-disable-next-line no-await-in-loop -- 每轮独立页面
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => { if (!request.url().startsWith(baseURL) && !request.url().startsWith('data:')) { errors.push(`外部请求 ${request.url()}`); } });
      // oxlint-disable-next-line no-await-in-loop -- 每轮独立性能会话
      const cdp = await context.newCDPSession(page);
      // oxlint-disable-next-line no-await-in-loop -- 固定 CPU 条件
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
      for (const cache of ['cold', 'warm']) {
        if (cache === 'warm') {
          // oxlint-disable-next-line no-await-in-loop -- 暖缓存按用户刷新原标签页测量，包含上一份文档的卸载
          await page.reload();
        } else {
          // oxlint-disable-next-line no-await-in-loop -- 新上下文即冷缓存，不禁用浏览器缓存
          await page.goto(`${baseURL}/city-dashboard`);
        }
        // oxlint-disable-next-line no-await-in-loop -- D2 只记录地图就绪，D3 另外记录统一入场完成，报告中明确区分
        await page.waitForFunction(`document.querySelector('[data-state]')?.getAttribute('data-state') === 'ready'`, undefined, { timeout: 60000 });
        // oxlint-disable-next-line no-await-in-loop -- 不以字体下载速度替代组件就绪速度
        const map = await sample(page);
        // oxlint-disable-next-line no-await-in-loop -- 等待可交互终态
        await page.waitForFunction(`!document.querySelector('[data-dashboard-phase]') || document.querySelector('[data-dashboard-phase]')?.getAttribute('data-dashboard-phase') === 'ready'`, undefined, { timeout: 60000 });
        // oxlint-disable-next-line no-await-in-loop -- 入场耗时独立采样
        const ready = await sample(page);
        // oxlint-disable-next-line no-await-in-loop -- 字体就绪记录，不将 fallback 当成最终字体
        await page.evaluate('document.fonts.ready.then(() => undefined)');
        // oxlint-disable-next-line no-await-in-loop -- 首次卡片绘制结束后取空闲窗口
        await page.waitForTimeout(1000);
        // oxlint-disable-next-line no-await-in-loop -- 空闲开始
        const idleStart = await sample(page);
        // oxlint-disable-next-line no-await-in-loop -- 固定两秒取样窗口，非等待事件
        await page.waitForTimeout(2000);
        // oxlint-disable-next-line no-await-in-loop -- 空闲结束
        const idleEnd = await sample(page);
        // oxlint-disable-next-line no-await-in-loop -- 回收后记录堆量，只作趋势观察
        await cdp.send('HeapProfiler.collectGarbage');
        // oxlint-disable-next-line no-await-in-loop -- 堆量和 DOM 计数
        const heap = await cdp.send('Runtime.getHeapUsage');
        results.push({ round: round + 1, cache, mapMs: map.now, readyMs: ready.now, mapMeasures: map.measures, readyMeasures: ready.measures,
          navigation: idleEnd.navigation, marks: idleEnd.marks, resources: idleEnd.resources,
          fonts: idleEnd.fonts, transferred: idleEnd.transferred, idle: { ms: idleEnd.now - idleStart.now, frames: idleEnd.frames - idleStart.frames, clears: idleEnd.clears - idleStart.clears },
          canvases: idleEnd.canvases, heapBytes: heap.usedSize, longTasks: idleEnd.longTasks, errors });
        console.log(`${label} ${round + 1} ${cache}: map ${Math.round(map.now)}ms, ready ${Math.round(ready.now)}ms, idle renders ${idleEnd.clears - idleStart.clears}`);
        if (errors.length) { throw new Error(errors.join('\n')); }
      }
    } finally {
      // oxlint-disable-next-line no-await-in-loop -- 结束一轮后再开始下一轮
      await context.close();
    }
  }
  const output = resolve(import.meta.dirname, 'results.local');
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, `${label}.json`), JSON.stringify({ label, cpu, renderer: 'Chromium SwiftShader', viewport: '1920x1080', cache: '测试服务器 max-age=3600，非部署服务器；暖缓存为原标签页 reload', results }, null, 2), 'utf8');
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
}
