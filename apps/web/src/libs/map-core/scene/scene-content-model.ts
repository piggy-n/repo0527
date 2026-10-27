import type { CameraState } from '../camera/camera-model';
import type { Unsubscribe } from '../events';
import { ModelEvents } from '../model-events';

/** 瓦片集的光照：地面上的按太阳，地下、室内用以相机为光源的头灯（ADR 0081 第 3 节） */
export type TilesetLighting = 'sun' | 'headlight';

/** 一个 3D Tiles 瓦片集（ADR 0081 第 2 节） */
export interface TilesetLayer {
  readonly id: string;
  /** tileset.json 的绝对地址：整理索引时按它解析相对的引用 */
  readonly url: string;
  readonly show: boolean;
  /** 同组的只显示一个（白膜的各种效果）：换显示的那个时，旧的留到新的首批瓦片到位 */
  readonly group?: string;
  readonly lighting: TilesetLighting;
  /** 失败后重试时加 1，视图看到新的值就重新加载 */
  readonly attempt: number;
}

/** 钻地观察：这个瓦片集占地范围里的地表半透明（ADR 0081 第 6 节） */
export interface UndergroundView {
  readonly tilesetId: string;
  /** 地表的不透明度，0～1 */
  readonly surfaceOpacity: number;
}

/** 三维独有的内容；二维视图不读 */
export interface SceneContent {
  readonly tilesets: readonly TilesetLayer[];
  readonly underground: UndergroundView | null;
}

/** 视图报告的瓦片集状态；就绪后带上让整个瓦片集进入画布的相机 */
export type TilesetStatus =
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly camera: CameraState }
  | { readonly state: 'failed'; readonly error: unknown };

/** 按瓦片集 ID 的状态；每次变化换一个新的 Map */
export type SceneStatus = ReadonlyMap<string, TilesetStatus>;

export const NO_SCENE_STATUS: SceneStatus = new Map();

export const EMPTY_SCENE_CONTENT: SceneContent = Object.freeze({ tilesets: Object.freeze([]), underground: null });

interface SceneContentModelEvents {
  change: (content: SceneContent) => void;
}

function validate({ tilesets, underground }: SceneContent): void {
  const ids = new Set<string>();
  for (const { id, url, attempt } of tilesets) {
    if (ids.has(id)) {
      throw new Error(`瓦片集 ID 重复：${id}`);
    }
    ids.add(id);
    if (!URL.canParse(url)) {
      throw new Error(`瓦片集 ${id} 的地址不是绝对地址：${url}`);
    }
    if (!Number.isInteger(attempt) || attempt < 0) {
      throw new Error(`瓦片集 ${id} 的重试次数不是非负整数：${attempt}`);
    }
  }
  if (underground) {
    if (!ids.has(underground.tilesetId)) {
      throw new Error(`钻地的瓦片集不存在：${underground.tilesetId}`);
    }
    const { surfaceOpacity } = underground;
    if (!(surfaceOpacity >= 0 && surfaceOpacity <= 1)) {
      throw new Error(`地表不透明度不在 0～1 之间：${surfaceOpacity}`);
    }
  }
}

/**
 * 会话的三维内容（ADR 0081 第 2 节）：整体替换，每次替换修订号加 1，同一轮事件循环里的替换合并成一次通知；
 * 不合法时抛错，状态不变
 */
export class SceneContentModel implements Disposable {
  readonly #events = new ModelEvents<SceneContentModelEvents>('SceneContentModel');
  #current = EMPTY_SCENE_CONTENT;
  #revision = 0;
  #notified = 0;
  #flushScheduled = false;

  get current(): SceneContent {
    return this.#current;
  }

  /** 每次替换加 1 */
  get revision(): number {
    return this.#revision;
  }

  /** 换成这份内容；同一个对象不算变化 */
  set(content: SceneContent): void {
    this.#events.assertAlive();
    if (content === this.#current) {
      return;
    }
    validate(content);
    this.#current = content;
    this.#revision++;
    if (!this.#flushScheduled) {
      this.#flushScheduled = true;
      queueMicrotask(() => this.#flush());
    }
  }

  on<E extends keyof SceneContentModelEvents>(event: E, callback: SceneContentModelEvents[E]): Unsubscribe {
    return this.#events.on(event, callback);
  }

  [Symbol.dispose](): void {
    this.#events[Symbol.dispose]();
  }

  #flush(): void {
    this.#flushScheduled = false;
    if (this.#events.disposed || this.#notified === this.#revision) {
      return;
    }
    this.#notified = this.#revision;
    this.#events.emit('change', this.#current);
  }
}
