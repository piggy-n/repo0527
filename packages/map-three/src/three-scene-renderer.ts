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
import { type BudgetPose, ErrorScale } from './error-scale';
import { FrameMath, toNdc } from './frame';
import type { FogUniform } from './lighting';
import { TileUploader } from './tile-uploader';
import { TilesetEntry, type TilesetEntryInspection } from './tileset-entry';
import { WalkMarker } from './walk-marker';

// 缓存预算和 Cesium 的数值相同（scene-tilesets 的 cacheBytes 加 maximumCacheOverflowBytes，1 GB + 1 GB，ADR 0147 第 5 节）；
// Cesium 是每个瓦片集各一份，这里所有瓦片集共用一份，总量更紧。放不下时放宽屏幕误差，见 docs/modules/map-three.md"缓存"
const MEGABYTE = 1024 * 1024;
const CACHE_BYTES = 1024 * MEGABYTE;
const CACHE_OVERFLOW_BYTES = 1024 * MEGABYTE;
// 每帧上传的字节（ADR 0147 第 5 节）：GPU 耗时每 MB 约 0.5 毫秒，这么多放得进 60 帧的一帧。实测见 docs/modules/map-three.md"上传"
const UPLOAD_BYTES_PER_FRAME = 16 * MEGABYTE;
// 相机这么多秒走的路达到瓦片直径就不请求（同 Cesium：60 帧的路）。取值和实测见 docs/modules/map-three.md"动着的时候不请求"
const REQUEST_CULL_SECONDS = 1;
const FRAME_MS = 1000 / 60;

/** 构造参数都有默认值，性能测量时换着比较 */
export interface ThreeSceneRendererOptions {
  /** 缓存淘汰到的大小（字节） */
  readonly cacheBytes?: number;
  /** 到它不再加载（字节） */
  readonly cacheLimitBytes?: number;
  /** 每帧提前上传的字节；null 时不提前上传，第一次绘制时才上传 */
  readonly uploadBytesPerFrame?: number | null;
  /** 相机这么多秒走的路达到瓦片直径就不请求；null 时动着也请求 */
  readonly requestCullSeconds?: number | null;
}

/** 读数（只读快照）：给性能测量和测试，业务代码不用 */
export interface ThreeSceneInspection {
  /** 累计：画过的帧数 */
  readonly frames: number;
  /** 最近一帧：画瓦片、模型的绘制调用数和三角形数 */
  readonly drawCalls: number;
  readonly triangles: number;
  /** Three 跟踪的 GPU 资源数 */
  readonly geometries: number;
  readonly textures: number;
  readonly cachedBytes: number;
  readonly pinnedBytes: number;
  readonly cacheBytes: number;
  readonly cacheLimitBytes: number;
  /** 屏幕误差放宽的倍数 */
  readonly errorScale: number;
  /** 锁在这个姿态上：相机不离开就不再收紧 */
  readonly locked: boolean;
  /** 最粗一层也放不下，再放宽也没有用 */
  readonly saturated: boolean;
  /** 最近一帧因为缓存满没能排队的瓦片数 */
  readonly refused: number;
  /** 下载、解析、等待上传的瓦片数 */
  readonly loading: number;
  /** 等待上传的瓦片数 */
  readonly uploadPending: number;
  /** 累计提前上传的字节 */
  readonly uploadedBytes: number;
  /** 瓦片都到了，放宽的倍数也不再变 */
  readonly settled: boolean;
  readonly tilesets: Readonly<Record<string, TilesetEntryInspection>>;
}

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
  readonly #scale: ErrorScale;
  readonly #uploader: TileUploader;
  readonly #cacheBytes: number;
  readonly #cacheLimitBytes: number;
  readonly #requestCullSeconds: number | null;
  #surface: SceneSurface | null = null;
  #webgl: WebGLRenderer | null = null;
  #attached = false;
  // 最近一帧的投影：拾取、投影按它算
  #frame: SceneFrame | null = null;
  // 抬高（ADR 0147 第 4 节）：只在这个瓦片集还在时生效
  #lift: SceneLift | null = null;
  #disposed = false;
  // 读数：累计帧数、最近一帧的时刻和这一帧的结果
  #frames = 0;
  #lastFrameAt = 0;
  #pinnedBytes = 0;
  #refused = 0;
  #steady = true;
  // 新瓦片到了、还没有画过的一帧：这时读数还是旧的
  #framePending = false;

  constructor({
    cacheBytes = CACHE_BYTES,
    cacheLimitBytes = CACHE_BYTES + CACHE_OVERFLOW_BYTES,
    uploadBytesPerFrame = UPLOAD_BYTES_PER_FRAME,
    requestCullSeconds = REQUEST_CULL_SECONDS
  }: ThreeSceneRendererOptions = {}) {
    this.#cacheBytes = cacheBytes;
    this.#cacheLimitBytes = cacheLimitBytes;
    this.#requestCullSeconds = requestCullSeconds;
    this.#cache.unloadPriorityCallback = DEFAULT_LRU_CACHE.unloadPriorityCallback;
    this.#cache.minBytesSize = cacheBytes;
    this.#cache.maxBytesSize = cacheLimitBytes;
    this.#scale = new ErrorScale({ hardBytes: cacheLimitBytes });
    this.#uploader = new TileUploader(uploadBytesPerFrame, () => this.#requestFrame());
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
      // 一帧有多次 render：读数要整帧的
      webgl.info.autoReset = false;
      // 视口每帧按画布的实际像素设，不跟着设备像素比再放大
      webgl.setPixelRatio(1);
      this.#webgl = webgl;
    }
    this.#attached = true;
    this.#uploader.setActive(true);
    surface.requestRepaint();
  }

  detach(): void {
    this.#attached = false;
    this.#uploader.setActive(false);
  }

  loseContext(): void {
    this.#uploader.setActive(false);
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
    this.#framePending = false;
    const { canvas } = surface;
    const lifted = this.#activeLift();
    // 先作废 Three 的状态缓存：MapLibre 改过 GL 状态，之后的上传和绘制都从真实的状态开始
    webgl.resetState();
    webgl.setViewport(0, 0, canvas.width, canvas.height);
    this.#uploader.run(webgl);
    webgl.info.reset();
    if (lifted) {
      // 抬高期间二维、天空都不该看到：先用底色盖住（模板缓冲是 MapLibre 的，不清）
      webgl.setClearColor(this.#backdrop.set(lifted.backdrop), 1);
      webgl.clear(true, true, false);
    } else {
      webgl.clearDepth();
    }
    const drawn: TilesetEntry[] = [];
    for (const [id, entry] of this.#tilesets) {
      if (lifted && id !== lifted.tilesetId) {
        entry.skipFrame();
      } else if (entry.prepare(frame, surface, canvas.width, canvas.height)) {
        webgl.render(entry.scene, entry.camera);
        drawn.push(entry);
      }
    }
    this.#adjustErrorScale(drawn, surface);
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
      uploader: this.#uploader,
      requestCullSeconds: this.#requestCullSeconds,
      events: {
        failed: error => this.#emitter.emit('tilesetfailed', id, new Error(`瓦片集 ${id} 的瓦片加载失败`, { cause: error })),
        initial: () => this.#emitter.emit('tilesetinitial', id),
        repaint: () => this.#requestFrame()
      }
    });
    entry.setErrorScale(this.#scale.value);
    this.#scale.release();
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
    this.#scale.release();
    this.#surface?.requestRepaint();
  }

  removeTileset(id: string): void {
    const entry = this.#tilesets.get(id);
    if (!entry) {
      return;
    }
    this.#tilesets.delete(id);
    entry[Symbol.dispose]();
    this.#scale.release();
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
    this.#scale.release();
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

  /** 读数（性能测量、测试用） */
  inspect(): ThreeSceneInspection {
    const info = this.#webgl?.info;
    const uploadPending = this.#uploader.pending;
    let loading = 0;
    for (const entry of this.#tilesets.values()) {
      loading += entry.loading;
    }
    return {
      frames: this.#frames,
      drawCalls: info?.render.calls ?? 0,
      triangles: info?.render.triangles ?? 0,
      geometries: info?.memory.geometries ?? 0,
      textures: info?.memory.textures ?? 0,
      cachedBytes: (this.#cache as unknown as { readonly cachedBytes: number }).cachedBytes,
      pinnedBytes: this.#pinnedBytes,
      cacheBytes: this.#cacheBytes,
      cacheLimitBytes: this.#cacheLimitBytes,
      errorScale: this.#scale.value,
      locked: this.#scale.locked,
      saturated: this.#scale.saturated,
      refused: this.#refused,
      loading,
      uploadPending,
      uploadedBytes: this.#uploader.uploadedBytes,
      settled: this.#steady && !this.#framePending && loading === 0 && uploadPending === 0,
      tilesets: Object.fromEntries([...this.#tilesets].map(([id, entry]) => [id, entry.inspect()]))
    };
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
    this.#uploader[Symbol.dispose]();
    this.#dropRenderer();
    this.#emitter.events = {};
  }

  #requestFrame(): void {
    this.#framePending = true;
    this.#surface?.requestRepaint();
  }

  // 这一帧所有瓦片集更新完了：按缓存的状况调屏幕误差，下一帧生效（规则见 ErrorScale）
  #adjustErrorScale(drawn: readonly TilesetEntry[], surface: SceneSurface): void {
    const now = performance.now();
    const elapsedMs = this.#lastFrameAt === 0 ? FRAME_MS : now - this.#lastFrameAt;
    this.#lastFrameAt = now;
    this.#frames++;
    let pose: BudgetPose | null = null;
    let refused = 0;
    let pinnedBytes = 0;
    let pendingBytes = 0;
    let usedTiles = 0;
    let culled = false;
    for (const entry of drawn) {
      culled ||= entry.culled > 0;
      const demand = entry.demand();
      refused += demand.refused;
      pinnedBytes += demand.pinnedBytes;
      pendingBytes += demand.pendingBytes;
      usedTiles += demand.usedTiles;
      pose ??= entry.pose();
    }
    this.#refused = refused;
    this.#pinnedBytes = pinnedBytes;
    if (!pose) {
      this.#steady = true;
      return;
    }
    const { cachedBytes } = this.#cache as unknown as { readonly cachedBytes: number };
    const motion = this.#scale.update({ refused, cachedBytes, pinnedBytes, pendingBytes, usedTiles }, pose, elapsedMs);
    // 有没请求的瓦片时要再画一帧：相机停下以后没有别的理由再画，它们就永远不会被请求
    this.#steady = motion === 'steady' && !culled;
    if (!this.#steady) {
      surface.requestRepaint();
    }
    for (const entry of this.#tilesets.values()) {
      entry.setErrorScale(this.#scale.value);
    }
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
