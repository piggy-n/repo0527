// Cesium 上叠一块 Three.js 画布画 LCC2 的复测：pnpm overlay。说明见 CESIUM-OVERLAY.md
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { join } from 'node:path';
import { gpuProcessId, launchBrowser, sampleGpuMemory } from './lib/browser.mjs';
import { startStaticServer } from './lib/file-server.mjs';
import { renderOverlayReport } from './lib/overlay-report.mjs';
import { LCC2_DIR, LCC_APP_DIR, LCC_CESIUM_RUNTIME_DIR, listLccFiles, MODELS_DIR, POC_DIR, REPO_ROOT } from './lib/paths.mjs';
import { checkRenderer } from './lib/preflight.mjs';
import { redact } from './lib/redact.mjs';

const HELP = `用法：pnpm overlay [选项]

  --only a,b            只跑部分项目：align、lag、rtc、occlusion、underground、memory、perf
  --budget N            俯瞰时泼溅的预算，默认 3000000
  --fp-budget N         第一人称时的预算，默认和 --budget 相同
  --viewport WxH        视口，默认 1600x900
  --basemap arcgis|none 底图，默认 arcgis
  --quick               缩短运动和计时的时长，只用来确认脚本能跑
  --allow-software      允许软件渲染（结果里的耗时没有意义）
  --headless            不显示窗口
  --url <地址>          用已经在跑的开发服务（如 http://localhost:5283），不构建
  --skip-build          用上一次的构建产物
  --port N              静态服务的端口，默认 5391
  --help                显示这段说明`;

const SCENES = ['align', 'lag', 'rtc', 'occlusion', 'underground', 'memory', 'perf'];

function parse(argv) {
  const options = {
    only: SCENES,
    budget: 3000000,
    fpBudget: null,
    viewport: { width: 1600, height: 900 },
    basemap: 'arcgis',
    quick: false,
    allowSoftware: false,
    headless: false,
    manual: false,
    url: null,
    skipBuild: false,
    port: 5391,
    help: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const name = argv[i];
    const value = () => {
      i += 1;
      if (argv[i] === undefined) {
        throw new Error(`${name} 后面缺一个值`);
      }
      return argv[i];
    };
    if (name === '--only') {
      options.only = value().split(',').filter(Boolean);
      const unknown = options.only.filter(item => !SCENES.includes(item));
      if (unknown.length > 0) {
        throw new Error(`--only 里有不认识的项目：${unknown.join('、')}。可选：${SCENES.join('、')}`);
      }
    } else if (name === '--budget') {
      options.budget = Number(value());
    } else if (name === '--fp-budget') {
      options.fpBudget = Number(value());
    } else if (name === '--viewport') {
      const [width, height] = value().split('x').map(Number);
      options.viewport = { width, height };
    } else if (name === '--basemap') {
      options.basemap = value();
    } else if (name === '--url') {
      options.url = value().replace(/\/$/, '');
    } else if (name === '--port') {
      options.port = Number(value());
    } else if (name === '--quick') {
      options.quick = true;
    } else if (name === '--allow-software') {
      options.allowSoftware = true;
    } else if (name === '--headless') {
      options.headless = true;
    } else if (name === '--skip-build') {
      options.skipBuild = true;
    } else if (name === '--help' || name === '-h') {
      options.help = true;
    } else {
      throw new Error(`不认识的选项：${name}\n\n${HELP}`);
    }
  }
  options.fpBudget ??= options.budget;
  return options;
}

function fail(lines, code = 1) {
  console.error(`\n无法开始：\n${lines.map(line => `  ✗ ${line}`).join('\n')}\n`);
  process.exit(code);
}

let options;
try {
  options = parse(process.argv.slice(2));
} catch (error) {
  fail([error.message]);
}
if (options.help) {
  console.log(HELP);
  process.exit(0);
}

// ---------- 启动前检查 ----------

console.log('检查环境……');
const problems = [];
if (!options.url) {
  for (const name of ['cesium', 'gaussian-splat-lite', 'three', 'vite']) {
    if (!existsSync(join(LCC_APP_DIR, 'node_modules', name))) {
      problems.push(`LCC2 工程的依赖没有安装（缺 ${name}）。在这个目录运行：pnpm -C lcc2 install --ignore-workspace --config.strictDepBuilds=false`);
      break;
    }
  }
  if (!existsSync(join(MODELS_DIR, 'XZ_GC_3DT', 'tileset.json'))) {
    problems.push(`找不到倾斜模型：${join(MODELS_DIR, 'XZ_GC_3DT')}。把 3dt 目录复制到仓库根的 local/3dt，或设置环境变量 YZT_LOCAL_DIR。`);
  }
  if (listLccFiles().length === 0) {
    problems.push(`样例目录里没有 .lcc2 文件：${LCC2_DIR}。把样例复制到仓库根的 local/lcc2/render2，或设置环境变量 LCC2_DIR。`);
  }
}
if (problems.length > 0) {
  fail(problems);
}
const renderer = await checkRenderer(options);
if (renderer.problems.length > 0) {
  fail(renderer.problems, 2);
}
for (const warning of renderer.warnings) {
  console.warn(`  ! ${warning}`);
}
console.log(`  渲染器：${renderer.renderer.renderer}`);

// ---------- 构建和服务 ----------

let server = null;
let pageBase = options.url;
if (!options.url) {
  if (!options.skipBuild) {
    console.log('构建 LCC2 工程的页面……');
    const vite = join(LCC_APP_DIR, 'node_modules', 'vite', 'bin', 'vite.js');
    const outcome = spawnSync(process.execPath, [vite, 'build', '--logLevel', 'warn', '--base=/lcc2app/'], {
      cwd: LCC_APP_DIR,
      encoding: 'utf8',
      env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=3072' }
    });
    if (outcome.status !== 0) {
      fail([`构建失败：\n${redact(`${outcome.stdout}\n${outcome.stderr}`).slice(-2000)}`], 3);
    }
  }
  server = await startStaticServer(options.port, {
    '/lcc2app/': join(LCC_APP_DIR, 'dist'),
    '/3dt/': MODELS_DIR,
    '/cesium/': LCC_CESIUM_RUNTIME_DIR,
    '/lcc2/': LCC2_DIR
  });
  pageBase = `${server.url}/lcc2app`;
}

// ---------- 输出 ----------

const pad = value => String(value).padStart(2, '0');
function timestamp(date = new Date()) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

const outDir = join(POC_DIR, 'results', `overlay-${timestamp()}`);
const shotsDir = join(outDir, 'screenshots');
mkdirSync(shotsDir, { recursive: true });

const raw = {
  meta: {
    startedAt: new Date().toISOString(),
    commit: gitCommit(),
    finished: false,
    quick: options.quick,
    only: options.only,
    budget: options.budget,
    fpBudget: options.fpBudget,
    viewport: options.viewport,
    basemap: options.basemap,
    devServer: Boolean(options.url)
  },
  environment: {
    gpu: renderer.renderer.renderer,
    software: renderer.renderer.software,
    uncapped: renderer.renderer.uncapped,
    timerQuery: renderer.renderer.timerQuery,
    adapters: renderer.adapters,
    browser: `${renderer.renderer.browserKind} ${renderer.renderer.browserVersion}`,
    cpu: cpus()[0]?.model ?? '未知',
    memoryGB: Math.round(totalmem() / 1024 ** 3)
  },
  scenes: {}
};

function save() {
  const write = (name, text) => {
    const path = join(outDir, name);
    writeFileSync(`${path}.tmp`, text);
    renameSync(`${path}.tmp`, path);
  };
  write('raw.json', redact(JSON.stringify(raw, null, 1)));
  write('report.md', redact(renderOverlayReport(raw)));
}
save();

// ---------- 页面 ----------

const { browser } = await launchBrowser(options);
const gpuPid = await gpuProcessId(browser);
const LOAD_TIMEOUT_MS = 300000;

async function openPage(query) {
  const context = await browser.newContext({ viewport: options.viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') {
      consoleErrors.push(redact(message.text()).slice(0, 300));
    }
  });
  page.on('pageerror', error => consoleErrors.push(`pageerror: ${redact(error.message)}`.slice(0, 300)));
  const search = new URLSearchParams({ bench: '1', basemap: options.basemap, ...query });
  await page.goto(`${pageBase}/cesium.html?${search}`, { waitUntil: 'domcontentloaded', timeout: LOAD_TIMEOUT_MS });
  await page.waitForFunction(() => window.ovReady === true, null, { timeout: LOAD_TIMEOUT_MS, polling: 500 });
  const shot = async name => {
    await page.screenshot({ path: join(shotsDir, `${name}.png`), timeout: 120000, animations: 'allow' });
    return `${name}.png`;
  };
  const close = async () => {
    await context.close().catch(() => {});
  };
  return { page, context, shot, close, consoleErrors };
}

const settle = page => page.evaluate(() => window.ov.settle(240000));
const wait = (page, ms) => page.waitForTimeout(ms);
const errorsOf = page => page.evaluate(() => window.ov.errors.slice(0, 20));

// ---------- 项目 ----------

/** 位置是否一致：静止几个视角、转动缩放倾斜、改窗口大小和设备像素比、按需渲染时两边的重画次数 */
async function align() {
  const { page, context, shot, close, consoleErrors } = await openPage({ markers: '1', budget: String(options.budget) });
  const out = { settled: await settle(page), poses: [], motion: {}, shots: [] };
  const poses = [
    ['俯瞰 45°', 0, -45, 420],
    ['低角度 15°', 60, -15, 320],
    ['正俯视', 0, -89, 500],
    ['近处', 135, -30, 90]
  ];
  for (const [label, heading, pitch, range] of poses) {
    out.poses.push(
      await page.evaluate(
        async ([name, h, p, r]) => {
          const { ov } = window;
          ov.lookAtLocal(ov.boxCenter[0], ov.boxCenter[1], ov.plazaZ, h, p, r);
          await ov.frames(3);
          const rendered = await ov.measureMarkers();
          return { label: name, projectionMaxPx: ov.projectionError().max, renderedMaxPx: rendered.max, markersFound: rendered.found };
        },
        [label, heading, pitch, range]
      )
    );
  }
  const steps = options.quick ? 10 : 40;
  out.motion.orbit = await page.evaluate(frames => window.ov.motionTest({ kind: 'orbit', frames, step: 3 }), steps);
  out.motion.dolly = await page.evaluate(frames => window.ov.motionTest({ kind: 'dolly', frames, step: 0.95 }), Math.ceil(steps / 2));
  out.motion.tilt = await page.evaluate(frames => window.ov.motionTest({ kind: 'tilt', frames, step: -2 }), Math.ceil(steps / 2));

  // 按需渲染：静止时两边都不该重画；动一下相机，两边在同一帧各画一次
  await page.evaluate(() => {
    const { ov } = window;
    ov.lookAtLocal(ov.boxCenter[0], ov.boxCenter[1], ov.plazaZ, 0, -45, 420);
  });
  await settle(page);
  const counts = () => page.evaluate(() => ({ cesium: window.ov.stats().cesiumRenders, overlay: window.ov.stats().overlayRenders, frame: window.ov.stats().frame }));
  const idleBefore = await counts();
  await wait(page, 3000);
  const idleAfter = await counts();
  await page.evaluate(async () => {
    const { ov } = window;
    ov.lookAtLocal(ov.boxCenter[0], ov.boxCenter[1], ov.plazaZ, 0.5, -45, 420);
    await ov.frames(2);
  });
  const nudged = await counts();
  out.onDemand = {
    idleFrames: idleAfter.frame - idleBefore.frame,
    idleCesiumRenders: idleAfter.cesium - idleBefore.cesium,
    idleOverlayRenders: idleAfter.overlay - idleBefore.overlay,
    nudgeCesiumRenders: nudged.cesium - idleAfter.cesium,
    nudgeOverlayRenders: nudged.overlay - idleAfter.overlay
  };
  await settle(page);
  out.shots.push(await shot('align-splat'));
  await page.evaluate(async () => {
    window.ov.setSplatVisible(false);
    await window.ov.frames(3);
  });
  out.shots.push(await shot('align-markers'));
  await page.evaluate(() => window.ov.setSplatVisible(true));

  // 窗口大小和设备像素比
  const sizes = async label => ({
    label,
    ...(await page.evaluate(async () => {
      const { ov } = window;
      await ov.frames(6);
      const stats = ov.stats();
      const rendered = await ov.measureMarkers(Math.round(20 * window.devicePixelRatio));
      return { dpr: stats.dpr, cesiumCanvas: stats.canvas, overlayCanvas: stats.overlayCanvas, projectionMaxPx: ov.projectionError().max, renderedMaxPx: rendered.max, markersFound: rendered.found };
    }))
  });
  out.resize = [await sizes('开始')];
  const small = { width: Math.round(options.viewport.width * 0.7), height: Math.round(options.viewport.height * 0.8) };
  await page.setViewportSize(small);
  out.resize.push(await sizes(`窗口改成 ${small.width}×${small.height}`));
  const session = await context.newCDPSession(page);
  await session.send('Emulation.setDeviceMetricsOverride', { ...small, deviceScaleFactor: 2, mobile: false });
  out.resize.push(await sizes('设备像素比改成 2'));
  await session.send('Emulation.clearDeviceMetricsOverride');
  await page.setViewportSize(options.viewport);
  out.resize.push(await sizes('改回来'));
  out.viewMismatches = await page.evaluate(() => window.ov.stats().viewMismatches);
  out.errors = [...(await errorsOf(page)), ...consoleErrors];
  await close();
  return out;
}

/** 对照：Three 故意用上一帧的相机画（两边各跑各的 requestAnimationFrame、顺序不巧时就是这样） */
async function lag() {
  const { page, close, consoleErrors } = await openPage({ markers: '1', sync: 'lag', budget: String(options.budget) });
  const out = { settled: await settle(page) };
  out.orbit = await page.evaluate(frames => window.ov.motionTest({ kind: 'orbit', frames, step: 3, radius: 70 }), options.quick ? 10 : 30);
  out.errors = [...(await errorsOf(page)), ...consoleErrors];
  await close();
  return out;
}

function meanAbsDifference(a, b) {
  let total = 0;
  for (let i = 0; i < a.length; i += 1) {
    total += Math.abs(a[i] - b[i]);
  }
  return Number((total / a.length).toFixed(3));
}

/**
 * 相对中心的坐标有没有必要：同一个近处视角，Three 的世界分别用局部坐标和地心坐标，比两次的画面；
 * 再每次横挪 2 毫米，看相邻两帧的画面差多少（坐标精度不够时会一跳一跳）。画面缩到 320×200 的灰度再比
 */
async function rtc() {
  const eye = [120, 80, -31.72, 0, 0];
  const out = { modes: {}, shots: [] };
  const images = {};
  for (const [key, value] of [
    ['local', '1'],
    ['ecef', '0']
  ]) {
    const { page, shot, close, consoleErrors } = await openPage({ markers: '0', tiles: '0', rtc: value, budget: String(options.fpBudget), eye: eye.join(',') });
    const settled = await settle(page);
    const data = await page.evaluate(
      async ([x, y, z, heading, pitch]) => {
        const { ov } = window;
        const frames = [await ov.grabOverlay(320, 200)];
        for (let i = 1; i <= 8; i += 1) {
          ov.setLocalEye(x + i * 0.002, y, z, heading, pitch);
          await ov.frames(3);
          frames.push(await ov.grabOverlay(320, 200));
        }
        ov.setLocalEye(x, y, z, heading, pitch);
        return frames;
      },
      eye
    );
    images[key] = data[0];
    const steps = data.slice(1).map((frame, i) => meanAbsDifference(data[i], frame));
    out.shots.push(await shot(`rtc-${key}`));
    // 第一帧和最后一帧隔了 16 毫米：比相邻两帧的差大得多，说明量到的是画面在动，不是噪声
    const firstToLast = meanAbsDifference(data[0], data.at(-1));
    out.modes[key] = { settled, stepDifferences: steps, maxStep: Math.max(...steps), firstToLast, errors: [...(await errorsOf(page)), ...consoleErrors] };
    await close();
  }
  out.differenceBetweenModes = meanAbsDifference(images.local, images.ecef);
  out.errors = [...out.modes.local.errors, ...out.modes.ecef.errors];
  return out;
}

const OCCLUSION_MODES = ['none', 'depth', 'proxy'];

/** 遮挡：Cesium 里的方块、下沉到模型地面以下的泼溅、沉到地球表面以下的泼溅，三种做法各截一张 */
async function occlusion() {
  const { page, shot, close, consoleErrors } = await openPage({ markers: '0', budget: String(options.budget) });
  const out = { settled: await settle(page), modes: {}, shots: [] };
  const view = () =>
    page.evaluate(() => {
      const { ov } = window;
      ov.lookAtLocal(ov.boxCenter[0], ov.boxCenter[1], ov.plazaZ, 20, -22, 330);
    });
  const coverage = () => page.evaluate(() => window.ov.measureCoverage());
  const lift = await page.evaluate(() => window.ov.placement.lift);
  await view();
  await settle(page);
  for (const mode of OCCLUSION_MODES) {
    const result = {};
    await page.evaluate(value => window.ov.setOcclusion(value), mode);
    // 一、Cesium 里放一个 30 米的红方块，立在广场上
    await page.evaluate(() => {
      const { ov } = window;
      ov.addCesiumBox(ov.boxCenter[0] - 10, ov.boxCenter[1] - 60, ov.plazaZ + 15, 30);
    });
    result.boxSettled = await settle(page);
    result.box = await coverage();
    out.shots.push(await shot(`occ-box-${mode}`));
    if (mode === 'none') {
      await page.evaluate(async () => {
        window.ov.setSplatVisible(false);
        await window.ov.frames(3);
      });
      out.shots.push(await shot('occ-box-cesium-only'));
      await page.evaluate(() => window.ov.setSplatVisible(true));
    }
    await page.evaluate(() => window.ov.clearCesiumBoxes());
    // 二、泼溅整体下沉 15 米：本该被倾斜模型的地面挡住大半
    await page.evaluate(value => window.ov.setPlacement({ lift: value - 15 }), lift);
    result.sunkSettled = await settle(page);
    result.sunk = await coverage();
    out.shots.push(await shot(`occ-sunk-${mode}`));
    // 三、隐藏倾斜模型，泼溅沉到椭球面以下。Cesium 默认不拿地表挡自己的模型（depthTestAgainstTerrain 是 false），
    // 所以要打开它才有"地面挡住地下"这回事；应用里钻地时是打开的。代理模型里没有地球，这一项不测
    if (mode !== 'proxy') {
      await page.evaluate(() => {
        window.ov.setTilesVisible(false);
        window.ov.setGroundDepthTest(true);
        window.ov.setPlacement({ lift: -45 });
      });
      // 相机跟着看向沉下去的位置，仍然在地面以上
      await view();
      result.groundSettled = await settle(page);
      result.ground = await coverage();
      out.shots.push(await shot(`occ-ground-${mode}`));
      await page.evaluate(() => {
        window.ov.setGroundDepthTest(false);
        window.ov.setTilesVisible(true);
      });
    }
    await page.evaluate(value => window.ov.setPlacement({ lift: value }), lift);
    await view();
    await settle(page);
    result.stats = await page.evaluate(() => window.ov.stats());
    out.modes[mode] = result;
  }
  out.errors = [...(await errorsOf(page)), ...consoleErrors];
  await close();
  return out;
}

/** 第一人称站在下沉广场里；再把数据放回原始高度，相机落到椭球面以下 */
async function underground() {
  const eye = [120, 80, -31.72, 0, 0];
  const { page, shot, close, consoleErrors } = await openPage({ markers: '0', budget: String(options.fpBudget), eye: eye.join(',') });
  const out = { settled: await settle(page), shots: [] };
  // 标记这时都在画面外，对齐改比眼前的几个点（配准后的局部坐标）
  const ahead = [
    [120, 84, -31.2],
    [118.5, 88, -30.5],
    [122, 95, -29],
    [120, 110, -31.7],
    [116, 130, -27]
  ];
  const projection = () => page.evaluate(points => window.ov.projectionError(points), ahead);
  out.overlay = { ...(await page.evaluate(async () => ({ stats: window.ov.stats(), coverage: await window.ov.measureCoverage() }))), projection: await projection() };
  out.shots.push(await shot('fp-overlay'));
  await page.evaluate(async () => {
    window.ov.setSplatVisible(false);
    await window.ov.frames(3);
  });
  out.shots.push(await shot('fp-cesium-only'));
  await page.evaluate(() => window.ov.setSplatVisible(true));
  await page.evaluate(() => window.ov.setOcclusion('depth'));
  out.depthSettled = await settle(page);
  out.depth = await page.evaluate(async () => ({ coverage: await window.ov.measureCoverage() }));
  out.shots.push(await shot('fp-depth'));
  await page.evaluate(() => window.ov.setOcclusion('none'));

  // 往前走几步，每步 0.5 米：看每一步两边各画多久（软件渲染下只说明能走）
  out.walk = await page.evaluate(
    async ([x, y, z, heading, pitch, steps]) => {
      const { ov } = window;
      ov.perf.reset();
      for (let i = 1; i <= steps; i += 1) {
        ov.setLocalEye(x, y + i * 0.5, z, heading, pitch);
        await ov.frames(2);
      }
      return { steps, perf: ov.perf.summary() };
    },
    [...eye, options.quick ? 4 : 12]
  );

  // 数据放回原始高度（地下几层这时在椭球面以下），打开应用里的钻地：地表半透明，相机可以进到地球表面以下
  await page.evaluate(() => {
    const { ov } = window;
    ov.setTilesVisible(false);
    ov.setPlacement({ lift: 0 });
    ov.setUnderground(true);
    ov.lookAtLocal(ov.boxCenter[0], ov.boxCenter[1], ov.plazaZ, 20, -30, 260);
  });
  out.aboveSettled = await settle(page);
  out.shots.push(await shot('ug-from-above'));
  // 相机在椭球面以下 1.85 米，Cesium 这边是真的"在地下"
  await page.evaluate(([x, y, z, heading, pitch]) => window.ov.setLocalEye(x, y, z, heading, pitch), eye);
  out.belowSettled = await settle(page);
  out.below = { cameraHeight: await page.evaluate(() => window.ov.stats().cameraHeight), projection: await projection() };
  out.shots.push(await shot('ug-first-person'));
  await page.evaluate(async () => {
    window.ov.setSplatVisible(false);
    await window.ov.frames(3);
  });
  out.shots.push(await shot('ug-first-person-cesium-only'));
  out.errors = [...(await errorsOf(page)), ...consoleErrors];
  await close();
  return out;
}

/** 两个上下文各申请了多少显存：只有 Cesium、加上空的 Three 画布、加上泼溅、再开两种缓解办法 */
async function memory() {
  const { page, close, consoleErrors } = await openPage({ markers: '0', glmem: '1', defer: '1', budget: String(options.budget) });
  const out = { stages: [] };
  const stage = async label => {
    const settled = await settle(page);
    const data = await page.evaluate(() => ({ gl: window.ov.glMemoryReport(), stats: window.ov.stats() }));
    out.stages.push({ label, settled, ...data, gpuProcess: await sampleGpuMemory(gpuPid) });
  };
  await stage('只有 Cesium 和倾斜模型');
  await page.evaluate(() => window.ov.start({ splat: false }));
  await stage('加一块空的 Three 画布');
  await page.evaluate(budget => window.ov.addLcc(budget), options.budget);
  await stage('加载泼溅');
  await page.evaluate(() => window.ov.setOcclusion('depth'));
  await stage('缓解：读 Cesium 的深度');
  await page.evaluate(() => window.ov.setOcclusion('proxy'));
  await stage('缓解：Three 里再加载一份倾斜模型');
  out.errors = [...(await errorsOf(page)), ...consoleErrors];
  await close();
  return out;
}

/** 每帧的成本：只有 Cesium、叠上泼溅、两种缓解办法；静止时每帧强制重画，再转一圈 */
async function perf() {
  const { page, close, consoleErrors } = await openPage({ markers: '0', timers: '1', pace: '1', defer: '1', budget: String(options.budget) });
  const out = { stages: [] };
  const staticMs = options.quick ? 2000 : 6000;
  const spinSeconds = options.quick ? 3 : 10;
  const stage = async label => {
    const settled = await settle(page);
    await page.evaluate(() => {
      window.ov.setContinuous(true);
      window.ov.perf.reset();
    });
    await wait(page, staticMs);
    const still = await page.evaluate(() => window.ov.perf.summary());
    const spin = await page.evaluate(async seconds => {
      window.ov.perf.reset();
      await window.ov.spin(seconds, 20);
      return window.ov.perf.summary();
    }, spinSeconds);
    await page.evaluate(() => {
      const { ov } = window;
      ov.setContinuous(false);
      ov.lookAtLocal(ov.boxCenter[0], ov.boxCenter[1], ov.plazaZ, 0, -35, 300);
    });
    out.stages.push({ label, settled, still, spin, stats: await page.evaluate(() => window.ov.stats()) });
  };
  await page.evaluate(() => {
    const { ov } = window;
    ov.lookAtLocal(ov.boxCenter[0], ov.boxCenter[1], ov.plazaZ, 0, -35, 300);
  });
  await stage('只有 Cesium 和倾斜模型');
  await page.evaluate(() => window.ov.start());
  await stage('叠上泼溅，不处理遮挡');
  await page.evaluate(() => window.ov.setOcclusion('depth'));
  await stage('缓解：读 Cesium 的深度');
  await page.evaluate(() => window.ov.setOcclusion('proxy'));
  await stage('缓解：Three 里再加载一份倾斜模型');
  out.errors = [...(await errorsOf(page)), ...consoleErrors];
  await close();
  return out;
}

const RUNNERS = { align, lag, rtc, occlusion, underground, memory, perf };

// ---------- 运行 ----------

const startedAt = Date.now();
try {
  for (const name of options.only) {
    console.log(`\n[${name}] 开始，已用 ${((Date.now() - startedAt) / 60000).toFixed(1)} 分钟`);
    try {
      raw.scenes[name] = { status: 'ok', ...(await RUNNERS[name]()) };
      console.log(`[${name}] 完成`);
    } catch (error) {
      raw.scenes[name] = { status: 'failed', error: redact(String(error?.message ?? error)).slice(0, 600) };
      console.log(`[${name}] 失败：${raw.scenes[name].error}（已记录，继续下一个）`);
    }
    save();
  }
  raw.meta.finished = true;
} finally {
  raw.meta.minutes = Number(((Date.now() - startedAt) / 60000).toFixed(1));
  save();
  await browser.close().catch(() => {});
  await server?.close();
}
console.log(`\n结果目录：${redact(outDir)}`);
console.log('把整个结果目录带回来。不要提交到公开的仓库。');
process.exit(0);
