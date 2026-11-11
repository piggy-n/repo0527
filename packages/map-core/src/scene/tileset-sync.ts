import type { CameraState } from '../camera/camera-model';
import { type LoadJson, type PreparedTileset, prepareTileset } from './prepare-tileset';
import {
  NO_SCENE_STATUS,
  type SceneStatus,
  type TilesetLayer,
  type TilesetLighting,
  type TilesetStatus
} from './scene-content-model';

/** 瓦片集可以随时改的部分 */
export interface TilesetOptions {
  readonly show: boolean;
  readonly lighting: TilesetLighting;
  /** 设定的屏幕误差（像素），不传用引擎的默认值（8）；显存放不下时引擎会临时放大它 */
  readonly maximumScreenSpaceError?: number;
  /** 显示着的高斯泼溅的范围里不画（ADR 0149）；不写是 false */
  readonly clippedBySplats?: boolean;
}

/**
 * 承载瓦片集的引擎（ADR 0147 第 3 节）：MapLibre 引擎的三维内容（MapLibreScene，交给 Three 渲染器）实现它。
 * 瓦片失败、首批瓦片到位由引擎各自报告，视图转给 SceneTilesetSync 的 failed、initial
 */
export interface TilesetHost {
  /**
   * 把整理好的索引交给引擎，建好后加进场景（ADR 0081 第 3 节），给出让整个瓦片集进入画布的相机；
   * signal 中止时销毁建好的瓦片集、以中止的原因结束
   */
  addTileset(id: string, tileset: PreparedTileset, options: TilesetOptions, signal: AbortSignal): Promise<CameraState>;
  updateTileset(id: string, options: TilesetOptions): void;
  removeTileset(id: string): void;
}

export interface SceneTilesetSyncOptions {
  readonly host: TilesetHost;
  /** 下载瓦片集的索引 */
  readonly loadJson: LoadJson;
  /** 状态变了：每次换一个新的 Map */
  readonly onStatus: (status: SceneStatus) => void;
}

// 一个瓦片集的加载（ADR 0081 第 2 节）：layer 是会话里最近的写法
interface TilesetEntry {
  layer: TilesetLayer;
  readonly controller: AbortController;
  status: TilesetStatus;
  // 已经加进引擎，之后才能改显示和光照；applied 是最近交给引擎的
  applied: TilesetOptions | null;
  // 显示后首批瓦片到过：换白膜效果时，新的到了才撤下旧的
  initial: boolean;
}

const sameOptions = (a: TilesetOptions | null, b: TilesetOptions) =>
  a !== null &&
  a.show === b.show &&
  a.lighting === b.lighting &&
  a.maximumScreenSpaceError === b.maximumScreenSpaceError &&
  a.clippedBySplats === b.clippedBySplats;

/**
 * 按会话的瓦片集增删改引擎里的瓦片集（ADR 0081 第 2、5 节），引擎实现 TilesetHost（ADR 0147 第 3 节）：
 * 地址、重试次数变了就重新加载，其余的只改显示、光照、屏幕误差和泼溅范围里的裁剪；同组的换显示时，新的首批瓦片到了才撤下旧的
 */
export class SceneTilesetSync implements Disposable {
  readonly #host: TilesetHost;
  readonly #loadJson: LoadJson;
  readonly #onStatus: (status: SceneStatus) => void;
  readonly #entries = new Map<string, TilesetEntry>();
  // 每组正在显示的那一个
  readonly #groupShown = new Map<string, string>();
  #status: SceneStatus = NO_SCENE_STATUS;
  #disposed = false;

  constructor({ host, loadJson, onStatus }: SceneTilesetSyncOptions) {
    this.#host = host;
    this.#loadJson = loadJson;
    this.#onStatus = onStatus;
  }

  get status(): SceneStatus {
    return this.#status;
  }

  /** 换成会话里的这些瓦片集 */
  apply(tilesets: readonly TilesetLayer[]): void {
    if (this.#disposed) {
      return;
    }
    const wanted = new Map(tilesets.map(layer => [layer.id, layer]));
    let changed = false;
    for (const [id, entry] of this.#entries) {
      const layer = wanted.get(id);
      if (!layer || layer.url !== entry.layer.url || layer.attempt !== entry.layer.attempt) {
        entry.controller.abort();
        if (entry.applied) {
          this.#host.removeTileset(id);
        }
        this.#entries.delete(id);
        changed = true;
      }
    }
    for (const layer of tilesets) {
      const entry = this.#entries.get(layer.id);
      if (entry) {
        entry.layer = layer;
      } else {
        this.#load(layer);
        changed = true;
      }
    }
    this.#applyVisibility();
    if (changed) {
      this.#publish();
    }
  }

  /** 引擎报告：这个瓦片集显示后，视野里的首批瓦片已到位 */
  initial(id: string): void {
    const entry = this.#entries.get(id);
    if (entry && !entry.initial) {
      entry.initial = true;
      this.#applyVisibility();
    }
  }

  /** 引擎报告：这个瓦片集的瓦片加载失败；每个瓦片集记第一条，重试（换重试次数）后重新开始 */
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
    this.#groupShown.clear();
    this.#status = NO_SCENE_STATUS;
  }

  #load(layer: TilesetLayer): void {
    const entry: TilesetEntry = {
      layer,
      controller: new AbortController(),
      status: { state: 'loading' },
      applied: null,
      initial: false
    };
    this.#entries.set(layer.id, entry);
    void this.#prepareAndAdd(entry);
  }

  // 整理索引、交给引擎；中止的不报告，失败记进状态
  async #prepareAndAdd(entry: TilesetEntry): Promise<void> {
    const { signal } = entry.controller;
    try {
      const prepared = await prepareTileset(entry.layer.url, this.#loadJson, signal);
      signal.throwIfAborted();
      const options = this.#optionsFor(entry);
      const camera = await this.#host.addTileset(entry.layer.id, prepared, options, signal);
      signal.throwIfAborted();
      entry.applied = options;
      entry.status = { state: 'ready', camera };
      this.#applyVisibility();
    } catch (error) {
      if (signal.aborted) {
        return;
      }
      entry.status = { state: 'failed', error };
    }
    this.#publish();
  }

  // 同组（白膜的各种效果）要显示的那个首批瓦片到了，才撤下上一个（ADR 0081 第 5 节）
  #optionsFor({ layer }: TilesetEntry): TilesetOptions {
    const { lighting, maximumScreenSpaceError, clippedBySplats } = layer;
    const rest = {
      lighting,
      ...(maximumScreenSpaceError === undefined ? {} : { maximumScreenSpaceError }),
      ...(clippedBySplats === undefined ? {} : { clippedBySplats })
    };
    if (layer.group === undefined || layer.show) {
      return { show: layer.show, ...rest };
    }
    const requested = this.#requestedIn(layer.group);
    const kept = requested !== undefined && !requested.initial && this.#groupShown.get(layer.group) === layer.id;
    return { show: kept, ...rest };
  }

  #requestedIn(group: string): TilesetEntry | undefined {
    return [...this.#entries.values()].find(({ layer }) => layer.group === group && layer.show);
  }

  #applyVisibility(): void {
    const groups = new Set([...this.#entries.values()].flatMap(({ layer }) => (layer.group ? [layer.group] : [])));
    for (const group of this.#groupShown.keys()) {
      groups.add(group);
    }
    for (const group of groups) {
      const requested = this.#requestedIn(group);
      if (!requested) {
        this.#groupShown.delete(group);
      } else if (requested.initial) {
        this.#groupShown.set(group, requested.layer.id);
      }
    }
    for (const entry of this.#entries.values()) {
      const options = this.#optionsFor(entry);
      if (entry.applied && !sameOptions(entry.applied, options)) {
        this.#host.updateTileset(entry.layer.id, options);
        entry.applied = options;
      }
    }
  }

  #publish(): void {
    this.#status = new Map([...this.#entries].map(([id, { status }]) => [id, status]));
    this.#onStatus(this.#status);
  }
}
