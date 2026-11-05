import { abortReason, WorkerHost, type WorkerEndpoint } from '@yzt/utils';
import type { PreparedTileset } from '../prepare-tileset';
import type { NavOptions } from './nav-data';
import { type NavFrame, navigationFrame } from './nav-frame';
import { NavGrid } from './nav-grid';
import { navigationLeaves, rootTransform } from './nav-leaves';
import type { NavTile, NavWorkerProtocol } from './nav-worker-protocol';

/** 同时下载的瓦片数 */
const DOWNLOADS = 4;

/** 构建的进度：先下载叶节点瓦片，再在 Worker 里构建 */
export type NavBuildProgress =
  | { readonly stage: 'download'; readonly done: number; readonly total: number }
  | { readonly stage: 'build' };

export interface BuildNavigationOptions {
  readonly signal: AbortSignal;
  /** 下载一个瓦片，默认用 fetch */
  readonly download?: (url: string, signal: AbortSignal) => Promise<ArrayBuffer>;
  /** 创建 Worker，默认是 nav-grid.worker.ts；测试注入同一线程里的端点 */
  readonly createWorker?: () => WorkerEndpoint;
  readonly onProgress?: (progress: NavBuildProgress) => void;
  readonly options?: Partial<NavOptions>;
}

/** 建好的导航网格和它的局部系 */
export interface Navigation {
  readonly grid: NavGrid;
  readonly frame: NavFrame;
}

async function fetchTile(url: string, signal: AbortSignal): Promise<ArrayBuffer> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`瓦片下载失败（${response.status}）：${url}`);
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
  { signal, download = fetchTile, createWorker = createNavWorker, onProgress, options = {} }: BuildNavigationOptions
): Promise<Navigation> {
  signal.throwIfAborted();
  const frame = navigationFrame(rootTransform(tileset));
  const leaves = navigationLeaves(tileset);
  if (leaves.length === 0) {
    throw new Error('瓦片集没有可用的叶节点');
  }
  const tiles = await downloadTiles(leaves, download, signal, onProgress);
  onProgress?.({ stage: 'build' });
  using host = new WorkerHost<NavWorkerProtocol>({ createWorker, maxRestarts: 0 });
  const data = await host.request(
    'build',
    { tiles, options },
    { signal, transfer: tiles.map(({ buffer }) => buffer) }
  );
  return { grid: new NavGrid(data), frame };
}

// 最多同时下载 DOWNLOADS 个；一个失败就停下其余的
async function downloadTiles(
  leaves: readonly { readonly url: string; readonly toLocal: Float64Array }[],
  download: (url: string, signal: AbortSignal) => Promise<ArrayBuffer>,
  signal: AbortSignal,
  onProgress: ((progress: NavBuildProgress) => void) | undefined
): Promise<NavTile[]> {
  const controller = new AbortController();
  const stop = () => controller.abort(abortReason(signal));
  signal.addEventListener('abort', stop, { once: true });
  const tiles: NavTile[] = [];
  let next = 0;
  let done = 0;
  const run = async () => {
    while (next < leaves.length && !controller.signal.aborted) {
      const index = next++;
      const leaf = leaves[index];
      // oxlint-disable-next-line no-await-in-loop -- 每个通道依次下载，同时下载的个数由通道数决定
      const buffer = await download(leaf.url, controller.signal);
      controller.signal.throwIfAborted();
      tiles[index] = { buffer, toLocal: leaf.toLocal };
      done++;
      onProgress?.({ stage: 'download', done, total: leaves.length });
    }
  };
  try {
    await Promise.all(
      Array.from({ length: Math.min(DOWNLOADS, leaves.length) }, () =>
        run().catch((error: unknown) => {
          controller.abort(error);
          throw error;
        })
      )
    );
    return tiles;
  } finally {
    signal.removeEventListener('abort', stop);
  }
}
