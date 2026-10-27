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

/** 路线上的一点：脚下地板的 [经度, 纬度, 椭球高]，视点在它上面一个眼高 */
export type RoutePoint = readonly [lng: number, lat: number, floor: number];

/** 路线漫游（ADR 0083 第 2 节）：拥有者持有意图，视图逐帧推进并报告进度 */
export interface RouteRoam {
  readonly kind: 'route';
  /** 这一次漫游：换路线时换一个 */
  readonly id: string;
  readonly path: readonly RoutePoint[];
  readonly playing: boolean;
  /** 倍速，1 是步行的默认速度 */
  readonly rate: number;
  /** 重新开始时加 1，视图回到起点 */
  readonly run: number;
}

/** 漫游；3D.4c 的步行漫游再加一种 */
export type SceneRoam = RouteRoam;

/** 三维独有的内容；二维视图不读 */
export interface SceneContent {
  readonly tilesets: readonly TilesetLayer[];
  readonly underground: UndergroundView | null;
  /** 没有漫游时不写 */
  readonly roam?: SceneRoam;
}

/** 视图报告的漫游进度：属于哪一次漫游、第几遍，走过的和总的长度（米） */
export interface RoamStatus {
  readonly id: string;
  readonly run: number;
  readonly distance: number;
  readonly total: number;
  readonly finished: boolean;
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

function validateRoam({ id, path, rate, run }: SceneRoam): void {
  if (path.length < 2) {
    throw new Error(`漫游 ${id} 的路线少于两个点`);
  }
  if (!path.every(point => point.length === 3 && point.every(Number.isFinite))) {
    throw new Error(`漫游 ${id} 的路线有不是数的坐标`);
  }
  if (!(rate > 0 && Number.isFinite(rate))) {
    throw new Error(`漫游 ${id} 的倍速不是正数：${rate}`);
  }
  if (!Number.isInteger(run) || run < 0) {
    throw new Error(`漫游 ${id} 的遍数不是非负整数：${run}`);
  }
}

function validate({ tilesets, underground, roam }: SceneContent): void {
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
  if (roam) {
    validateRoam(roam);
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
