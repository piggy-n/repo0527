import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { cpus, release, totalmem, type, version } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'vite';
import { localPath } from '../local-files/paths.ts';
import { INTEGRATED_RENDERER, launchBrowser, listAdapters, probeRenderer, SOFTWARE_RENDERER } from './browser.ts';
import { runLook } from './look.ts';
import { HELP, type Options, parseOptions, uploadBudgets } from './options.ts';
import { createRedactor } from './redact.ts';
import { renderManual, renderQualityPage, renderReport } from './report.ts';
import type { Environment, MeasureResults, SceneQuality, ShotPair } from './results.ts';
import { runOnce } from './run.ts';
import {
  buildRuns,
  DEFAULT_VARIANT,
  PENGCHENG_SPLAT,
  type Run,
  SCENES,
  selectScenes,
  splatVariants,
  variants,
  variantsOf,
  withCamera
} from './scenes.ts';
import { startServer } from './server.ts';
import type { SharpnessComparison } from './sharpness.ts';
import { decodedPath, manifestLabel, type ManifestSource, manifestSource, readManifest, resolveSplats, type SplatModel } from './splat-models.ts';
import { PAGE_OUT_DIR } from './vite.config.ts';

// 三维（MapLibre 引擎）的性能实测，高斯泼溅的预算（ADR 0149 L.3，--only splat）：在 apps/yzt 下运行 pnpm measure:3d，
// 步骤见 docs/modules/map-three.md"性能验收""泼溅的预算"

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
const { at } = options;
const scenes = selectScenes(options.only).map(scene => (at ? withCamera(scene, at) : scene));
const list = variants(uploadBudgets(options), options.cullWindows, options.cacheGBs);
const splatList = splatVariants(options.splatBudgets);
if (options.list) {
  for (const scene of SCENES) {
    const note = scene.byDefault ? '（默认）' : scene.splats.length > 0 ? '（高斯泼溅，比较 --splat-budget）' : '';
    console.log(`${scene.id.padEnd(22)} ${scene.title}${note}`);
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

// 控制台上的说明：要带服务器地址，fetch 的错误里没有它
function whereManifest(source: ManifestSource | null): string {
  if (source === null) {
    return `YZT_3DT_PROXY（${modelsProxy}）`;
  }
  return source.kind === 'proxy' ? `服务器上的清单（${source.url}）` : manifestLabel(source);
}

// 泼溅场景的模型按 ID 从清单读，和开发服务器同一个来源（splat-models.ts）；缺了说明怎么补（彭城广场的样例 2026-11-11 才入库）。
// 只在有泼溅场景时才解析代理的地址：写错了不影响 --help 和瓦片集的场景
async function resolveSceneSplats(): Promise<{ splats: Map<string, SplatModel>; source: ManifestSource | null; problems: string[] }> {
  const ids = [...new Set(scenes.flatMap(scene => scene.splats))];
  if (ids.length === 0) {
    return { splats: new Map(), source: null, problems: [] };
  }
  let source: ManifestSource | null = null;
  try {
    source = manifestSource(join(modelsDir, 'manifest.json'), join(appRoot, 'public/3dt/manifest.json'), modelsProxy);
    const models = resolveSplats(await readManifest(source), ids);
    return { splats: new Map(models.map(model => [model.id, model])), source, problems: [] };
  } catch (error) {
    const hint = ids.includes(PENGCHENG_SPLAT)
      ? `\n    彭城广场（泼溅）（${PENGCHENG_SPLAT}）2026-11-11 才进入库的清单：服务器上的清单要发布前端后才有它；local/3dt/manifest.json 是以前生成的本地清单时删掉它。`
      : '';
    return { splats: new Map(), source, problems: [`${whereManifest(source)}：${String(error instanceof Error ? error.message : error)}${hint}`] };
  }
}

async function checkFiles(splats: ReadonlyMap<string, SplatModel>): Promise<void> {
  const problems: string[] = [];
  const paths = [...new Set(scenes.flatMap(scene => scene.models.map(model => model.path)))];
  const splatPaths = [...splats.values()].map(model => model.path);
  if (modelsProxy) {
    problems.push(...(await checkModelServer(modelsProxy, [...paths, ...splatPaths])));
  } else {
    const missing = [...paths, ...splatPaths.map(decodedPath)].filter(path => !existsSync(join(modelsDir, path)));
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
      : { basemap: 'none', warning: `ArcGIS 影像返回 ${response.status}，改用无底图（各个方案相同）。` };
  } catch {
    return { basemap: 'none', warning: 'ArcGIS 影像访问不了，改用无底图（各个方案相同）。' };
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

// ---------- 飞行前后的截图 ----------

interface PageComparison extends SharpnessComparison {
  readonly heatmap: string;
  readonly worstCrops: string;
}

// 画质那一遍的截图，每个场景每个方案比两种：飞一圈回来和飞行前（同一相机，引擎应该细化回原来的样子，飞行后没稳定、没拍的不比）；
// 缓存上限的各档再拿产品默认值稳定后的那张和自己的比（同一相机）
async function compareScenes(results: MeasureResults, outDir: string, baseUrl: string): Promise<void> {
  const qualityOf = (scene: string, variant: string) =>
    results.runs.find(run => run.scene === scene && run.variant === variant && run.kind === 'quality')?.quality;
  const entries = results.scenes.flatMap(scene =>
    (scene.variants ?? []).flatMap(variant => {
      const own = qualityOf(scene.id, variant);
      if (!own) {
        return [];
      }
      const fallback = variant === DEFAULT_VARIANT ? undefined : qualityOf(scene.id, DEFAULT_VARIANT);
      return [{ scene: scene.id, variant, own, fallback }];
    })
  );
  if (entries.length === 0) {
    return;
  }
  const { browser } = await launchBrowser(options);
  try {
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/compare.html`);
    await page.waitForFunction('typeof window.compareShots === "function"');
    const read = (file: string) => JSON.stringify(readFileSync(join(outDir, file)).toString('base64'));
    // 一对一对地比，内存里同时只有两张图
    const compare = async (name: string, subject: string, reference: string, withoutModel: string): Promise<ShotPair> => {
      const comparison = await page.evaluate<PageComparison>(`window.compareShots(${read(subject)}, ${read(reference)}, ${read(withoutModel)})`);
      const heatmap = `shots/${name}-heatmap.png`;
      const worstCrops = `shots/${name}-worst.png`;
      writeFileSync(join(outDir, heatmap), Buffer.from(comparison.heatmap, 'base64'));
      writeFileSync(join(outDir, worstCrops), Buffer.from(comparison.worstCrops, 'base64'));
      return { comparison: stripImages(comparison), heatmap, worstCrops };
    };
    for (const { scene, variant, own, fallback } of entries) {
      const name = `${scene}__${variant}`;
      const after = own.shotAfterFlight;
      // oxlint-disable-next-line no-await-in-loop -- 一对一对地比
      const afterFlight = after ? await compare(name, after, own.shot, own.shotWithoutModel) : null;
      const versusDefault = fallback
        ? // oxlint-disable-next-line no-await-in-loop -- 一对一对地比
          await compare(`${name}-versus-default`, fallback.shot, own.shot, fallback.shotWithoutModel)
        : null;
      if (afterFlight || versusDefault) {
        const entry: SceneQuality = { scene, variant, afterFlight, versusDefault };
        results.quality.push(entry);
      }
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
}

// ---------- 运行 ----------

function runSummary(result: MeasureResults['runs'][number]): string {
  if (result.status === 'failed') {
    return `失败：${result.error}（已记录，继续下一遍）`;
  }
  const loaded = `${result.status}，到稳定 ${((result.load?.ttStableMs ?? 0) / 1000).toFixed(1)} 秒`;
  const splats = result.atStable?.splats;
  if (splats) {
    return `${loaded}，可见的高斯 ${Math.round(splats.visible / 1e4)} 万 / 预算 ${Math.round(splats.budget / 1e4)} 万`;
  }
  return `${loaded}，屏幕误差 ${result.atStable?.errorTarget.toFixed(1)}，瓦片 ${result.atStable?.tilesVisible}`;
}

const SERVED = { '/3dt/': modelsDir, '/': PAGE_OUT_DIR };

// --look：不测量、不写结果，开第一个场景的窗口看
async function look(splats: ReadonlyMap<string, SplatModel>, basemap: Options['basemap']): Promise<void> {
  const [scene] = scenes;
  if (!scene) {
    return;
  }
  if (scenes.length > 1) {
    console.warn(`  ! --look 只开第一个场景：${scene.title}`);
  }
  const server = await startServer(options.port, { files: SERVED, modelsProxy });
  let stopping = false;
  process.on('SIGINT', () => {
    stopping = true;
  });
  try {
    await runLook(scene, variantsOf(scene, list, splatList), {
      baseUrl: server.url,
      options: { ...options, basemap },
      splats,
      stopping: () => stopping
    });
  } finally {
    await server.close();
  }
  // Playwright 的连接可能还留着句柄：明确退出，不留进程
  process.exit(0);
}

async function main(): Promise<void> {
  console.log('检查环境……');
  const { splats, source: manifest, problems } = await resolveSceneSplats();
  if (problems.length > 0) {
    fail(problems);
  }
  await checkFiles(splats);
  const warnings: string[] = [];
  const environment = await checkRenderer(warnings);
  const { basemap, warning } = await checkBasemap();
  if (warning) {
    warnings.push(warning);
  }
  if (modelsProxy) {
    warnings.push('模型经 YZT_3DT_PROXY 从服务器取：到稳定、补齐都含网络时间，只看各个方案之间的差别。默认的场景（倾斜摄影 z17、z19）不要这样跑。');
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
  if (options.look) {
    await look(splats, basemap);
    return;
  }

  const outDir = options.out ? resolve(options.out) : localPath('measure-3d', timestamp());
  mkdirSync(join(outDir, 'shots'), { recursive: true });
  mkdirSync(join(outDir, 'profiles'), { recursive: true });
  const runs: readonly Run[] = buildRuns(scenes, list, options.repeat, splatList);
  const used = [...new Set(scenes.flatMap(scene => variantsOf(scene, list, splatList)))];
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
      fps: options.fps,
      antialias: options.antialias,
      plannedTotal: runs.length,
      ...(manifest ? { manifest: manifestLabel(manifest) } : {}),
      ...(at ? { at } : {})
    },
    environment,
    warnings,
    scenes: scenes.map(scene => ({
      id: scene.id,
      title: scene.title,
      byDefault: scene.byDefault,
      splat: scene.splats.length > 0,
      variants: variantsOf(scene, list, splatList).map(variant => variant.id)
    })),
    variants: used.map(({ id, label }) => ({ id, label })),
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

  const server = await startServer(options.port, { files: SERVED, modelsProxy });

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
        splats,
        baseUrl: server.url,
        outDir,
        redact,
        progress: phase => console.log(`    ${phase}`)
      });
      results.runs.push(result);
      save();
      console.log(`    ${runSummary(result)}`);
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
  console.log(scenes.every(scene => scene.splats.length > 0) ? '填 manual.md，然后把整个结果目录带回来。' : '看 quality.html、填 manual.md，然后把整个结果目录带回来。');
  // Playwright 的连接可能还留着句柄：明确退出，不留进程
  process.exit(results.runs.length > 0 && results.runs.every(run => run.status === 'failed') ? 4 : 0);
}

await main();
