// 启动前检查：缺什么都用中文一次说清楚，不跑到一半才失败
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statfsSync } from 'node:fs';
import { createServer } from 'node:net';
import { totalmem } from 'node:os';
import { join } from 'node:path';
import { INTEGRATED_RENDERER, listAdapters, probeRenderer, SOFTWARE_RENDERER } from './browser.mjs';
import { LCC2_DIR, LCC_APP_DIR, listLccFiles, MODELS_DIR, POC_DIR, REPO_ROOT, ROAM_DIR } from './paths.mjs';
import { requiredModels } from './scenes.mjs';

const INSTALL_ROOT = 'pnpm install --ignore-workspace --config.strictDepBuilds=false';
const INSTALL_LCC = 'pnpm -C lcc2 install --ignore-workspace --config.strictDepBuilds=false';

function canListen(port, host) {
  return new Promise(resolve => {
    const probe = createServer();
    // 机器没有 IPv6 时 ::1 绑不上，不算端口被占
    probe.once('error', error => resolve(error.code !== 'EADDRINUSE'));
    probe.listen(port, host, () => probe.close(() => resolve(true)));
  });
}

// localhost 可能解析到任何一个，两个都要空着
async function portFree(port) {
  return (await canListen(port, '127.0.0.1')) && (await canListen(port, '::1'));
}

/** 不用浏览器的检查：只返回问题和提醒，不退出 */
export async function checkFiles(runs, options) {
  const problems = [];
  const warnings = [];
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 20) {
    problems.push(`Node 版本太低：现在是 ${process.version}，至少要 20（建议 24）。`);
  }
  const pnpm = spawnSync('pnpm --version', { shell: true, encoding: 'utf8' });
  if (pnpm.status !== 0) {
    problems.push('找不到 pnpm。安装：npm install -g pnpm');
  }
  for (const name of ['playwright', 'vite', 'cesium', 'maplibre-gl', 'three']) {
    if (!existsSync(join(POC_DIR, 'node_modules', name))) {
      problems.push(`依赖没有安装（缺 ${name}）。在这个目录运行：${INSTALL_ROOT}`);
      break;
    }
  }
  const needsLcc = runs.some(run => run.needsLcc);
  if (needsLcc && !existsSync(join(LCC_APP_DIR, 'node_modules', 'gaussian-splat-lite'))) {
    problems.push(`LCC2 工程的依赖没有安装。在这个目录运行：${INSTALL_LCC}`);
  }
  for (const file of ['packages/map-cesium/src/scene-tilesets.ts', 'packages/map-core/src/scene/prepare-tileset.ts']) {
    if (!existsSync(join(REPO_ROOT, file))) {
      problems.push(`仓库里缺 ${file}：这个目录要放在完整的仓库里，离仓库根三层（如 tools/poc/maplibre-three）。`);
    }
  }
  if (!existsSync(ROAM_DIR)) {
    warnings.push('仓库里缺 apps/yzt/public/roam，手动检查页的人物模型打不开，不影响测量。');
  }
  const missingModels = requiredModels(runs).filter(file => !existsSync(join(MODELS_DIR, file)));
  if (missingModels.length > 0) {
    problems.push(
      `模型目录里缺文件：${missingModels.join('、')}。\n  模型目录：${MODELS_DIR}\n  把 3dt 目录复制到仓库根的 local/3dt，或设置环境变量 YZT_LOCAL_DIR 指向包含 3dt 的目录；只想跑其他场景时用 --only。`
    );
  }
  if (needsLcc && listLccFiles().length === 0) {
    problems.push(
      `样例目录里没有 .lcc2 文件。\n  样例目录：${LCC2_DIR}\n  把样例复制到仓库根的 local/lcc2/render2，或设置环境变量 LCC2_DIR；只想跑其他场景时用 --only。`
    );
  }
  if (!(await portFree(options.port))) {
    problems.push(`端口 ${options.port} 被占用。关掉占用它的程序，或用 --port 换一个。`);
  }
  try {
    const results = join(POC_DIR, 'results');
    mkdirSync(results, { recursive: true });
    const { bavail, bsize } = statfsSync(results);
    if (bavail * bsize < 1024 ** 3) {
      warnings.push('结果目录所在的磁盘剩余不到 1 GB。');
    }
  } catch (error) {
    problems.push(`结果目录不能写入：${error.message}`);
  }
  if (needsLcc && totalmem() < 16 * 1024 ** 3 && options.lccBudgets.some(budget => budget >= 10000000)) {
    warnings.push('内存不到 16 GB，LCC2 的 1000 万预算可能撑爆浏览器；失败只记录，不影响后面的场景。');
  }
  return { problems, warnings };
}

/** 检查实际走的是哪块显卡；软件渲染直接拦下，除非传了 --allow-software */
export async function checkRenderer(options) {
  const problems = [];
  const warnings = [];
  const adapters = await listAdapters();
  let renderer;
  try {
    renderer = await probeRenderer(options);
  } catch (error) {
    return { problems: [String(error.message)], warnings, renderer: null, adapters };
  }
  if (!renderer.webgl2) {
    problems.push('这个浏览器拿不到 WebGL2，测不了。');
    return { problems, warnings, renderer, adapters };
  }
  const software = SOFTWARE_RENDERER.test(renderer.renderer);
  if (software && !options.allowSoftware) {
    problems.push(
      `现在用的是软件渲染：${renderer.renderer}\n  这种结果没有意义，已经停下。请更新显卡驱动，确认不是在远程桌面或虚拟机里运行。\n  只想确认脚本能跑时加 --allow-software，结果会标为无效。`
    );
  }
  if (software && options.allowSoftware) {
    warnings.push(`软件渲染：${renderer.renderer}。这次的结果无效，只用来确认脚本能跑。`);
  }
  const integrated = !software && INTEGRATED_RENDERER.test(renderer.renderer);
  if (integrated) {
    warnings.push(
      adapters.length > 1
        ? `【注意】这台机器有 ${adapters.length} 块显卡，现在用的却是集显：${renderer.renderer}\n  到 Windows 设置 → 系统 → 显示 → 图形，把 Chrome 设为"高性能"，重新运行。不改也会继续跑，报告里会标出来。`
        : `【注意】现在用的是集显：${renderer.renderer}。报告里会标出来。`
    );
  }
  const refresh = Math.max(0, ...adapters.map(item => Number(item.refreshRate) || 0));
  // 中位数明显低于一个刷新周期，才算解除了 vsync
  const cappedAt = refresh > 0 ? 1000 / refresh : null;
  const uncapped = renderer.rafMedianMs !== null && renderer.rafMedianMs < (cappedAt ? cappedAt * 0.7 : 5);
  if (!uncapped) {
    warnings.push(
      `帧率上限没有解除（空页面每帧 ${renderer.rafMedianMs?.toFixed(1)} 毫秒）：帧时间可能被封顶，这时要看报告里的 GPU 和 JS 耗时。`
    );
  }
  return { problems, warnings, renderer: { ...renderer, software, integrated, uncapped, refreshRate: refresh || null }, adapters };
}

/** 影像底图能不能访问；不通时自动换成无底图，两个引擎一起换 */
export async function checkBasemap(options) {
  if (options.basemap === 'none') {
    return { basemap: 'none', warning: null };
  }
  try {
    const response = await fetch('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/0/0/0', {
      signal: AbortSignal.timeout(8000)
    });
    if (response.ok) {
      return { basemap: 'arcgis', warning: null };
    }
    return { basemap: 'none', warning: `ArcGIS 影像返回 ${response.status}，改用无底图（两个引擎相同）。` };
  } catch {
    return { basemap: 'none', warning: 'ArcGIS 影像访问不了，改用无底图（两个引擎相同）。' };
  }
}
