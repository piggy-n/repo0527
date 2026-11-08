import type {
  LngLat,
  PreparedTileset,
  SceneFrame,
  SceneLift,
  SceneMarker,
  ScenePick,
  SceneRenderer,
  SceneRendererEvents,
  SceneSurface,
  ScreenPoint,
  TilesetOptions,
  TilesetSphere,
  Unsubscribe
} from '@mx/map-core';
import { DEFAULT_LRU_CACHE, LRUCache } from '3d-tiles-renderer';
import { createNanoEvents } from 'nanoevents';
import { Color, Matrix4, Raycaster, WebGLRenderer } from 'three';
import { AnimatedModel, type ModelPlacement } from './animated-model';
import { FrameMath, toNdc } from './frame';
import type { FogUniform } from './lighting';
import { TilesetEntry } from './tileset-entry';
import { WalkMarker } from './walk-marker';

// 缓存预算和 Cesium 的数值相同（scene-tilesets 的 cacheBytes 加 maximumCacheOverflowBytes，ADR 0147 第 5 节）；
// Cesium 是每个瓦片集各一份，这里所有瓦片集共用一份，总量更紧。满了以后放宽屏幕误差的自适应缓存是 3C.4
const MEGABYTE = 1024 * 1024;
const CACHE_BYTES = 1024 * MEGABYTE;
const CACHE_OVERFLOW_BYTES = 512 * MEGABYTE;

// MapLibre 每帧给的矩阵可能复用同一个数组：留到拾取、投影时用的要复制一份
function copyFrame({ mainMatrix, fallbackMatrix, projectionMatrix, transition, clippingPlane }: SceneFrame): SceneFrame {
  return {
    mainMatrix: Float64Array.from(mainMatrix),
    fallbackMatrix: Float64Array.from(fallbackMatrix),
    projectionMatrix: Float64Array.from(projectionMatrix),
    transition,
    clippingPlane: [...clippingPlane]
  };
}

/**
 * MapLibre 引擎的三维渲染器（ADR 0147 第 2、5 节）：一个 WebGLRenderer 和 MapLibre 共用 GL 上下文，
 * 每个瓦片集、模型各自的局部系和相机；撤下层时保留 GPU 资源，上下文丢失时丢掉渲染器，恢复后重新上传
 */
export class ThreeSceneRenderer implements SceneRenderer {
  readonly #emitter = createNanoEvents<SceneRendererEvents>();
  readonly #tilesets = new Map<string, TilesetEntry>();
  readonly #models = new Map<string, AnimatedModel>();
  readonly #math = new FrameMath();
  readonly #cache = new LRUCache();
  readonly #raycaster = new Raycaster();
  readonly #scratch = new Matrix4();
  readonly #fog: FogUniform = { value: 0 };
  readonly #marker = new WalkMarker(this.#math);
  readonly #backdrop = new Color();
  #surface: SceneSurface | null = null;
  #webgl: WebGLRenderer | null = null;
  #attached = false;
  // 最近一帧的投影：拾取、投影按它算
  #frame: SceneFrame | null = null;
  // 抬高（ADR 0147 第 4 节）：只在这个瓦片集还在时生效
  #lift: SceneLift | null = null;
  #disposed = false;

  constructor() {
    this.#cache.unloadPriorityCallback = DEFAULT_LRU_CACHE.unloadPriorityCallback;
    this.#cache.minBytesSize = CACHE_BYTES;
    this.#cache.maxBytesSize = CACHE_BYTES + CACHE_OVERFLOW_BYTES;
  }

  attach(surface: SceneSurface): void {
    this.#assertAlive();
    // 换了上下文（不同的地图）时旧的渲染器不能再用
    if (this.#webgl && this.#surface?.gl !== surface.gl) {
      this.#dropRenderer();
    }
    this.#surface = surface;
    if (!this.#webgl) {
      const webgl = new WebGLRenderer({ canvas: surface.canvas, context: surface.gl });
      webgl.autoClear = false;
      // 视口每帧按画布的实际像素设，不跟着设备像素比再放大
      webgl.setPixelRatio(1);
      this.#webgl = webgl;
    }
    this.#attached = true;
    surface.requestRepaint();
  }

  detach(): void {
    this.#attached = false;
  }

  loseContext(): void {
    this.#dropRenderer();
    this.#frame = null;
  }

  // 什么也不画：有它时 MapLibre 在画图层之前作废自己的 GL 状态缓存
  prerender(): void {}

  render(frame: SceneFrame): void {
    const webgl = this.#webgl;
    const surface = this.#surface;
    if (!this.#attached || !webgl || !surface) {
      return;
    }
    this.#frame = copyFrame(frame);
    const { canvas } = surface;
    const lifted = this.#activeLift();
    // 先作废 Three 的状态缓存：MapLibre 改过 GL 状态，之后的上传和绘制都从真实的状态开始
    webgl.resetState();
    webgl.setViewport(0, 0, canvas.width, canvas.height);
    if (lifted) {
      // 抬高期间二维、天空都不该看到：先用底色盖住（模板缓冲是 MapLibre 的，不清）
      webgl.setClearColor(this.#backdrop.set(lifted.backdrop), 1);
      webgl.clear(true, true, false);
    } else {
      webgl.clearDepth();
    }
    for (const [id, entry] of this.#tilesets) {
      if (lifted && id !== lifted.tilesetId) {
        entry.skipFrame();
      } else if (entry.prepare(frame, surface, canvas.width, canvas.height)) {
        webgl.render(entry.scene, entry.camera);
      }
    }
    let animating = false;
    if (!lifted) {
      for (const model of this.#models.values()) {
        if (model.prepare(frame, surface)) {
          webgl.render(model.scene, model.camera);
        }
        animating ||= model.animating;
      }
    }
    // 光环在瓦片之后画：深度测试用瓦片写下的深度，墙和柱子挡得住
    if (this.#marker.prepare(frame, surface, performance.now())) {
      webgl.render(this.#marker.scene, this.#marker.camera);
      animating = true;
    }
    webgl.clearDepth();
    if (animating) {
      surface.requestRepaint();
    }
  }

  endFrame(): void {
    this.#webgl?.resetState();
  }

  async addTileset(
    id: string,
    tileset: PreparedTileset,
    options: TilesetOptions,
    signal: AbortSignal
  ): Promise<TilesetSphere> {
    this.#assertAlive();
    if (this.#tilesets.has(id)) {
      throw new Error(`瓦片集 ${id} 已经加过`);
    }
    const entry = new TilesetEntry({
      prepared: tileset,
      options,
      cache: this.#cache,
      math: this.#math,
      fog: this.#fog,
      events: {
        failed: error => this.#emitter.emit('tilesetfailed', id, new Error(`瓦片集 ${id} 的瓦片加载失败`, { cause: error })),
        initial: () => this.#emitter.emit('tilesetinitial', id),
        repaint: () => this.#surface?.requestRepaint()
      }
    });
    this.#tilesets.set(id, entry);
    try {
      const sphere = await entry.load(signal);
      signal.throwIfAborted();
      this.#assertAlive();
      if (this.#lift?.tilesetId === id) {
        entry.setLift(this.#lift.meters);
      }
      this.#surface?.requestRepaint();
      return sphere;
    } catch (error) {
      if (this.#tilesets.get(id) === entry) {
        this.#tilesets.delete(id);
      }
      entry[Symbol.dispose]();
      throw error;
    }
  }

  updateTileset(id: string, options: TilesetOptions): void {
    this.#tilesets.get(id)?.setOptions(options);
    this.#surface?.requestRepaint();
  }

  removeTileset(id: string): void {
    const entry = this.#tilesets.get(id);
    if (!entry) {
      return;
    }
    this.#tilesets.delete(id);
    entry[Symbol.dispose]();
    this.#surface?.requestRepaint();
  }

  /**
   * 加一个 glTF 模型并播放它的动画（第三人称的人物以后用，现在只有测试用到）；
   * signal 中止时以它的原因结束
   */
  async addModel(id: string, url: string, placement: ModelPlacement, signal: AbortSignal): Promise<void> {
    this.#assertAlive();
    if (this.#models.has(id)) {
      throw new Error(`模型 ${id} 已经加过`);
    }
    const model = await AnimatedModel.load(url, placement, this.#math, signal);
    if (this.#disposed || this.#models.has(id)) {
      model[Symbol.dispose]();
      throw new Error(this.#disposed ? '三维渲染器已释放' : `模型 ${id} 已经加过`);
    }
    this.#models.set(id, model);
    this.#surface?.requestRepaint();
  }

  /** 模型的动画已经播放的秒数；没有这个模型时为 null */
  modelTime(id: string): number | null {
    return this.#models.get(id)?.time ?? null;
  }

  pick(point: ScreenPoint): ScenePick | null {
    const canvas = this.#surface?.canvas;
    if (!this.#frame || !canvas) {
      return null;
    }
    const ndc = toNdc(point, { width: canvas.clientWidth, height: canvas.clientHeight });
    let nearest: { distance: number; lngLatHeight: [number, number, number] } | null = null;
    // 每个瓦片集有自己的局部系，同一条视线上的距离都是米、起点相同，可以直接比较
    for (const entry of this.#tilesets.values()) {
      const hit = entry.pick(this.#raycaster, ndc);
      if (hit && (!nearest || hit.distance < nearest.distance)) {
        nearest = hit;
      }
    }
    if (!nearest) {
      return null;
    }
    const [lng, lat, height] = nearest.lngLatHeight;
    return { lngLat: [lng, lat], height };
  }

  project(lngLat: LngLat, height: number): ScreenPoint | null {
    const surface = this.#surface;
    if (!this.#frame || !surface) {
      return null;
    }
    const { clientWidth: width, clientHeight } = surface.canvas;
    // 抬高期间整个场景一起上移：真实的高度加上抬高量
    const lifted = height + (this.#activeLift()?.meters ?? 0);
    return this.#math.project(this.#frame, surface.anchor(...lngLat), lifted, { width, height: clientHeight }, this.#scratch);
  }

  setLift(lift: SceneLift | null): void {
    this.#lift = lift;
    for (const [id, entry] of this.#tilesets) {
      entry.setLift(lift?.tilesetId === id ? lift.meters : 0);
    }
    this.#marker.setLift(this.#activeLift()?.meters ?? 0);
    this.#surface?.requestRepaint();
  }

  lowestHeight(id: string): number | null {
    return this.#tilesets.get(id)?.lowestHeight() ?? null;
  }

  setInteriorFog(enabled: boolean): void {
    this.#fog.value = enabled ? 1 : 0;
    this.#surface?.requestRepaint();
  }

  setMarker(marker: SceneMarker | null): void {
    if (marker) {
      this.#marker.setLift(this.#activeLift()?.meters ?? 0);
      this.#marker.show(marker);
    } else {
      this.#marker.hide();
    }
    this.#surface?.requestRepaint();
  }

  on<E extends keyof SceneRendererEvents>(event: E, callback: SceneRendererEvents[E]): Unsubscribe {
    return this.#emitter.on(event, callback);
  }

  [Symbol.dispose](): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    for (const entry of this.#tilesets.values()) {
      entry[Symbol.dispose]();
    }
    this.#tilesets.clear();
    for (const model of this.#models.values()) {
      model[Symbol.dispose]();
    }
    this.#models.clear();
    this.#marker[Symbol.dispose]();
    this.#dropRenderer();
    this.#emitter.events = {};
  }

  // 抬高的瓦片集还在时才算抬高：被移除以后照常画其他内容
  #activeLift(): SceneLift | null {
    const lift = this.#lift;
    return lift && lift.meters !== 0 && this.#tilesets.has(lift.tilesetId) ? lift : null;
  }

  // 丢掉 WebGLRenderer：它跟踪的 GPU 资源随之作废，下次画时重新上传；内容（瓦片、模型）保留
  #dropRenderer(): void {
    this.#webgl?.dispose();
    this.#webgl = null;
  }

  #assertAlive(): void {
    if (this.#disposed) {
      throw new Error('三维渲染器已释放');
    }
  }
}
