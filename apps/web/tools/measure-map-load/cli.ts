import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type Browser, type BrowserContext, type CDPSession, chromium, type Page, type Request } from 'playwright';
import { preview, type PreviewServer } from 'vite';
import {
  type BuildResult,
  type FinishedRequest,
  formatComparison,
  formatReport,
  type LongTask,
  type MeasureOptions,
  NETWORK_PROFILES,
  parseOptions,
  type ProfileName,
  type RawRun,
  STEPS,
  summarizeRun,
  TRACE_NAME
} from './report.ts';
import {
  formatSceneComparison,
  formatSceneReport,
  SCENE_STEPS,
  SCENE_TRACE_NAME,
  type SceneBuildResult,
  type SceneRawRun,
  summarizeSceneRun
} from './scene-report.ts';

// 实测"点击登录 → 地图第一次加载完成"或"进了地图以后第一次切到三维"（docs/modules/perf.md）：在 apps/web 下运行
// pnpm measure:map-load；账号密码从环境变量读取，脚本不保存它们；--mock-backend 时不连后端、不用账号
const options = parseOptions(process.argv.slice(2));
const loginName = options.mockBackend ? 'measure' : process.env.YZT_MEASURE_LOGIN_NAME;
const password = options.mockBackend ? 'measure' : process.env.YZT_MEASURE_PASSWORD;
if (!loginName || !password) {
  console.error('[measure] 请先在环境变量 YZT_MEASURE_LOGIN_NAME、YZT_MEASURE_PASSWORD 里给出登录用的账号和密码');
  process.exit(1);
}

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

interface Download {
  readonly url: string;
  readonly end: number;
  readonly bytes: number;
}

// 记下请求的完成时刻（墙上时间，之后换算成从开始量起）和压缩后的大小；失败的请求不触发 requestfinished，取不到大小时记 0
async function finished(request: Request): Promise<Download> {
  const { startTime, responseEnd } = request.timing();
  const bytes = await request.sizes().then(
    ({ responseBodySize }) => responseBodySize,
    () => 0
  );
  return { url: request.url(), end: startTime + responseEnd, bytes };
}

const encode = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

// 假 JWT：一小时后过期；前端只解码、不验签
function fakeToken(): string {
  const payload = { sub: 'measure', exp: Math.floor(Date.now() / 1000) + 3600 };
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature`;
}

// 不连后端：登录给假的 token，资源目录为空，其余接口回空数据；配内网构建时整个实测不出本机
async function mockBackend(context: BrowserContext): Promise<void> {
  const token = fakeToken();
  await context.route('**/backend/**', async route => {
    const { pathname } = new URL(route.request().url());
    let data: unknown = null;
    if (pathname.endsWith('/user/login')) {
      data = { token, loginName, realName: '实测', roleCode: 'user' };
    } else if (pathname.endsWith('/resource-map/base/tree')) {
      data = [];
    }
    await route.fulfill({ json: { code: 200, data } });
  });
}

// 读一轮标记：开始的时刻、各步骤的 measure 和页面上记下的长任务
function readTiming(page: Page, name: string): Promise<Timing> {
  return page.evaluate((trace): Timing => {
    const [start] = performance.getEntriesByName(`${trace}:start`, 'mark');
    const prefix = `${trace}:`;
    const measures = Object.fromEntries(
      performance
        .getEntriesByType('measure')
        .filter(entry => entry.name.startsWith(prefix))
        .map(entry => [entry.name.slice(prefix.length), entry.duration])
    );
    const longTasks = (globalThis as unknown as { yztMeasureLongTasks?: LongTask[] }).yztMeasureLongTasks ?? [];
    const startTime = start?.startTime ?? Number.NaN;
    return { traceStartWall: performance.timeOrigin + startTime, traceStart: startTime, measures, longTasks };
  }, name);
}

// 等某一轮标记的最后一个 measure 出现；超时返回 false，不抛错
function waitForMeasure(page: Page, name: string): Promise<boolean> {
  return page
    .waitForFunction(entry => performance.getEntriesByName(entry, 'measure').length > 0, name, {
      timeout: options.timeout
    })
    .then(
      () => true,
      () => false
    );
}

// CDP 的 JS 堆：先回收一次，数字才稳定；CDP 的命令不限时，最多等 10 秒，取不到记 0
async function heapUsed(cdp: CDPSession): Promise<number> {
  const read = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    const { metrics } = await cdp.send('Performance.getMetrics');
    return metrics.find(({ name }) => name === 'JSHeapUsedSize')?.value ?? 0;
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const giveUp = new Promise<number>(done => {
    timer = setTimeout(() => done(0), 10_000);
  });
  try {
    return await Promise.race([read(), giveUp]);
  } finally {
    clearTimeout(timer);
  }
}

interface Session {
  readonly page: Page;
  readonly cdp: CDPSession;
  readonly requests: Promise<Download>[];
  readonly inFlight: Set<Request>;
  readonly dwellStart: number;
}

// 新的浏览器上下文、限速，打开登录页、停留、点登录
async function openAndLogin(context: BrowserContext, baseUrl: string, profile: ProfileName): Promise<Session> {
  await context.addInitScript({ content: OBSERVE_LONG_TASKS });
  if (options.mockBackend) {
    await mockBackend(context);
  }
  const page = await context.newPage();
  // Playwright 的操作默认不限时：按钮被挡住时点击会一直等，整次实测卡住
  page.setDefaultTimeout(options.timeout);
  const requests: Promise<Download>[] = [];
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
  await cdp.send('Performance.enable');
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
  return { page, cdp, requests, inFlight, dwellStart };
}

// 从开始的标记量起的完成时刻；早于 since（墙上时间）完成的不要
async function requestsSince(session: Session, startWall: number, since: number): Promise<FinishedRequest[]> {
  return (await Promise.all(session.requests))
    .filter(({ end }) => end >= since)
    .map(({ url, end, bytes }) => ({ url, finish: end - startWall, bytes }));
}

async function measureLogin(session: Session): Promise<RawRun> {
  const { page } = session;
  // 两个等待各自吞掉超时：输掉的一方在关闭页面时结束，不能留下未处理的拒绝
  const settled = waitForMeasure(page, `${TRACE_NAME}:settled`).then(done => (done ? 'settled' : 'timeout'));
  const errorMessage = page.locator('.el-message--error').first();
  const failed = errorMessage.waitFor({ timeout: options.timeout }).then(
    async () => `登录失败：${(await errorMessage.textContent()) ?? ''}`,
    () => 'timeout' as const
  );
  const outcome = await Promise.race([settled, failed]);
  if (outcome !== 'settled' && outcome !== 'timeout') {
    throw new Error(outcome);
  }
  const unfinished = [...session.inFlight].map(request => request.url());
  const timing = await readTiming(page, TRACE_NAME);
  return {
    settled: outcome === 'settled',
    measures: Object.fromEntries(
      STEPS.flatMap(step => {
        const value = timing.measures[step];
        return value === undefined ? [] : [[step, value]];
      })
    ),
    dwellStart: session.dwellStart,
    traceStart: timing.traceStart,
    longTasks: timing.longTasks,
    requests: await requestsSince(session, timing.traceStartWall, Number.NEGATIVE_INFINITY),
    unfinished
  };
}

// 二维画面稳定以后停留 --stay 毫秒，点"三维"，等到三维画面稳定；二维没有稳定时这一次不算
async function measureSwitch(session: Session): Promise<SceneRawRun> {
  const { page, cdp } = session;
  if (!(await waitForMeasure(page, `${TRACE_NAME}:settled`))) {
    const nothing = { stayStart: 0, traceStart: 0, longTasks: [], requests: [], unfinished: [] };
    return { settled: false, measures: {}, ...nothing, heapBefore: 0, heapAfter: 0 };
  }
  const { stayStart, stayStartWall } = await page.evaluate(() => ({
    stayStart: performance.now(),
    stayStartWall: performance.timeOrigin + performance.now()
  }));
  await page.waitForTimeout(options.stay);
  const heapBefore = await heapUsed(cdp);
  // 点不了（超时）时这一次不算，接着测下一次；留一张截图看是什么挡住了
  const clicked = await page
    .getByRole('button', { name: '三维', exact: true })
    .click()
    .then(
      () => true,
      () => false
    );
  if (!clicked) {
    const shot = resolve(import.meta.dirname, 'results.local', `${options.label}-click-failed-${Date.now()}.png`);
    await page.screenshot({ path: shot }).catch(() => undefined);
    console.log(`[measure] 点不了"三维"，截图：${shot}`);
  }
  const settled = clicked && (await waitForMeasure(page, `${SCENE_TRACE_NAME}:settled`));
  const unfinished = [...session.inFlight].map(request => request.url());
  const heapAfter = await heapUsed(cdp);
  const timing = await readTiming(page, SCENE_TRACE_NAME);
  return {
    settled,
    measures: Object.fromEntries(
      SCENE_STEPS.flatMap(step => {
        const value = timing.measures[step];
        return value === undefined ? [] : [[step, value]];
      })
    ),
    stayStart,
    traceStart: timing.traceStart,
    longTasks: timing.longTasks,
    requests: await requestsSince(session, timing.traceStartWall, stayStartWall),
    unfinished,
    heapBefore,
    heapAfter
  };
}

type AnyRun = RawRun | SceneRawRun;

async function measureOnce(browser: Browser, baseUrl: string, profile: ProfileName): Promise<AnyRun> {
  const context = await browser.newContext({ viewport: VIEWPORT });
  try {
    const session = await openAndLogin(context, baseUrl, profile);
    return options.scenario === 'login' ? await measureLogin(session) : await measureSwitch(session);
  } finally {
    await context.close();
  }
}

interface Target {
  readonly name: string;
  readonly baseUrl: string;
}

interface BuildRaw {
  readonly build: string;
  readonly profiles: { readonly profile: ProfileName; readonly raw: AnyRun[] }[];
}

async function measureAll(targets: readonly Target[], measure: MeasureOptions): Promise<BuildRaw[]> {
  const browser = await chromium.launch({
    channel: measure.channel === 'chromium' ? undefined : measure.channel,
    headless: measure.headless
  });
  try {
    const results = targets.map(({ name }) => ({
      build: name,
      profiles: measure.profiles.map(profile => ({ profile, raw: [] as AnyRun[] }))
    }));
    for (const [profileIndex, profile] of measure.profiles.entries()) {
      for (let run = 1; run <= measure.runs; run++) {
        // 各份构建交替测量：网络的波动平均分到每一份上，不集中在某一份
        for (const [buildIndex, target] of targets.entries()) {
          // oxlint-disable-next-line no-await-in-loop -- 每次实测依次进行：同时进行会互相抢带宽和 CPU
          const result = await measureOnce(browser, target.baseUrl, profile);
          results[buildIndex]?.profiles[profileIndex]?.raw.push(result);
          const settledAt = result.measures.settled;
          console.log(
            `[measure] ${target.name}，${NETWORK_PROFILES[profile].label} 第 ${run} 次：${settledAt === undefined ? '没有等到画面稳定' : `画面稳定 ${Math.round(settledAt)} ms`}`
          );
        }
      }
    }
    return results;
  } finally {
    await browser.close();
  }
}

const isSceneRun = (run: AnyRun): run is SceneRawRun => 'stayStart' in run;
const isLoginRun = (run: AnyRun): run is RawRun => 'dwellStart' in run;

// 按场景整理、输出对比和每份构建的表
function report(results: readonly BuildRaw[]): void {
  if (options.scenario === 'switch-3d') {
    const summaries: SceneBuildResult[] = results.map(({ build, profiles }) => ({
      build,
      profiles: profiles.map(({ profile, raw }) => ({ profile, runs: raw.filter(isSceneRun).map(summarizeSceneRun) }))
    }));
    if (summaries.length > 1) {
      console.log(`\n${formatSceneComparison(summaries)}`);
    }
    for (const { build, profiles } of summaries) {
      console.log(`\n${summaries.length > 1 ? `## ${build}\n\n` : ''}${formatSceneReport(profiles)}`);
    }
    return;
  }
  const summaries: BuildResult[] = results.map(({ build, profiles }) => ({
    build,
    profiles: profiles.map(({ profile, raw }) => ({ profile, runs: raw.filter(isLoginRun).map(summarizeRun) }))
  }));
  if (summaries.length > 1) {
    console.log(`\n${formatComparison(summaries)}`);
  }
  for (const { build, profiles } of summaries) {
    console.log(`\n${summaries.length > 1 ? `## ${build}\n\n` : ''}${formatReport(profiles)}`);
  }
}

// 不给地址时每份构建各用一个 vite preview 提供，接口按 vite.config.ts 的代理转发（--mock-backend 时在浏览器里拦下）
const servers: PreviewServer[] = [];
try {
  const targets: Target[] = [];
  if (options.url) {
    targets.push({ name: options.label, baseUrl: options.url });
  }
  for (const { name, dir } of options.url ? [] : options.builds) {
    const outDir = resolve(appRoot, dir);
    if (!existsSync(resolve(outDir, 'index.html'))) {
      throw new Error(`${dir} 里没有构建产物，请先构建（pnpm measure:map-load 会先构建 dist）`);
    }
    // oxlint-disable-next-line no-await-in-loop -- 依次启动，各自分到不同的端口
    const server = await preview({ root: appRoot, logLevel: 'warn', build: { outDir }, preview: { open: false } });
    servers.push(server);
    const baseUrl = server.resolvedUrls?.local[0];
    if (!baseUrl) {
      throw new Error(`${dir} 的预览服务器没有给出地址`);
    }
    targets.push({ name, baseUrl });
  }
  const scenario = options.scenario === 'login' ? '登录到地图' : `切到三维（二维停留 ${options.stay} ms）`;
  console.log(
    `[measure] ${scenario}；${targets.map(({ name, baseUrl }) => `${name} ${baseUrl}`).join('，')}；每档 ${options.runs} 次，登录页停留 ${options.dwell} ms，CPU ${options.cpu}×，${options.channel}${options.mockBackend ? '，假后端' : ''}`
  );
  const results = await measureAll(targets, options);
  report(results);

  const outputDir = resolve(import.meta.dirname, 'results.local');
  mkdirSync(outputDir, { recursive: true });
  const file = resolve(outputDir, `${options.label}-${new Date().toISOString().replaceAll(':', '-')}.json`);
  writeFileSync(file, JSON.stringify({ options: { ...options, url: options.url ?? 'vite preview' }, results }, null, 2));
  console.log(`\n[measure] 原始数据：${file}`);
} catch (error) {
  console.error(`[measure] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await Promise.all(servers.map(server => server.close()));
}
