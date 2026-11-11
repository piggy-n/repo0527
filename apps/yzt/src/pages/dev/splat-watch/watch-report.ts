import type { ProbeSnapshot } from './splat-probe';

// 页面上的读数和"复制结果"的文字：显卡机器上看完，把这段文字发回来（docs/modules/map-three.md"泼溅的预算"）

const MB = 1024 * 1024;
const WAN = 10000;

// 软件渲染的标志，同测量工具（tools/measure-3d/browser.ts）
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|basic render|software adapter|gdi generic|mesa offscreen/i;

const grouped = (value: number) => Math.round(value).toLocaleString('en-US');

// 地图按需重画：不动时这半秒没有新帧，写 0.0 像是卡住了
function fpsText(fps: number | null): string {
  if (fps === null) {
    return '—';
  }
  return fps === 0 ? '静止（这半秒没画新帧）' : fps.toFixed(1);
}

/** 页面当前的设置：写进结果，回来时知道是在什么条件下看的 */
export interface WatchSettings {
  readonly model: string;
  readonly budget: number;
  readonly reference: string | null;
  readonly mode: string;
}

/** 一行一项：页面列出来，复制时拼成文字 */
export function readoutLines(snapshot: ProbeSnapshot | null): string[] {
  if (!snapshot?.inspection) {
    return ['还没有三维渲染器：等地图和模型加载'];
  }
  const { gpu, fps, inspection, watch } = snapshot;
  const splats = Object.values(inspection.splats);
  const sum = (read: (item: (typeof splats)[number]) => number) => splats.reduce((total, item) => total + read(item), 0);
  const lines = [
    `显卡：${gpu ?? '未知'}${gpu && SOFTWARE_RENDERER.test(gpu) ? '（软件渲染，帧率和画面不算数）' : ''}`,
    `帧率：${fpsText(fps)}${watch ? '（开着 GL 监听，帧率不算数）' : ''}`,
    `可见的高斯：${(sum(item => item.visibleSplats) / WAN).toFixed(1)} 万 / 总预算 ${grouped(inspection.splatBudget / WAN)} 万`,
    `加载进度：${splats.length === 0 ? '—' : `${Math.round(Math.min(...splats.map(item => item.loadProgress)) * 100)}%`}；分块 驻留 ${sum(item => item.residentChunks)}、加载中 ${sum(item => item.loadingChunks)}`,
    `库估计：GPU ${grouped(sum(item => item.gpuBytes) / MB)} MB，CPU ${grouped(sum(item => item.cpuBytes) / MB)} MB，WASM 峰值 ${grouped(Math.max(0, ...splats.map(item => item.peakWasmBytes)) / MB)} MB；累计下载 ${grouped(sum(item => item.downloadedBytes) / MB)} MB`,
    `瓦片集：${Object.keys(inspection.tilesets).length} 个，缓存 ${grouped(inspection.cachedBytes / MB)} MB；最近一帧的三角形（含泼溅）${grouped(inspection.triangles)}`
  ];
  if (!watch) {
    lines.push('GL 监听：没开');
    return lines;
  }
  const inside = watch.errors.filter(error => error.inside).length;
  const methods = Object.entries(watch.libraryOutsideByMethod)
    .toSorted(([, a], [, b]) => b - a)
    .map(([name, count]) => `${name} ${grouped(count)}`)
    .join('，');
  lines.push(
    `GL 监听：开了 ${Math.round(watch.seconds)} 秒；GL 错误 ${watch.errorCount}${watch.errorCount > 0 ? `（记下的 ${watch.errors.length} 条里渲染回调里 ${inside}、外 ${watch.errors.length - inside}）` : ''}`,
    `库在渲染回调外的 GL 调用：${grouped(watch.libraryOutside)} 次${methods ? `（${methods}）` : ''}`
  );
  for (const error of watch.errors.slice(0, 5)) {
    lines.push(`  错误：${error.name} 0x${error.error.toString(16)}，${error.inside ? '渲染回调里' : '渲染回调外'}`);
  }
  return lines;
}

/** 复制给别人的结果：时间、设置和读数 */
export function reportText(snapshot: ProbeSnapshot | null, settings: WatchSettings, at = new Date()): string {
  return [
    `高斯泼溅的 GL 监听和预算（/dev/splat-watch，${at.toISOString()}）`,
    `模型：${settings.model}；总预算 ${grouped(settings.budget / WAN)} 万；对照：${settings.reference ?? '无'}；显示：${settings.mode}`,
    ...readoutLines(snapshot)
  ].join('\n');
}
