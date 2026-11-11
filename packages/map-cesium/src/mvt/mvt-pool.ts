import { type WorkerEndpoint, WorkerHost } from '@mx/utils';
import type {
  IdentifiedFeature,
  LabelReply,
  MvtWorkerProtocol,
  RenderReply,
  VectorSourceConfig,
  WorkerStats
} from './mvt-protocol';
import { sourceTile, type TileCoord, tileKey } from './tile-math';

// 方案 B 的 PoC：栅格化 Worker 的池（移植自旧项目的 MvtTileWorkerPool.js，换成 @mx/utils 的通信层）。
// 同一张下载瓦片的请求（超过最大级别时的各个子区域）固定交给同一个 Worker：解码一次、缓存一份

// 几何缓存的总预算，按 Worker 数平分
const TOTAL_CACHE_BYTES = 256 * 1024 * 1024;
// 每个 Worker 同时在画的位图数：再多只是在 Worker 里排队，留在主线程排还能按级别调先后
const IN_FLIGHT_PER_WORKER = 3;
// 每个数据源记住多少张瓦片归哪个 Worker；忘了的重新分配、重新解码
const OWNER_LIMIT = 8192;

export interface MvtPoolOptions {
  /** 创建 Worker，默认是 mvt.worker.ts；测试注入同一线程里的端点 */
  readonly createWorker?: () => WorkerEndpoint;
  /** Worker 数：默认取核数的一半，2～8 个，其余留给主线程和浏览器自己的线程 */
  readonly size?: number;
}

/** 池的累计读数（测量用）：各 Worker 的加起来，再加主线程这边的排队和往返 */
export interface MvtPoolStats extends WorkerStats {
  readonly workers: number;
  readonly requested: number;
  readonly failed: number;
  readonly pending: number;
  /** 发出请求到拿到位图的总时间，含排队 */
  readonly roundTripMs: number;
  /** 第一张、最后一张有内容的位图到达的时刻（performance.now） */
  readonly firstBitmapAt: number | null;
  readonly lastBitmapAt: number | null;
  /** 交给 Cesium 的位图张数 */
  readonly bitmaps: number;
}

interface Waiting {
  readonly id: string;
  readonly tile: TileCoord;
  readonly ownerKey: string;
  readonly sequence: number;
  readonly headers: Readonly<Record<string, string>> | null;
  readonly resolve: (reply: RenderReply) => void;
  readonly reject: (error: unknown) => void;
}

const createMvtWorker = (): WorkerEndpoint =>
  new Worker(new URL('./mvt.worker.ts', import.meta.url), { type: 'module', name: 'mvt-raster' });

const defaultSize = () => Math.max(2, Math.min(8, Math.ceil((navigator.hardwareConcurrency || 4) / 2)));

export class MvtPool implements Disposable {
  readonly #hosts: WorkerHost<MvtWorkerProtocol>[];
  readonly #load: number[];
  readonly #owners = new Map<string, number>();
  readonly #configs = new Map<string, VectorSourceConfig>();
  #waiting: Waiting[] = [];
  #sequence = 0;
  #requested = 0;
  #failed = 0;
  #roundTripMs = 0;
  #bitmaps = 0;
  #firstBitmapAt: number | null = null;
  #lastBitmapAt: number | null = null;
  #disposed = false;

  constructor({ createWorker = createMvtWorker, size = defaultSize() }: MvtPoolOptions = {}) {
    this.#hosts = Array.from(
      { length: size },
      () => new WorkerHost<MvtWorkerProtocol>({ createWorker, maxRestarts: 0, discard: { render: reply => reply.bitmap?.close() } })
    );
    this.#load = this.#hosts.map(() => 0);
  }

  /** 还没画完的位图数：排队的和已经交给 Worker 的 */
  get pending(): number {
    return this.#waiting.length + this.#load.reduce((total, count) => total + count, 0);
  }

  /** 新建或更新数据源；cacheBytes 由池按 Worker 数填 */
  configure(id: string, config: Omit<VectorSourceConfig, 'cacheBytes'>): void {
    const full = { ...config, cacheBytes: Math.floor(TOTAL_CACHE_BYTES / this.#hosts.length) };
    this.#configs.set(id, full);
    for (const host of this.#hosts) {
      host.request('configure', { id, config: full }).catch(() => undefined);
    }
  }

  remove(id: string): void {
    this.#configs.delete(id);
    for (const waiting of this.#waiting.filter(item => item.id === id)) {
      waiting.reject(new DOMException('数据源已移除', 'AbortError'));
    }
    this.#waiting = this.#waiting.filter(item => item.id !== id);
    for (const key of [...this.#owners.keys()].filter(owner => owner.startsWith(`${id}|`))) {
      this.#owners.delete(key);
    }
    for (const host of this.#hosts) {
      host.request('remove', { id }).catch(() => undefined);
    }
  }

  /** 画一张位图：先排队，发出时才定交给哪个 Worker */
  render(id: string, tile: TileCoord, headers: Readonly<Record<string, string>> | null): Promise<RenderReply> {
    const config = this.#configs.get(id);
    if (this.#disposed || !config) {
      return Promise.reject(new DOMException('数据源已移除', 'AbortError'));
    }
    this.#requested++;
    const started = performance.now();
    const ownerKey = `${id}|${tileKey(sourceTile(tile, config.maxzoom))}`;
    return new Promise<RenderReply>((resolve, reject) => {
      this.#waiting.push({ id, tile, ownerKey, sequence: this.#sequence++, headers, resolve, reject });
      this.#flush();
    }).then(
      reply => {
        this.#roundTripMs += performance.now() - started;
        if (reply.bitmap) {
          this.#bitmaps++;
          this.#firstBitmapAt ??= performance.now();
          this.#lastBitmapAt = performance.now();
        }
        return reply;
      },
      (error: unknown) => {
        this.#failed++;
        throw error;
      }
    );
  }

  /** 标注候选：瓦片分散在各个 Worker 上，按归属拆开问，再合起来 */
  async labels(id: string, layerId: string, tiles: readonly TileCoord[], limit: number): Promise<LabelReply | null> {
    const byWorker = new Map<number, TileCoord[]>();
    const missing: string[] = [];
    for (const tile of tiles) {
      const owner = this.#owners.get(`${id}|${tileKey(tile)}`);
      if (owner === undefined) {
        missing.push(tileKey(tile));
      } else {
        byWorker.set(owner, [...(byWorker.get(owner) ?? []), tile]);
      }
    }
    const replies = await Promise.all(
      [...byWorker].map(([owner, group]) => this.#hosts[owner]?.request('labels', { id, layerId, tiles: group, limit }))
    );
    const [first] = replies;
    if (!first) {
      return null;
    }
    const candidates = replies.flatMap(reply => reply?.candidates ?? []);
    return {
      candidates: candidates.length > limit ? candidates.toSorted((a, b) => b.area - a.area).slice(0, limit) : candidates,
      missing: [...missing, ...replies.flatMap(reply => reply?.missing ?? [])],
      paint: first.paint
    };
  }

  /** 识别：交给已经有这张瓦片的 Worker，没有时交给最闲的（它会下载） */
  identify(
    id: string,
    request: { readonly lng: number; readonly lat: number; readonly zoom: number; readonly tolerance: number },
    tile: TileCoord,
    headers: Readonly<Record<string, string>> | null
  ): Promise<readonly IdentifiedFeature[]> {
    const host = this.#hosts[this.#owners.get(`${id}|${tileKey(tile)}`) ?? this.#leastLoaded()];
    if (!host) {
      return Promise.resolve([]);
    }
    return host.request('identify', { id, ...request, headers });
  }

  async stats(): Promise<MvtPoolStats> {
    const all = await Promise.all(this.#hosts.map(host => host.request('stats', null)));
    const sum = (read: (stats: WorkerStats) => number) => all.reduce((total, stats) => total + read(stats), 0);
    const levels: Record<number, number> = {};
    for (const stats of all) {
      for (const [level, count] of Object.entries(stats.levels)) {
        levels[Number(level)] = (levels[Number(level)] ?? 0) + count;
      }
    }
    return {
      rendered: sum(stats => stats.rendered),
      fetched: sum(stats => stats.fetched),
      fetchMs: sum(stats => stats.fetchMs),
      decodeMs: sum(stats => stats.decodeMs),
      drawMs: sum(stats => stats.drawMs),
      bitmapMs: sum(stats => stats.bitmapMs),
      bytes: sum(stats => stats.bytes),
      fromHttpCache: sum(stats => stats.fromHttpCache),
      transferBytes: sum(stats => stats.transferBytes),
      cacheTiles: sum(stats => stats.cacheTiles),
      cacheBytes: sum(stats => stats.cacheBytes),
      levels,
      workers: this.#hosts.length,
      requested: this.#requested,
      failed: this.#failed,
      pending: this.pending,
      roundTripMs: this.#roundTripMs,
      firstBitmapAt: this.#firstBitmapAt,
      lastBitmapAt: this.#lastBitmapAt,
      bitmaps: this.#bitmaps
    };
  }

  [Symbol.dispose](): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    for (const waiting of this.#waiting) {
      waiting.reject(new DOMException('Worker 池已释放', 'AbortError'));
    }
    this.#waiting = [];
    for (const host of this.#hosts) {
      host[Symbol.dispose]();
    }
  }

  // 瓦片第一次出现时交给当时最闲的 Worker，之后一直归它（按坐标哈希分的话，几张重瓦片常常撞进同一个 Worker 排队）
  // 还没有归属、最闲的 Worker 也满了时先不分配（返回 null），等有空位再定
  #ownerOf(key: string): number | null {
    let owner = this.#owners.get(key);
    if (owner === undefined) {
      owner = this.#leastLoaded();
      if ((this.#load[owner] ?? 0) >= IN_FLIGHT_PER_WORKER) {
        return null;
      }
    } else {
      this.#owners.delete(key);
    }
    this.#owners.set(key, owner);
    if (this.#owners.size > OWNER_LIMIT) {
      const [oldest] = this.#owners.keys();
      if (oldest !== undefined) {
        this.#owners.delete(oldest);
      }
    }
    return owner;
  }

  #leastLoaded(): number {
    return this.#load.indexOf(Math.min(...this.#load));
  }

  // 细的先画、新的先画：Cesium 会连祖先一起请求，粗瓦片重，不能让它们占着 Worker；它的请求取消不了，
  // 飞行中早先请求的位图多半已经用不上，后发的先画
  #flush(): void {
    this.#waiting.sort((a, b) => b.tile.z - a.tile.z || b.sequence - a.sequence);
    const held: Waiting[] = [];
    for (const waiting of this.#waiting) {
      const owner = this.#ownerOf(waiting.ownerKey);
      const host = owner === null ? undefined : this.#hosts[owner];
      if (owner === null || !host || (this.#load[owner] ?? 0) >= IN_FLIGHT_PER_WORKER) {
        held.push(waiting);
        continue;
      }
      this.#load[owner] = (this.#load[owner] ?? 0) + 1;
      host
        .request('render', { id: waiting.id, tile: waiting.tile, headers: waiting.headers })
        .then(waiting.resolve, waiting.reject)
        .finally(() => {
          this.#load[owner] = Math.max(0, (this.#load[owner] ?? 0) - 1);
          this.#flush();
        });
    }
    this.#waiting = held;
  }
}
