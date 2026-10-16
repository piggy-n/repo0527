import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type Browser, chromium, type Request } from 'playwright';
import { preview } from 'vite';
import {
  type FinishedRequest,
  formatReport,
  type LongTask,
  type MeasureOptions,
  NETWORK_PROFILES,
  parseOptions,
  type ProfileName,
  type ProfileResult,
  type RawRun,
  STEPS,
  summarizeRun,
  TRACE_NAME
} from './report.ts';

// 实测"点击登录 → 地图第一次加载完成"（docs/modules/perf.md）：在 apps/web 下运行 pnpm measure:map-load，
// 账号密码从环境变量读取，脚本不保存它们
const loginName = process.env.YZT_MEASURE_LOGIN_NAME;
const password = process.env.YZT_MEASURE_PASSWORD;
if (!loginName || !password) {
  console.error('[measure] 请先在环境变量 YZT_MEASURE_LOGIN_NAME、YZT_MEASURE_PASSWORD 里给出登录用的账号和密码');
  process.exit(1);
}

const options = parseOptions(process.argv.slice(2));
const appRoot = resolve(import.meta.dirname, '../..');
const VIEWPORT = { width: 1440, height: 860 };

// 在每个页面最先执行：记下全部长任务（超过 50 毫秒的任务）。脚本按字符串注入，在浏览器里运行
const OBSERVE_LONG_TASKS = `
  globalThis.yztMeasureLongTasks = [];
  new PerformanceObserver(list => {
    for (const { startTime, duration } of list.getEntries()) {
      globalThis.yztMeasureLongTasks.push({ startTime, duration });
    }
  }).observe({ type: 'longtask', buffered: true });
`;

interface Timing {
  readonly traceStartWall: number;
  readonly traceStart: number;
  readonly measures: Partial<Record<string, number>>;
  readonly longTasks: readonly LongTask[];
}

// 记下请求的完成时刻（墙上时间，之后换算成从开始量起）和压缩后的大小；失败的请求不触发 requestfinished，取不到大小时记 0
async function finished(request: Request): Promise<{ url: string; end: number; bytes: number }> {
  const { startTime, responseEnd } = request.timing();
  const bytes = await request.sizes().then(
    ({ responseBodySize }) => responseBodySize,
    () => 0
  );
  return { url: request.url(), end: startTime + responseEnd, bytes };
}

async function measureOnce(browser: Browser, baseUrl: string, profile: ProfileName): Promise<RawRun> {
  const context = await browser.newContext({ viewport: VIEWPORT });
  try {
    await context.addInitScript({ content: OBSERVE_LONG_TASKS });
    const page = await context.newPage();
    const requests: Promise<{ url: string; end: number; bytes: number }>[] = [];
    // 发出了、还没结束的请求：画面稳定时还在下载的会和地图抢带宽（如字体）
    const inFlight = new Set<Request>();
    page.on('request', request => inFlight.add(request));
    page.on('requestfailed', request => inFlight.delete(request));
    page.on('requestfinished', request => {
      inFlight.delete(request);
      requests.push(finished(request));
    });
    // 不禁用缓存：每次都是新的浏览器上下文，缓存为空，和第一次访问一样；禁用缓存时 MapLibre 的每个 Worker 都会重新下载一次 Worker 脚本
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    const { conditions } = NETWORK_PROFILES[profile];
    if (conditions) {
      await cdp.send('Network.emulateNetworkConditions', { offline: false, ...conditions });
    }
    if (options.cpu > 1) {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: options.cpu });
    }

    await page.goto(new URL('login', baseUrl).href, { waitUntil: 'load' });
    const dwellStart = await page.evaluate(() => performance.now());
    await page.waitForTimeout(options.dwell);
    await page.getByPlaceholder('请输入账号').fill(loginName ?? '');
    await page.getByPlaceholder('请输入密码').fill(password ?? '');
    await page.getByRole('button', { name: '登录' }).click();

    // 两个等待各自吞掉超时：输掉的一方在关闭页面时结束，不能留下未处理的拒绝
    const settledName = `${TRACE_NAME}:settled`;
    const settled = page
      .waitForFunction(name => performance.getEntriesByName(name, 'measure').length > 0, settledName, {
        timeout: options.timeout
      })
      .then(
        () => 'settled' as const,
        () => 'timeout' as const
      );
    const errorMessage = page.locator('.el-message--error').first();
    const failed = errorMessage.waitFor({ timeout: options.timeout }).then(
      async () => `登录失败：${(await errorMessage.textContent()) ?? ''}`,
      () => 'timeout' as const
    );
    const outcome = await Promise.race([settled, failed]);
    if (outcome !== 'settled' && outcome !== 'timeout') {
      throw new Error(outcome);
    }
    const unfinished = [...inFlight].map(request => request.url());

    const timing = await page.evaluate((name): Timing => {
      const [start] = performance.getEntriesByName(`${name}:start`, 'mark');
      const prefix = `${name}:`;
      const measures = Object.fromEntries(
        performance
          .getEntriesByType('measure')
          .filter(entry => entry.name.startsWith(prefix))
          .map(entry => [entry.name.slice(prefix.length), entry.duration])
      );
      const longTasks = (globalThis as unknown as { yztMeasureLongTasks?: LongTask[] }).yztMeasureLongTasks ?? [];
      const startTime = start?.startTime ?? Number.NaN;
      return { traceStartWall: performance.timeOrigin + startTime, traceStart: startTime, measures, longTasks };
    }, TRACE_NAME);
    const finishedRequests: FinishedRequest[] = (await Promise.all(requests)).map(({ url, end, bytes }) => ({
      url,
      finish: end - timing.traceStartWall,
      bytes
    }));
    return {
      settled: outcome === 'settled',
      measures: Object.fromEntries(
        STEPS.flatMap(step => {
          const value = timing.measures[step];
          return value === undefined ? [] : [[step, value]];
        })
      ),
      dwellStart,
      traceStart: timing.traceStart,
      longTasks: timing.longTasks,
      requests: finishedRequests,
      unfinished
    };
  } finally {
    await context.close();
  }
}

async function measureAll(baseUrl: string, measure: MeasureOptions): Promise<{ profile: ProfileName; raw: RawRun[] }[]> {
  const browser = await chromium.launch({
    channel: measure.channel === 'chromium' ? undefined : measure.channel,
    headless: measure.headless
  });
  try {
    const results: { profile: ProfileName; raw: RawRun[] }[] = [];
    for (const profile of measure.profiles) {
      const raw: RawRun[] = [];
      for (let run = 1; run <= measure.runs; run++) {
        // oxlint-disable-next-line no-await-in-loop -- 每次实测依次进行：同时进行会互相抢带宽和 CPU
        const result = await measureOnce(browser, baseUrl, profile);
        const settledAt = result.measures.settled;
        console.log(
          `[measure] ${NETWORK_PROFILES[profile].label} 第 ${run} 次：${settledAt === undefined ? '没有等到画面稳定' : `画面稳定 ${Math.round(settledAt)} ms`}`
        );
        raw.push(result);
      }
      results.push({ profile, raw });
    }
    return results;
  } finally {
    await browser.close();
  }
}

if (!options.url && !existsSync(resolve(appRoot, 'dist/index.html'))) {
  console.error('[measure] 没有构建产物，请先运行 pnpm build（pnpm measure:map-load 会先构建）');
  process.exit(1);
}
// 不给地址时用 vite preview 提供构建产物，接口按 vite.config.ts 的代理转发
const server = options.url ? undefined : await preview({ root: appRoot, logLevel: 'warn', preview: { open: false } });
try {
  const baseUrl = options.url ?? server?.resolvedUrls?.local[0];
  if (!baseUrl) {
    throw new Error('预览服务器没有给出地址');
  }
  console.log(`[measure] ${baseUrl}，每档 ${options.runs} 次，登录页停留 ${options.dwell} ms，CPU ${options.cpu}×，${options.channel}`);
  const results = await measureAll(baseUrl, options);
  const report: ProfileResult[] = results.map(({ profile, raw }) => ({ profile, runs: raw.map(summarizeRun) }));
  console.log(`\n${formatReport(report)}\n`);

  const outputDir = resolve(import.meta.dirname, 'results.local');
  mkdirSync(outputDir, { recursive: true });
  const file = resolve(outputDir, `${options.label}-${new Date().toISOString().replaceAll(':', '-')}.json`);
  writeFileSync(file, JSON.stringify({ options: { ...options, url: options.url ?? 'vite preview' }, results }, null, 2));
  console.log(`[measure] 原始数据：${file}`);
} finally {
  await server?.close();
}
