// 一条命令记录方案 C 和 Cesium 的性能：pnpm measure。说明见 README.md
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { cpus, release, totalmem, type, version } from 'node:os';
import { join } from 'node:path';
import { HELP, parseArgs } from './lib/args.mjs';
import { startStaticServer } from './lib/file-server.mjs';
import { CESIUM_RUNTIME_DIR, LCC2_DIR, LCC_APP_DIR, MODELS_DIR, POC_DIR, REPO_ROOT, ROAM_DIR } from './lib/paths.mjs';
import { checkBasemap, checkFiles, checkRenderer } from './lib/preflight.mjs';
import { redact } from './lib/redact.mjs';
import { renderManual, renderReport } from './lib/report.mjs';
import { runScene, shotName } from './lib/run-scene.mjs';
import { buildRuns, selectRuns } from './lib/scenes.mjs';

const EXIT_MISSING = 1;
const EXIT_SOFTWARE = 2;
const EXIT_BUILD = 3;

function fail(lines, code) {
  console.error(`\n无法开始：\n${lines.map(line => `  ✗ ${line}`).join('\n')}\n`);
  process.exit(code);
}

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  fail([error.message], EXIT_MISSING);
}
if (options.help) {
  console.log(HELP);
  process.exit(0);
}

const allRuns = buildRuns(options);
if (options.list) {
  console.log(allRuns.map(run => `${run.id.padEnd(30)} ${run.scene.title}，${run.variant.label}`).join('\n'));
  process.exit(0);
}
const runs = selectRuns(allRuns, options.only);
if (runs.length === 0) {
  fail([`--only ${options.only.join(',')} 没有选中任何场景，用 --list 看全部场景。`], EXIT_MISSING);
}

// ---------- 启动前检查 ----------

console.log('检查环境……');
const files = await checkFiles(runs, options);
if (files.problems.length > 0) {
  fail(files.problems, EXIT_MISSING);
}
const renderer = await checkRenderer(options);
if (renderer.problems.length > 0) {
  fail(renderer.problems, renderer.renderer?.webgl2 ? EXIT_SOFTWARE : EXIT_MISSING);
}
const { basemap, warning: basemapWarning } = await checkBasemap(options);
options.basemap = basemap;
// 底图可能换了，地址要重新生成
const plannedRuns = selectRuns(buildRuns(options), options.only);

const warnings = [...files.warnings, ...renderer.warnings, ...(basemapWarning ? [basemapWarning] : [])];
for (const warning of warnings) {
  console.warn(`  ! ${warning}`);
}
console.log(`  渲染器：${renderer.renderer.renderer}`);
console.log(`  浏览器：${renderer.renderer.browserKind} ${renderer.renderer.browserVersion}`);

// ---------- 构建 ----------

function build(cwd, label, extraArgs = []) {
  console.log(`构建${label}……`);
  const vite = join(cwd, 'node_modules', 'vite', 'bin', 'vite.js');
  const outcome = spawnSync(process.execPath, [vite, 'build', '--logLevel', 'warn', ...extraArgs], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=3072' }
  });
  if (outcome.status !== 0) {
    fail([`${label}构建失败：\n${redact(`${outcome.stdout}\n${outcome.stderr}`).slice(-2000)}`], EXIT_BUILD);
  }
}

const needsLccBuild = plannedRuns.some(run => run.needsLcc);
if (!options.skipBuild) {
  build(POC_DIR, '方案 C 和 Cesium 的页面');
  if (needsLccBuild) {
    build(LCC_APP_DIR, ' LCC2 页面', ['--base=/lcc2app/']);
  }
}

// ---------- 输出目录和报告 ----------

function pad(value) {
  return String(value).padStart(2, '0');
}

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

const outDir = join(POC_DIR, 'results', timestamp());
const screenshotsDir = join(outDir, 'screenshots');
mkdirSync(screenshotsDir, { recursive: true });

const raw = {
  meta: {
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    commit: gitCommit(),
    finished: false,
    quick: options.quick,
    basemap: options.basemap,
    viewport: options.viewport,
    dpr: options.dpr,
    repeat: options.repeat,
    only: options.only,
    plannedTotal: plannedRuns.length * options.repeat
  },
  environment: {
    gpu: renderer.renderer.renderer,
    gpuVendor: renderer.renderer.vendor,
    webgl: renderer.renderer.version,
    adapters: renderer.adapters,
    cpu: cpus()[0]?.model ?? '未知',
    cores: cpus().length,
    memoryGB: Math.round(totalmem() / 1024 ** 3),
    os: `${type()} ${release()} ${version()}`,
    browserKind: renderer.renderer.browserKind,
    browserVersion: renderer.renderer.browserVersion,
    node: process.version,
    screen: renderer.renderer.screen
  },
  validity: {
    software: renderer.renderer.software,
    integrated: renderer.renderer.integrated,
    uncapped: renderer.renderer.uncapped,
    rafMedianMs: renderer.renderer.rafMedianMs,
    refreshRate: renderer.renderer.refreshRate,
    timerQuery: renderer.renderer.timerQuery
  },
  warnings,
  planned: plannedRuns.map(run => ({
    id: run.id,
    scene: run.scene.id,
    sceneTitle: run.scene.title,
    variant: run.variant.id,
    variantLabel: run.variant.label
  })),
  runs: []
};

function writeAtomic(path, text) {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, text);
  renameSync(temporary, path);
}

/** 每跑完一个场景写一次，中途中断也留得下数据 */
function save() {
  raw.meta.updatedAt = new Date().toISOString();
  writeAtomic(join(outDir, 'raw.json'), redact(JSON.stringify(raw, null, 1)));
  writeAtomic(join(outDir, 'report.md'), redact(renderReport(raw)));
  writeAtomic(join(outDir, 'manual.md'), redact(renderManual(raw)));
}
save();

// ---------- 运行 ----------

const server = await startStaticServer(options.port, {
  '/lcc2app/': join(LCC_APP_DIR, 'dist'),
  '/3dt/': MODELS_DIR,
  '/roam/': ROAM_DIR,
  '/cesium/': CESIUM_RUNTIME_DIR,
  '/lcc2/': LCC2_DIR,
  '/': join(POC_DIR, 'dist')
});

let stopping = false;
process.on('SIGINT', () => {
  if (stopping) {
    process.exit(130);
  }
  stopping = true;
  console.log('\n收到中断：当前场景结束后写报告退出。再按一次立刻退出。');
});

const startedAt = Date.now();
const deadline = startedAt + options.maxMinutes * 60000;
const total = plannedRuns.length * options.repeat;
let finished = 0;

const minutes = ms => `${(ms / 60000).toFixed(1)} 分钟`;

try {
  outer: for (let repeat = 0; repeat < options.repeat; repeat += 1) {
    for (const run of plannedRuns) {
      if (stopping) {
        break outer;
      }
      if (Date.now() > deadline) {
        raw.warnings.push(`到了 --max-minutes ${options.maxMinutes} 的上限，后面的场景没有跑，可以用 --only 补测。`);
        console.warn(`到了 ${options.maxMinutes} 分钟的上限，不再开始新场景。`);
        break outer;
      }
      const elapsed = Date.now() - startedAt;
      const remaining = finished > 0 ? (elapsed / finished) * (total - finished) : null;
      console.log(`\n[${finished + 1}/${total}] ${run.id}（${run.scene.title}，${run.variant.label}）  已用 ${minutes(elapsed)}${remaining === null ? '' : `，预计还要 ${minutes(remaining)}`}`);
      const result = await runScene(run, repeat, {
        options,
        baseUrl: server.url,
        screenshotsDir,
        progress: phase => console.log(`    ${phase}`)
      });
      result.shot = shotName(run, repeat);
      raw.runs.push(result);
      finished += 1;
      save();
      const flight = result.flightCold?.frame;
      console.log(
        result.status === 'failed'
          ? `    失败：${result.error}（已记录，继续下一个）`
          : `    ${result.status}，到稳定 ${((result.load?.ttStableMs ?? 0) / 1000).toFixed(1)} 秒，飞行 p95 ${flight?.p95?.toFixed(1) ?? '—'} 毫秒，long task 最长 ${Math.round(result.flightCold?.longTasks?.maxMs ?? 0)} 毫秒`
      );
    }
  }
} finally {
  raw.meta.finished = !stopping && finished === total;
  save();
  await server.close();
}

const counts = raw.runs.reduce((map, run) => ({ ...map, [run.status]: (map[run.status] ?? 0) + 1 }), {});
console.log(`\n完成 ${finished}/${total}，用时 ${minutes(Date.now() - startedAt)}：${JSON.stringify(counts)}`);
console.log(`结果目录：${redact(outDir)}`);
console.log('把整个结果目录带回来，并填好里面的 manual.md（先运行 pnpm manual）。');
// Playwright 的连接可能还留着句柄，明确退出，不留进程
process.exit(raw.runs.length > 0 && raw.runs.every(run => run.status === 'failed') ? 4 : 0);
