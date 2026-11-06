import type { CameraState } from '../camera/camera-model';
import type { Unsubscribe } from '../events';
import type { LoadJson, PreparedTileset } from '../scene/prepare-tileset';
import type { SceneContentModel, SceneStatus } from '../scene/scene-content-model';
import { tilesetCamera } from '../scene/tileset-camera';
import { SceneTilesetSync, type TilesetOptions } from '../scene/tileset-sync';
import type { LngLat, ScreenPoint } from '../view/view-input';
import { SCENE_LAYER_ID, SceneLayer, type SceneLayerMap } from './scene-layer';
import type { ScenePick, SceneRenderer, SceneRendererLoader } from './scene-renderer';

/** 三维模型层用到的地图能力；MapLibre 的 Map 满足它（见 MapLike） */
export interface SceneMap extends SceneLayerMap {
  addLayer(layer: SceneLayer): void;
  removeLayer(id: string): void;
  getLayer(id: string): unknown;
  moveLayer(id: string): void;
  getLayersOrder(): string[];
}

export interface MapLibreSceneOptions {
  readonly map: SceneMap;
  readonly scene: SceneContentModel;
  readonly loadRenderer: SceneRendererLoader;
  readonly loadJson: LoadJson;
  readonly onError: (error: unknown) => void;
  /** 瓦片集的状态变了 */
  readonly onStatus: (status: SceneStatus) => void;
}

/**
 * MapLibre 引擎的三维内容（ADR 0147 第 2 节）：第一次要加瓦片集时加载渲染器，模型层只在视图显示三维、
 * 样式已加载时挂在地图上；三维内容在不显示三维时不应用，切回三维再应用（同 Cesium 暂停时的做法）。
 * 渲染器加载失败记成各瓦片集的 failed，重试（换重试次数）时重新加载
 */
export class MapLibreScene implements Disposable {
  readonly #map: SceneMap;
  readonly #content: SceneContentModel;
  readonly #loadRenderer: SceneRendererLoader;
  readonly #onError: (error: unknown) => void;
  readonly #sync: SceneTilesetSync;
  readonly #unsubscribeContent: Unsubscribe;
  #renderer: SceneRenderer | null = null;
  #layer: SceneLayer | null = null;
  #unsubscribeRenderer: Unsubscribe | null = null;
  #loading: Promise<SceneRenderer> | null = null;
  // 显示三维、视图就绪
  #active = false;
  // 地图上的样式已加载，可以加图层
  #styleLoaded = false;
  // 不显示三维期间三维内容变了
  #stale = true;
  #disposed = false;

  constructor({ map, scene, loadRenderer, loadJson, onError, onStatus }: MapLibreSceneOptions) {
    this.#map = map;
    this.#content = scene;
    this.#loadRenderer = loadRenderer;
    this.#onError = onError;
    this.#sync = new SceneTilesetSync({
      host: {
        addTileset: (id, tileset, options, signal) => this.#addTileset(id, tileset, options, signal),
        updateTileset: (id, options) => this.#renderer?.updateTileset(id, options),
        removeTileset: id => this.#renderer?.removeTileset(id)
      },
      loadJson,
      onStatus
    });
    this.#unsubscribeContent = scene.on('change', () => this.#onContentChange());
  }

  get status(): SceneStatus {
    return this.#sync.status;
  }

  /** 视图的种类、状态或地图样式的加载状态变了：按现在的情况挂上或撤下模型层，追上积下的三维内容 */
  update(active: boolean, styleLoaded: boolean): void {
    if (this.#disposed) {
      return;
    }
    this.#active = active;
    this.#styleLoaded = styleLoaded;
    this.#placeLayer();
    if (active && this.#stale) {
      this.#applyContent();
    }
  }

  /** 样式应用了增量命令：新加的图层排在最上面，把模型层挪回最上面（和覆盖物的叠放在 3C.2 再定） */
  keepOnTop(): void {
    if (this.#map.getLayer(SCENE_LAYER_ID) === undefined) {
      return;
    }
    const order = this.#map.getLayersOrder();
    if (order.at(-1) !== SCENE_LAYER_ID) {
      this.#map.moveLayer(SCENE_LAYER_ID);
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

  /** 显示三维时拾取模型 */
  pick(point: ScreenPoint): ScenePick | null {
    return this.#active ? (this.#renderer?.pick(point) ?? null) : null;
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
    this.#unsubscribeContent();
    this.#sync[Symbol.dispose]();
    this.#unsubscribeRenderer?.();
    this.#renderer?.[Symbol.dispose]();
    this.#renderer = null;
    this.#layer = null;
  }

  #onContentChange(): void {
    if (this.#active) {
      this.#applyContent();
    } else {
      this.#stale = true;
    }
  }

  #applyContent(): void {
    this.#stale = false;
    this.#sync.apply(this.#content.current.tilesets);
  }

  // 模型层挂在地图上，当且仅当显示三维、样式已加载、渲染器已创建
  #placeLayer(): void {
    const layer = this.#layer;
    const present = this.#map.getLayer(SCENE_LAYER_ID) !== undefined;
    const wanted = this.#active && this.#styleLoaded && layer !== null;
    try {
      if (wanted && !present) {
        this.#map.addLayer(layer);
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
    signal: AbortSignal
  ): Promise<CameraState> {
    const renderer = await this.#ensureRenderer();
    signal.throwIfAborted();
    const sphere = await renderer.addTileset(id, tileset, options, signal);
    signal.throwIfAborted();
    return tilesetCamera(sphere, this.#map.getCanvas().clientHeight);
  }

  // 第一次要用时加载并创建渲染器；失败时下一次重新加载
  #ensureRenderer(): Promise<SceneRenderer> {
    if (this.#renderer) {
      return Promise.resolve(this.#renderer);
    }
    this.#loading ??= this.#loadRenderer()
      .then(create => {
        if (this.#disposed) {
          throw new DOMException('三维内容已释放', 'AbortError');
        }
        const renderer = create();
        this.#renderer = renderer;
        this.#layer = new SceneLayer(renderer, this.#onError);
        const unsubscribeFailed = renderer.on('tilesetfailed', (id, error) => this.#sync.failed(id, error));
        const unsubscribeInitial = renderer.on('tilesetinitial', id => this.#sync.initial(id));
        this.#unsubscribeRenderer = () => {
          unsubscribeFailed();
          unsubscribeInitial();
        };
        this.#placeLayer();
        return renderer;
      })
      .finally(() => {
        this.#loading = null;
      });
    return this.#loading;
  }
}
