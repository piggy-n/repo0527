import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { cpus, release, totalmem, type, version } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'vite';
import { localPath } from '../local-files/paths.ts';
import { INTEGRATED_RENDERER, launchBrowser, listAdapters, probeRenderer, SOFTWARE_RENDERER } from './browser.ts';
import { HELP, type Options, parseOptions } from './options.ts';
import { createRedactor } from './redact.ts';
import { renderManual, renderQualityPage, renderReport } from './report.ts';
import type { Environment, MeasureResults, SceneQuality } from './results.ts';
import { runOnce } from './run.ts';
import { buildRuns, type Run, SCENES, selectScenes, variants } from './scenes.ts';
import { startServer } from './server.ts';
import type { SharpnessComparison } from './sharpness.ts';
import { PAGE_OUT_DIR } from './vite.config.ts';

// MapLibre 引擎和 Cesium 的性能对比（ADR 0147 3C.4）：在 apps/yzt 下运行 pnpm measure:3d，步骤见 docs/modules/map-three.md"性能验收"

const appRoot = resolve(import.meta.dirname, '../..');
const repoRoot = resolve(appRoot, '../..');
const redact = createRedactor(repoRoot);
const modelsDir = localPath('3dt');
const modelsProxy = process.env.YZT_3DT_PROXY || null;

const stripImages = ({ cells, medianRatio, worstDecileRatio, ratios }: SharpnessComparison): SharpnessComparison => ({
  cells,
  medianRatio,
  worstDecileRatio,
  ratios
});
const minutes = (ms: number) => `${(ms / 60000).toFixed(1)} 分钟`;

function fail(lines: readonly string[]): never {
  console.error(`\n无法开始：\n${lines.map(line => `  ✗ ${line}`).join('\n')}\n`);
  process.exit(1);
}

function parse(): Options {
  try {
    return parseOptions(process.argv.slice(2));
  } catch (error) {
    return fail([String(error instanceof Error ? error.message : error)]);
  }
}

const options = parse();
if (options.help) {
  console.log(HELP);
  process.exit(0);
}
const scenes = selectScenes(options.only);
const list = variants(options.uploadMBs);
if (options.list) {
  for (const scene of SCENES) {
    console.log(`${scene.id.padEnd(22)} ${scene.title}${scene.acceptance ? '（验收）' : ''}`);
  }
  process.exit(0);
}
if (scenes.length === 0) {
  fail([`--only ${options.only.join(',')} 没有选中任何场景，用 --list 看全部场景。`]);
}

// ---------- 启动前检查 ----------

function portFree(port: number): Promise<boolean> {
  return new Promise(done => {
    const probe = createServer();
    probe.once('error', () => done(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => done(true)));
  });
}

// 地址写错、服务器没开时在这里停下，不要等第一遍超时
async function checkModelServer(server: string, paths: readonly string[]): Promise<string[]> {
  const problems = await Promise.all(
    paths.map(async path => {
      try {
        const response = await fetch(new URL(`/3dt/${path}`, server), { signal: AbortSignal.timeout(15000) });
        await response.body?.cancel();
        return response.ok ? null : `模型服务器上取不到 ${path}：HTTP ${response.status}。检查 YZT_3DT_PROXY（${server}）。`;
      } catch (error) {
        return `模型服务器访问不了：${server}（${String(error)}）。检查 YZT_3DT_PROXY 和网络。`;
      }
    })
  );
  return [...new Set(problems.filter(problem => problem !== null))];
}

async function checkFiles(): Promise<void> {
  const problems: string[] = [];
  const paths = [...new Set(scenes.flatMap(scene => scene.models.map(model => model.path)))];
  if (modelsProxy) {
    problems.push(...(await checkModelServer(modelsProxy, paths)));
  } else {
    const missing = paths.filter(path => !existsSync(join(modelsDir, path)));
    if (missing.length > 0) {
      problems.push(
        `模型目录里缺文件：${missing.join('、')}。\n    模型目录：${redact(modelsDir)}\n    把模型放到 local/3dt，或设置 YZT_LOCAL_DIR；模型在服务器上时设置 YZT_3DT_PROXY。`
      );
    }
  }
  if (!(await portFree(options.port))) {
    problems.push(`端口 ${options.port} 被占用。关掉占用它的程序，或用 --port 换一个。`);
  }
  if (problems.length > 0) {
    fail(problems);
  }
}

async function checkBasemap(): Promise<{ basemap: 'arcgis' | 'none'; warning: string | null }> {
  if (options.basemap === 'none') {
    return { basemap: 'none', warning: null };
  }
  try {
    const response = await fetch('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/0/0/0', {
      signal: AbortSignal.timeout(8000)
    });
    return response.ok
      ? { basemap: 'arcgis', warning: null }
      : { basemap: 'none', warning: `ArcGIS 影像返回 ${response.status}，改用无底图（两个引擎相同）。` };
  } catch {
    return { basemap: 'none', warning: 'ArcGIS 影像访问不了，改用无底图（两个引擎相同）。' };
  }
}

async function checkRenderer(warnings: string[]): Promise<Environment> {
  const adapters = await listAdapters();
  const info = await probeRenderer(options).catch((error: unknown) => fail([String(error instanceof Error ? error.message : error)]));
  if (!info.webgl2) {
    fail(['这个浏览器拿不到 WebGL2，测不了。']);
  }
  const software = SOFTWARE_RENDERER.test(info.renderer);
  if (software && !options.allowSoftware) {
    fail([
      `现在用的是软件渲染：${info.renderer}\n    这种结果没有意义，已经停下。请更新显卡驱动，确认不是在远程桌面或虚拟机里运行。\n    只想确认脚本能跑时加 --allow-software，结果会标为无效。`
    ]);
  }
  if (software) {
    warnings.push(`软件渲染：${info.renderer}。这次的帧时间无效，只用来确认脚本能跑。`);
  }
  const integrated = !software && INTEGRATED_RENDERER.test(info.renderer);
  if (integrated) {
    warnings.push(
      adapters.length > 1
        ? `这台机器有 ${adapters.length} 块显卡，现在用的却是集显：${info.renderer}。到 Windows 设置 → 系统 → 显示 → 图形，把浏览器设为"高性能"再运行。`
        : `现在用的是集显：${info.renderer}。`
    );
  }
  return {
    gpu: info.renderer,
    software,
    integrated,
    browser: info.browser,
    adapters,
    cpu: `${cpus()[0]?.model ?? '未知'}，${cpus().length} 线程`,
    memoryGB: Math.round(totalmem() / 1024 ** 3),
    os: `${type()} ${release()} ${version()}`,
    node: process.version,
    gpuTimer: info.timerQuery,
    floorMs: info.floorMs
  };
}

function gitCommit(): string | null {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

const pad = (value: number) => String(value).padStart(2, '0');
function timestamp(date = new Date()): string {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

// ---------- 对比截图 ----------

interface PageComparison extends SharpnessComparison {
  readonly heatmap: string;
  readonly worstCrops: string;
}

async function compareScenes(results: MeasureResults, outDir: string, baseUrl: string): Promise<void> {
  const pairs = results.scenes.flatMap(scene => {
    const qualityOf = (variant: string) => results.runs.find(run => run.scene === scene.id && run.variant === variant && run.kind === 'quality')?.quality;
    const subject = qualityOf('maplibre');
    const reference = qualityOf('cesium');
    return subject && reference ? [{ scene: scene.id, subject, reference }] : [];
  });
  if (pairs.length === 0) {
    return;
  }
  const { browser } = await launchBrowser(options);
  try {
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/compare.html`);
    await page.waitForFunction('typeof window.compareShots === "function"');
    const read = (file: string) => readFileSync(join(outDir, file)).toString('base64');
    const compare = (subject: string, reference: string, withoutModel: string) =>
      page.evaluate<PageComparison>(`window.compareShots(${JSON.stringify(read(subject))}, ${JSON.stringify(read(reference))}, ${JSON.stringify(read(withoutModel))})`);
    for (const { scene, subject, reference } of pairs) {
      // oxlint-disable-next-line no-await-in-loop -- 一对一对地比，内存里同时只有两张图
      const stable = await compare(subject.shot, reference.shot, reference.shotWithoutModel);
      const heatmap = `shots/${scene}-heatmap.png`;
      const worstCrops = `shots/${scene}-worst.png`;
      writeFileSync(join(outDir, heatmap), Buffer.from(stable.heatmap, 'base64'));
      writeFileSync(join(outDir, worstCrops), Buffer.from(stable.worstCrops, 'base64'));
      const { shotAfterFlight: subjectEnd } = subject;
      const { shotAfterFlight: referenceEnd } = reference;
      const afterFlight =
        subjectEnd && referenceEnd
          ? // oxlint-disable-next-line no-await-in-loop -- 同上
            await compare(subjectEnd, referenceEnd, reference.shotWithoutModel)
          : null;
      const entry: SceneQuality = {
        scene,
        stable: stripImages(stable),
        afterFlight: afterFlight ? stripImages(afterFlight) : null,
        heatmap,
        worstCrops,
        subject: subject.shot,
        reference: reference.shot
      };
      results.quality.push(entry);
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
}

// ---------- 运行 ----------

async function main(): Promise<void> {
  console.log('检查环境……');
  await checkFiles();
  const warnings: string[] = [];
  const environment = await checkRenderer(warnings);
  const { basemap, warning } = await checkBasemap();
  if (warning) {
    warnings.push(warning);
  }
  if (modelsProxy) {
    warnings.push('模型经 YZT_3DT_PROXY 从服务器取：到稳定、补齐都含网络时间，只看两种引擎之间的差别。验收场景不要这样跑。');
  }
  for (const line of warnings) {
    console.warn(`  ! ${line}`);
  }
  console.log(`  渲染器：${environment.gpu}`);
  console.log(`  浏览器：${environment.browser}`);
  console.log(`  空页面的帧间隔：${JSON.stringify(environment.floorMs)}`);

  if (!options.skipBuild) {
    console.log('构建测量页……');
    await build({ configFile: resolve(import.meta.dirname, 'vite.config.ts') });
  } else if (!existsSync(join(PAGE_OUT_DIR, 'index.html'))) {
    fail(['--skip-build 时要先有构建好的页面：去掉这个参数运行一次。']);
  }

  const outDir = options.out ? resolve(options.out) : localPath('measure-3d', timestamp());
  mkdirSync(join(outDir, 'shots'), { recursive: true });
  mkdirSync(join(outDir, 'profiles'), { recursive: true });
  const runs: readonly Run[] = buildRuns(scenes, list, options.repeat);
  const results: MeasureResults = {
    meta: {
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      commit: gitCommit(),
      finished: false,
      quick: options.quick,
      basemap,
      viewport: options.viewport,
      repeat: options.repeat,
      pacing: options.pacing,
      antialias: options.antialias,
      plannedTotal: runs.length
    },
    environment,
    warnings,
    scenes: scenes.map(({ id, title, acceptance }) => ({ id, title, acceptance })),
    variants: list.map(({ id, label }) => ({ id, label })),
    runs: [],
    quality: []
  };
  const writeAtomic = (name: string, text: string) => {
    const path = join(outDir, name);
    writeFileSync(`${path}.tmp`, redact(text));
    renameSync(`${path}.tmp`, path);
  };
  const save = () => {
    results.meta.updatedAt = new Date().toISOString();
    writeAtomic('raw.json', JSON.stringify(results, null, 1));
    writeAtomic('report.md', renderReport(results));
    writeAtomic('manual.md', renderManual(results));
    writeAtomic('quality.html', renderQualityPage(results));
  };
  save();

  const server = await startServer(options.port, {
    files: {
      '/3dt/': modelsDir,
      '/cesium/': join(appRoot, 'node_modules/cesium/Build/Cesium'),
      '/': PAGE_OUT_DIR
    },
    modelsProxy
  });

  let stopping = false;
  process.on('SIGINT', () => {
    if (stopping) {
      process.exit(130);
    }
    stopping = true;
    console.log('\n收到中断：这一遍结束后写报告退出。再按一次立刻退出。');
  });

  const startedAt = Date.now();
  const runOptions = { ...options, basemap };
  try {
    for (const [index, run] of runs.entries()) {
      if (stopping) {
        break;
      }
      const elapsed = Date.now() - startedAt;
      const remaining = index > 0 ? (elapsed / index) * (runs.length - index) : null;
      console.log(`\n[${index + 1}/${runs.length}] ${run.id}（${run.scene.title}，${run.variant.label}）  已用 ${minutes(elapsed)}${remaining === null ? '' : `，预计还要 ${minutes(remaining)}`}`);
      // oxlint-disable-next-line no-await-in-loop -- 一遍一遍地跑，同时跑会互相影响
      const result = await runOnce(run, {
        options: runOptions,
        baseUrl: server.url,
        outDir,
        redact,
        progress: phase => console.log(`    ${phase}`)
      });
      results.runs.push(result);
      save();
      console.log(
        result.status === 'failed'
          ? `    失败：${result.error}（已记录，继续下一遍）`
          : `    ${result.status}，到稳定 ${((result.load?.ttStableMs ?? 0) / 1000).toFixed(1)} 秒，屏幕误差 ${result.atStable?.errorTarget.toFixed(1)}，瓦片 ${result.atStable?.tilesVisible}`
      );
    }
    console.log('\n比较截图……');
    // 帧时间这些已经写好了：比较截图出错不能把它们带没
    await compareScenes(results, outDir, server.url).catch((error: unknown) => {
      results.warnings.push(`比较截图失败：${String(error).split(String.fromCharCode(10))[0]}。截图都在 shots/ 里，可以直接看。`);
    });
    results.meta.finished = !stopping && results.runs.length === runs.length;
    save();
  } finally {
    await server.close();
  }
  console.log(`\n完成 ${results.runs.length}/${runs.length}，用时 ${minutes(Date.now() - startedAt)}`);
  console.log(`结果目录：${outDir}`);
  console.log('看 quality.html、填 manual.md，然后把整个结果目录带回来。');
  // Playwright 的连接可能还留着句柄：明确退出，不留进程
  process.exit(results.runs.length > 0 && results.runs.every(run => run.status === 'failed') ? 4 : 0);
}

await main();
