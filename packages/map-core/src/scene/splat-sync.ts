import type { CameraState } from '../camera/camera-model';
import {
  NO_SCENE_STATUS,
  type SceneStatus,
  type SplatLayer,
  type SplatPlacement,
  type TilesetStatus
} from './scene-content-model';

/** 高斯泼溅读哪份数据、摆在哪：变了就重新加载（摆放变了，就绪时给的相机也要重算） */
export interface SplatSource {
  /** .lcc2 索引的绝对地址 */
  readonly url: string;
  readonly placement: SplatPlacement;
}

/** 高斯泼溅可以随时改的部分 */
export interface SplatOptions {
  readonly show: boolean;
}

/**
 * 承载高斯泼溅的引擎（ADR 0149）：只有 maplibre 引擎的 Three 渲染器实现。
 * 数据块加载失败由引擎报告，视图转给 SceneSplatSync 的 failed
 */
export interface SplatHost {
  /** 读索引、加进场景，给出让整个模型进入画布的相机；signal 中止时释放建好的、以中止的原因结束 */
  addSplat(id: string, source: SplatSource, options: SplatOptions, signal: AbortSignal): Promise<CameraState>;
  updateSplat(id: string, options: SplatOptions): void;
  removeSplat(id: string): void;
}

export interface SceneSplatSyncOptions {
  readonly host: SplatHost;
  /** 状态变了：每次换一个新的 Map */
  readonly onStatus: (status: SceneStatus) => void;
}

interface SplatEntry {
  layer: SplatLayer;
  readonly controller: AbortController;
  status: TilesetStatus;
  // 已经加进引擎，之后才能改显示；applied 是最近交给引擎的
  applied: SplatOptions | null;
}

const samePlacement = (a: SplatPlacement, b: SplatPlacement) =>
  a.lng === b.lng && a.lat === b.lat && a.height === b.height && a.heading === b.heading;

// 地址、摆放、重试次数变了要重新加载
const reloads = (entry: SplatEntry, layer: SplatLayer) =>
  layer.url !== entry.layer.url ||
  layer.attempt !== entry.layer.attempt ||
  !samePlacement(layer.placement, entry.layer.placement);

/**
 * 按会话的高斯泼溅增删改引擎里的泼溅（ADR 0149），做法同 SceneTilesetSync：地址、摆放、重试次数变了就重新加载，
 * 其余的只改显示；状态和瓦片集的合在一起报告（ID 不重复，由会话校验）
 */
export class SceneSplatSync implements Disposable {
  readonly #host: SplatHost;
  readonly #onStatus: (status: SceneStatus) => void;
  readonly #entries = new Map<string, SplatEntry>();
  #status: SceneStatus = NO_SCENE_STATUS;
  #disposed = false;

  constructor({ host, onStatus }: SceneSplatSyncOptions) {
    this.#host = host;
    this.#onStatus = onStatus;
  }

  get status(): SceneStatus {
    return this.#status;
  }

  /** 换成会话里的这些泼溅 */
  apply(splats: readonly SplatLayer[]): void {
    if (this.#disposed) {
      return;
    }
    const wanted = new Map(splats.map(layer => [layer.id, layer]));
    let changed = false;
    for (const [id, entry] of this.#entries) {
      const layer = wanted.get(id);
      if (!layer || reloads(entry, layer)) {
        entry.controller.abort();
        if (entry.applied) {
          this.#host.removeSplat(id);
        }
        this.#entries.delete(id);
        changed = true;
      }
    }
    for (const layer of splats) {
      const entry = this.#entries.get(layer.id);
      if (!entry) {
        this.#load(layer);
        changed = true;
        continue;
      }
      entry.layer = layer;
      if (entry.applied && entry.applied.show !== layer.show) {
        entry.applied = { show: layer.show };
        this.#host.updateSplat(layer.id, entry.applied);
      }
    }
    if (changed) {
      this.#publish();
    }
  }

  /** 引擎报告：这份泼溅的数据加载失败；记第一条，重试（换重试次数）后重新开始 */
  failed(id: string, error: unknown): void {
    const entry = this.#entries.get(id);
    if (entry && entry.status.state !== 'failed') {
      entry.status = { state: 'failed', error };
      this.#publish();
    }
  }

  /** 进行中的加载都中止；已经加进引擎的由引擎自己释放 */
  [Symbol.dispose](): void {
    this.#disposed = true;
    for (const { controller } of this.#entries.values()) {
      controller.abort();
    }
    this.#entries.clear();
    this.#status = NO_SCENE_STATUS;
  }

  #load(layer: SplatLayer): void {
    const entry: SplatEntry = { layer, controller: new AbortController(), status: { state: 'loading' }, applied: null };
    this.#entries.set(layer.id, entry);
    void this.#add(entry);
  }

  // 交给引擎；中止的不报告，失败记进状态。等待期间改过的显示在加进去以后补上
  async #add(entry: SplatEntry): Promise<void> {
    const { signal } = entry.controller;
    const { id, url, placement, show } = entry.layer;
    try {
      const camera = await this.#host.addSplat(id, { url, placement }, { show }, signal);
      signal.throwIfAborted();
      entry.applied = { show };
      if (entry.layer.show !== show) {
        entry.applied = { show: entry.layer.show };
        this.#host.updateSplat(id, entry.applied);
      }
      // 加载中报告过的失败（数据块）不被就绪盖掉
      if (entry.status.state !== 'failed') {
        entry.status = { state: 'ready', camera };
      }
    } catch (error) {
      if (signal.aborted) {
        return;
      }
      entry.status = { state: 'failed', error };
    }
    this.#publish();
  }

  #publish(): void {
    this.#status = new Map([...this.#entries].map(([id, { status }]) => [id, status]));
    this.#onStatus(this.#status);
  }
}

/** 瓦片集和泼溅的状态合成一份（ID 不重复）；泼溅没有时原样返回瓦片集的 */
export function mergeSceneStatus(tilesets: SceneStatus, splats: SceneStatus): SceneStatus {
  return splats.size === 0 ? tilesets : new Map([...tilesets, ...splats]);
}
