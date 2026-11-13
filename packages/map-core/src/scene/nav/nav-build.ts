import { abortReason, WorkerHost, type WorkerEndpoint } from '@mx/utils';
import type { PreparedTileset } from '../prepare-tileset';
import { type NavOptions, SCAN_NAV_OPTIONS } from './nav-data';
import { type NavFrame, navigationFrame, type Point3 } from './nav-frame';
import { NavGrid } from './nav-grid';
import { navigationLeaves, rootTransform } from './nav-leaves';
import type { NavWorkerProtocol } from './nav-worker-protocol';

/** 同时下载的文件数 */
const DOWNLOADS = 4;

/** 扫描模型的碰撞网格最多读这么多个三角形（ADR 0156 第 2 节）：0.1 米的格子，两个调试模型约 80 万个、构建约 1 秒 */
export const SCAN_MAX_TRIANGLES = 2_000_000;

/** 构建的进度：先下载叶节点瓦片（扫描模型是碰撞网格），再在 Worker 里构建 */
export type NavBuildProgress =
  | { readonly stage: 'download'; readonly done: number; readonly total: number }
  | { readonly stage: 'build' };

export interface BuildNavigationOptions {
  readonly signal: AbortSignal;
  /** 下载一个文件，默认用 fetch */
  readonly download?: (url: string, signal: AbortSignal) => Promise<ArrayBuffer>;
  /** 创建 Worker，默认是 nav-grid.worker.ts；测试注入同一线程里的端点 */
  readonly createWorker?: () => WorkerEndpoint;
  readonly onProgress?: (progress: NavBuildProgress) => void;
  /** 构建参数；扫描模型不写的用 SCAN_NAV_OPTIONS，瓦片集不写的用 NAV_DEFAULTS */
  readonly options?: Partial<NavOptions>;
}

/** 建好的导航网格和它的局部系 */
export interface Navigation {
  readonly grid: NavGrid;
  readonly frame: NavFrame;
}

/** 扫描模型（LCC2）的一个碰撞网格：索引里带网格的节点；包围盒在 LCC2 的局部系里，也就是导航网格的局部系 */
export interface ScanMesh {
  readonly url: string;
  /** 三角形数（索引里的面数） */
  readonly triangles: number;
  readonly min: Point3;
  readonly max: Point3;
}

/** 扫描模型的导航网格从哪来：碰撞网格、局部系（splatNavigationFrame），网格太多时从 near 附近读起 */
export interface ScanSource {
  readonly meshes: readonly ScanMesh[];
  readonly frame: NavFrame;
  /** 局部系里的一点（一般是出生点）；没有时从全部网格的中心读起 */
  readonly near: Point3 | null;
}

/** 扫描模型的导航网格；partial 是网格太多、只读了 near 附近的一部分，走到边上走不出去 */
export interface ScanNavigation extends Navigation {
  readonly partial: boolean;
}

export interface BuildScanNavigationOptions extends BuildNavigationOptions {
  /** 最多读这么多个三角形，默认 SCAN_MAX_TRIANGLES */
  readonly maxTriangles?: number;
}

async function fetchFile(url: string, signal: AbortSignal): Promise<ArrayBuffer> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`下载失败（${response.status}）：${url}`);
  }
  return response.arrayBuffer();
}

const createNavWorker = (): WorkerEndpoint =>
  new Worker(new URL('./nav-grid.worker.ts', import.meta.url), { type: 'module', name: 'nav-grid' });

/**
 * 由整理后的索引构建导航网格（ADR 0085 第 3 节）：主线程下载叶节点瓦片、报告进度，转移给 Worker 解析、构建、算区域。
 * 每次构建一个 Worker，结束后释放；中止时下载和 Worker 都停下，以 AbortError 结束
 */
export async function buildNavigation(
  tileset: PreparedTileset,
  { signal, download = fetchFile, createWorker = createNavWorker, onProgress, options = {} }: BuildNavigationOptions
): Promise<Navigation> {
  signal.throwIfAborted();
  const frame = navigationFrame(rootTransform(tileset));
  const leaves = navigationLeaves(tileset);
  if (leaves.length === 0) {
    throw new Error('瓦片集没有可用的叶节点');
  }
  const buffers = await downloadAll(
    leaves.map(leaf => leaf.url),
    download,
    signal,
    onProgress
  );
  const tiles = buffers.map((buffer, i) => ({ buffer, toLocal: leaves[i].toLocal }));
  onProgress?.({ stage: 'build' });
  using host = new WorkerHost<NavWorkerProtocol>({ createWorker, maxRestarts: 0 });
  const data = await host.request('build', { tiles, options }, { signal, transfer: buffers });
  return { grid: new NavGrid(data), frame };
}

// 一个数到区间的距离，在区间里为 0
const gap = (value: number, low: number, high: number) => Math.max(low - value, 0, value - high);

// 点到包围盒的距离，在盒子里为 0
function boxDistance([x, y, z]: Point3, { min, max }: ScanMesh): number {
  return Math.hypot(gap(x, min[0], max[0]), gap(y, min[1], max[1]), gap(z, min[2], max[2]));
}

/**
 * 挑要读的碰撞网格（ADR 0156 第 2 节）：总数不超过 maxTriangles 全读；超过时按包围盒离 near 由近到远读，下一个放不下就停
 * （至少读最近的一个），只读到的一片连在一起。near 为 null 时从全部网格的中心读起
 */
export function selectScanMeshes(
  meshes: readonly ScanMesh[],
  near: Point3 | null,
  maxTriangles: number
): { readonly meshes: readonly ScanMesh[]; readonly partial: boolean } {
  const total = meshes.reduce((sum, mesh) => sum + mesh.triangles, 0);
  if (total <= maxTriangles) {
    return { meshes, partial: false };
  }
  const center = (axis: number) =>
    (Math.min(...meshes.map(mesh => mesh.min[axis])) + Math.max(...meshes.map(mesh => mesh.max[axis]))) / 2;
  const from: Point3 = near ?? [center(0), center(1), center(2)];
  const picked: ScanMesh[] = [];
  let sum = 0;
  for (const mesh of meshes.toSorted((a, b) => boxDistance(from, a) - boxDistance(from, b))) {
    if (picked.length > 0 && sum + mesh.triangles > maxTriangles) {
      break;
    }
    picked.push(mesh);
    sum += mesh.triangles;
  }
  return { meshes: picked, partial: true };
}

/**
 * 由碰撞网格构建扫描模型（LCC2）的导航网格（ADR 0156 第 2 节）：挑网格、主线程下载、Worker 里解析 PLY、构建、算区域，
 * 参数默认 SCAN_NAV_OPTIONS。中止的规则同 buildNavigation
 */
export async function buildScanNavigation(
  { meshes, frame, near }: ScanSource,
  {
    signal,
    download = fetchFile,
    createWorker = createNavWorker,
    onProgress,
    options = {},
    maxTriangles = SCAN_MAX_TRIANGLES
  }: BuildScanNavigationOptions
): Promise<ScanNavigation> {
  signal.throwIfAborted();
  if (meshes.length === 0) {
    throw new Error('模型没有碰撞网格');
  }
  const selection = selectScanMeshes(meshes, near, maxTriangles);
  const buffers = await downloadAll(
    selection.meshes.map(mesh => mesh.url),
    download,
    signal,
    onProgress
  );
  onProgress?.({ stage: 'build' });
  using host = new WorkerHost<NavWorkerProtocol>({ createWorker, maxRestarts: 0 });
  const data = await host.request(
    'buildScan',
    { meshes: buffers, options: { ...SCAN_NAV_OPTIONS, ...options } },
    { signal, transfer: buffers }
  );
  return { grid: new NavGrid(data), frame, partial: selection.partial };
}

// 最多同时下载 DOWNLOADS 个，结果和 urls 一一对应；一个失败就停下其余的
async function downloadAll(
  urls: readonly string[],
  download: (url: string, signal: AbortSignal) => Promise<ArrayBuffer>,
  signal: AbortSignal,
  onProgress: ((progress: NavBuildProgress) => void) | undefined
): Promise<ArrayBuffer[]> {
  const controller = new AbortController();
  const stop = () => controller.abort(abortReason(signal));
  signal.addEventListener('abort', stop, { once: true });
  const buffers: ArrayBuffer[] = [];
  let next = 0;
  let done = 0;
  const run = async () => {
    while (next < urls.length && !controller.signal.aborted) {
      const index = next++;
      // oxlint-disable-next-line no-await-in-loop -- 每个通道依次下载，同时下载的个数由通道数决定
      const buffer = await download(urls[index], controller.signal);
      controller.signal.throwIfAborted();
      buffers[index] = buffer;
      done++;
      onProgress?.({ stage: 'download', done, total: urls.length });
    }
  };
  try {
    await Promise.all(
      Array.from({ length: Math.min(DOWNLOADS, urls.length) }, () =>
        run().catch((error: unknown) => {
          controller.abort(error);
          throw error;
        })
      )
    );
    return buffers;
  } finally {
    signal.removeEventListener('abort', stop);
  }
}
