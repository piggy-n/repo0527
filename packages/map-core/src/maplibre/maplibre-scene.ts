import type { CameraState } from '../camera/camera-model';
import type { Unsubscribe } from '../events';
import type { LoadJson, PreparedTileset } from '../scene/prepare-tileset';
import { NO_SCENE_ACTIVITY, type SceneActivities } from '../scene/scene-activity';
import {
  type GroundPoint,
  NO_SCENE_STATUS,
  type SceneContent,
  type SceneContentModel,
  type SceneStatus
} from '../scene/scene-content-model';
import { tilesetCamera, type TilesetSphere } from '../scene/tileset-camera';
import { mergeSceneStatus, SceneSplatSync, type SplatOptions, type SplatSource } from '../scene/splat-sync';
import { SceneTilesetSync, type TilesetOptions } from '../scene/tileset-sync';
import { deferred, type Deferred } from '../view/view-lifecycle';
import type { LngLat, PickOptions, ScreenPoint } from '../view/view-input';
import { SCENE_LAYER_ID, SceneLayer, type SceneLayerMap } from './scene-layer';
import type { ScenePick, SceneRenderer, SceneRendererLoader } from './scene-renderer';

/** 三维模型层用到的地图能力；MapLibre 的 Map 满足它（见 MapLike） */
export interface SceneMap extends SceneLayerMap {
  addLayer(layer: SceneLayer, beforeId?: string): void;
  removeLayer(id: string): void;
  getLayer(id: string): unknown;
  /** 不给 beforeId 时挪到最上面 */
  moveLayer(id: string, beforeId?: string): void;
  getLayersOrder(): string[];
}

/** 三维模块（@mx/map-three 和 three）的加载状态：还没要过、加载中、已加载、加载失败 */
export type SceneModuleState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready' }
  | { readonly kind: 'failed'; readonly error: unknown };

export interface MapLibreSceneOptions {
  readonly map: SceneMap;
  readonly scene: SceneContentModel;
  readonly loadRenderer: SceneRendererLoader;
  readonly loadJson: LoadJson;
  readonly onError: (error: unknown) => void;
  /** 瓦片集、高斯泼溅的状态变了 */
  readonly onStatus: (status: SceneStatus) => void;
  /** 三维模块的加载状态变了 */
  readonly onModuleChange: (state: SceneModuleState) => void;
  /** 瓦片集、高斯泼溅这一轮的加载有变化（ADR 0162）：每块瓦片都可能通知一次 */
  readonly onActivity?: () => void;
  /** 瓦片集之外的三维内容（漫游、地下）要应用：和瓦片集同时，只在显示三维、渲染器建好以后 */
  readonly onContent?: (content: SceneContent) => void;
  /** 贴地的表面高度（ADR 0170）：有地形时是这个经纬度的地形高度（米）；不给时表面是 0 米 */
  readonly surfaceHeight?: SurfaceHeight;
}

/** 这个经纬度上引擎表面的高度（米）；signal 中止时以它的原因结束 */
export type SurfaceHeight = (lngLat: LngLat, signal: AbortSignal) => Promise<number>;

const IDLE: SceneModuleState = Object.freeze({ kind: 'idle' });
const LOADING: SceneModuleState = Object.freeze({ kind: 'loading' });
const READY: SceneModuleState = Object.freeze({ kind: 'ready' });

/**
 * MapLibre 引擎的三维内容（ADR 0147 第 2 节）：视图第一次切到三维时加载三维模块，失败时由视图的 retry 重新加载；
 * 模型层只在显示三维、样式已加载、模块已加载时挂在地图上，插在 before 图层下面（没有时在最上面）；
 * 三维内容在不显示三维时不应用，切回三维再应用
 */
export class MapLibreScene implements Disposable {
  readonly #map: SceneMap;
  readonly #content: SceneContentModel;
  readonly #loadRenderer: SceneRendererLoader;
  readonly #onError: (error: unknown) => void;
  readonly #onModuleChange: (state: SceneModuleState) => void;
  readonly #onContent: ((content: SceneContent) => void) | undefined;
  readonly #onStatus: (status: SceneStatus) => void;
  readonly #onActivity: (() => void) | undefined;
  readonly #surfaceHeight: SurfaceHeight | undefined;
  readonly #sync: SceneTilesetSync;
  readonly #splats: SceneSplatSync;
  readonly #unsubscribeContent: Unsubscribe;
  // 瓦片集和泼溅合在一起的状态
  #status: SceneStatus = NO_SCENE_STATUS;
  #module: SceneModuleState = IDLE;
  // 这一次加载的结果：重试时换一个新的
  #loaded: Deferred = deferred();
  #renderer: SceneRenderer | null = null;
  #layer: SceneLayer | null = null;
  #unsubscribeRenderer: Unsubscribe | null = null;
  // 显示三维、视图就绪
  #active = false;
  // 地图上的样式已加载，可以加图层
  #styleLoaded = false;
  // 模型层插在这个图层下面；没有时在最上面
  #before: string | undefined;
  // 不显示三维期间三维内容变了
  #stale = true;
  #disposed = false;

  constructor({
    map,
    scene,
    loadRenderer,
    loadJson,
    onError,
    onStatus,
    onModuleChange,
    onContent,
    onActivity,
    surfaceHeight
  }: MapLibreSceneOptions) {
    this.#map = map;
    this.#onActivity = onActivity;
    this.#surfaceHeight = surfaceHeight;
    this.#content = scene;
    this.#loadRenderer = loadRenderer;
    this.#onError = onError;
    this.#onModuleChange = onModuleChange;
    this.#onContent = onContent;
    this.#onStatus = onStatus;
    this.#sync = new SceneTilesetSync({
      host: {
        addTileset: (id, tileset, options, signal, ground) => this.#addTileset(id, tileset, options, signal, ground),
        updateTileset: (id, options) => this.#renderer?.updateTileset(id, options),
        removeTileset: id => this.#renderer?.removeTileset(id)
      },
      loadJson,
      onStatus: () => this.#publishStatus()
    });
    this.#splats = new SceneSplatSync({
      host: {
        addSplat: (id, source, options, signal, ground) => this.#addSplat(id, source, options, signal, ground),
        updateSplat: (id, options) => this.#renderer?.updateSplat(id, options),
        removeSplat: id => this.#renderer?.removeSplat(id)
      },
      onStatus: () => this.#publishStatus()
    });
    this.#unsubscribeContent = scene.on('change', () => this.#onContentChange());
  }

  get status(): SceneStatus {
    return this.#status;
  }

  get module(): SceneModuleState {
    return this.#module;
  }

  /** 瓦片集、高斯泼溅这一轮的加载（ADR 0162）；三维模块还没加载时为空 */
  get activity(): SceneActivities {
    return this.#renderer?.activity ?? NO_SCENE_ACTIVITY;
  }

  /** 三维模块加载好以后的渲染器（漫游用它拾取、投影、抬高）；还没加载时为 null */
  get renderer(): SceneRenderer | null {
    return this.#renderer;
  }

  /** 加载三维模块：还没要过、上次失败时开始加载；加载中、已加载时什么也不做 */
  load(): void {
    if (this.#disposed || this.#module.kind === 'loading' || this.#module.kind === 'ready') {
      return;
    }
    if (this.#loaded.settled) {
      this.#loaded = deferred();
    }
    const loaded = this.#loaded;
    this.#setModule(LOADING);
    void this.#loadModule(loaded);
  }

  /** 这一次加载的结果：加载好时结束，失败时以原因结束，释放时以 AbortError 结束 */
  whenLoaded(): Promise<void> {
    return this.#loaded.promise;
  }

  /**
   * 视图的种类、状态或地图样式的加载状态变了：按现在的情况挂上或撤下模型层，追上积下的三维内容。
   * before 是模型层插在哪个图层下面，没有时在最上面
   */
  update(active: boolean, styleLoaded: boolean, before: string | undefined): void {
    if (this.#disposed) {
      return;
    }
    this.#active = active;
    this.#styleLoaded = styleLoaded;
    this.#before = before;
    this.#placeLayer();
    if (active && this.#renderer && this.#stale) {
      this.#applyContent();
    }
  }

  /** 样式应用了增量命令：新加的图层排在最上面，按新快照的 before 把模型层挪回原位 */
  place(before: string | undefined): void {
    this.#before = before;
    if (this.#map.getLayer(SCENE_LAYER_ID) === undefined) {
      return;
    }
    const order = this.#map.getLayersOrder();
    const index = order.indexOf(SCENE_LAYER_ID);
    const above = order[index + 1];
    // before 不在地图上（还没加上）时也放到最上面
    const target = before !== undefined && order.includes(before) ? before : undefined;
    if (above !== target) {
      this.#map.moveLayer(SCENE_LAYER_ID, target);
    }
  }

  /** MapLibre 画完一帧：渲染器在回调外改过的 GL 状态作废（PoC 的坑 9） */
  endFrame(): void {
    if (this.#map.getLayer(SCENE_LAYER_ID) !== undefined) {
      this.#renderer?.endFrame();
    }
  }

  /** GL 上下文丢失：MapLibre 销毁了样式和自定义层，渲染器丢掉 GPU 资源；恢复后样式重新加载时再挂上 */
  loseContext(): void {
    this.#styleLoaded = false;
    this.#renderer?.loseContext();
  }

  /** 显示三维时拾取模型；悬停时不打高斯泼溅 */
  pick(point: ScreenPoint, options?: PickOptions): ScenePick | null {
    return this.#active ? (this.#renderer?.pick(point, options) ?? null) : null;
  }

  /** 显示三维时按模型层最近一帧的相机投影；还没画过时为 null */
  project(lngLat: LngLat, height: number): ScreenPoint | null {
    return this.#active ? (this.#renderer?.project(lngLat, height) ?? null) : null;
  }

  [Symbol.dispose](): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#loaded.reject(new DOMException('三维内容已释放', 'AbortError'));
    this.#unsubscribeContent();
    this.#sync[Symbol.dispose]();
    this.#splats[Symbol.dispose]();
    this.#unsubscribeRenderer?.();
    this.#renderer?.[Symbol.dispose]();
    this.#renderer = null;
    this.#layer = null;
  }

  // 下载模块、创建渲染器，任一步出错都算这次加载失败；释放以后的结果不再使用
  async #loadModule(loaded: Deferred): Promise<void> {
    try {
      const create = await this.#loadRenderer();
      if (this.#disposed) {
        return;
      }
      this.#createRenderer(create());
    } catch (error) {
      if (!this.#disposed) {
        this.#fail(loaded, error);
      }
      return;
    }
    loaded.resolve();
    this.#setModule(READY);
    this.#placeLayer();
    if (this.#active && this.#stale) {
      this.#applyContent();
    }
  }

  #createRenderer(renderer: SceneRenderer): void {
    this.#renderer = renderer;
    this.#layer = new SceneLayer(renderer, this.#onError);
    const unsubscribeFailed = renderer.on('tilesetfailed', (id, error) => this.#sync.failed(id, error));
    const unsubscribeInitial = renderer.on('tilesetinitial', id => this.#sync.initial(id));
    const unsubscribeSplatFailed = renderer.on('splatfailed', (id, error) => this.#splats.failed(id, error));
    const unsubscribeActivity = renderer.on('activitychange', () => this.#onActivity?.());
    this.#unsubscribeRenderer = () => {
      unsubscribeFailed();
      unsubscribeInitial();
      unsubscribeSplatFailed();
      unsubscribeActivity();
    };
  }

  #fail(loaded: Deferred, error: unknown): void {
    this.#onError(error);
    loaded.reject(error);
    this.#setModule(Object.freeze({ kind: 'failed', error }));
  }

  #setModule(state: SceneModuleState): void {
    this.#module = state;
    this.#onModuleChange(state);
  }

  #onContentChange(): void {
    if (this.#active && this.#renderer) {
      this.#applyContent();
    } else {
      this.#stale = true;
    }
  }

  #applyContent(): void {
    this.#stale = false;
    const content = this.#content.current;
    this.#sync.apply(content.tilesets);
    this.#splats.apply(content.splats ?? []);
    this.#onContent?.(content);
  }

  // 模型层挂在地图上，当且仅当显示三维、样式已加载、渲染器已创建
  #placeLayer(): void {
    const layer = this.#layer;
    const present = this.#map.getLayer(SCENE_LAYER_ID) !== undefined;
    const wanted = this.#active && this.#styleLoaded && layer !== null;
    try {
      if (wanted && !present) {
        const before = this.#before;
        this.#map.addLayer(layer, before !== undefined && this.#map.getLayer(before) !== undefined ? before : undefined);
      } else if (!wanted && present) {
        this.#map.removeLayer(SCENE_LAYER_ID);
      }
    } catch (error) {
      this.#onError(error);
    }
  }

  async #addTileset(
    id: string,
    tileset: PreparedTileset,
    options: TilesetOptions,
    signal: AbortSignal,
    ground: GroundPoint | undefined
  ): Promise<CameraState> {
    // 只在渲染器建好以后应用三维内容
    this.#requireRenderer();
    const offset = await this.#offsetFor(ground, signal);
    signal.throwIfAborted();
    const sphere = await this.#requireRenderer().addTileset(id, tileset, options, signal, offset);
    signal.throwIfAborted();
    return this.#cameraFor(sphere, ground);
  }

  async #addSplat(
    id: string,
    source: SplatSource,
    options: SplatOptions,
    signal: AbortSignal,
    ground: GroundPoint | undefined
  ): Promise<CameraState> {
    this.#requireRenderer();
    const offset = await this.#offsetFor(ground, signal);
    signal.throwIfAborted();
    const sphere = await this.#requireRenderer().addSplat(id, source, options, signal, offset);
    signal.throwIfAborted();
    return this.#cameraFor(sphere, ground);
  }

  #requireRenderer(): SceneRenderer {
    if (!this.#renderer) {
      throw new Error('三维模块还没有加载');
    }
    return this.#renderer;
  }

  // 贴地的平移（ADR 0170）：让参照点落到表面上。取不到地形高度时按 0 米的表面，报告错误、照样显示
  async #offsetFor(ground: GroundPoint | undefined, signal: AbortSignal): Promise<number> {
    if (!ground) {
      return 0;
    }
    const surfaceHeight = this.#surfaceHeight;
    if (!surfaceHeight) {
      return -ground.height;
    }
    try {
      return (await surfaceHeight([ground.lng, ground.lat], signal)) - ground.height;
    } catch (error) {
      signal.throwIfAborted();
      this.#onError(new Error('取不到贴地处的地形高度，按 0 米摆放', { cause: error }));
      return -ground.height;
    }
  }

  // 建议的相机按画面上的位置：贴地时球心离表面的高度是它离参照点的高度（有地形时相机的中心也在地形上）
  #cameraFor(sphere: TilesetSphere, ground: GroundPoint | undefined): CameraState {
    const height = ground ? sphere.height - ground.height : sphere.height;
    return tilesetCamera({ ...sphere, height }, this.#map.getCanvas().clientHeight);
  }

  #publishStatus(): void {
    this.#status = mergeSceneStatus(this.#sync.status, this.#splats.status);
    this.#onStatus(this.#status);
  }
}
