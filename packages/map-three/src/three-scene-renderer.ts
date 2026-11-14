import type {
  LngLat,
  PickOptions,
  PreparedTileset,
  SceneBudget,
  SceneBudgetSource,
  SceneFrame,
  SceneLift,
  SceneMarker,
  ScenePick,
  SceneRenderer,
  SceneRendererEvents,
  SceneSurface,
  ScreenPoint,
  SplatOptions,
  SplatSource,
  TilesetOptions,
  TilesetSphere,
  Unsubscribe
} from '@mx/map-core';
import { DEFAULT_LRU_CACHE, LRUCache } from '3d-tiles-renderer';
import { createNanoEvents } from 'nanoevents';
import { Color, Matrix4, Raycaster, WebGLRenderer } from 'three';
import { AnimatedModel, type ModelPlacement } from './animated-model';
import { type BudgetPose, ErrorScale } from './error-scale';
import { FrameMath, toNdc, withDeeperFar } from './frame';
import type { FogUniform } from './lighting';
import { TileUploader } from './tile-uploader';
import type { CullWindow } from './request-cull';
import { SplatEntry, type SplatEntryInspection, type SplatLibrary } from './splat-entry';
import { type ClipBox, TilesetEntry, type TilesetEntryInspection } from './tileset-entry';
import { WalkMarker } from './walk-marker';

// 缓存预算 1 GB + 1 GB（ADR 0147 第 5 节，沿用当时 Cesium 每个瓦片集的数值），所有瓦片集共用一份。
// 放不下时放宽屏幕误差，见 docs/modules/map-three.md"缓存"
const MEGABYTE = 1024 * 1024;
const CACHE_BYTES = 1024 * MEGABYTE;
const CACHE_OVERFLOW_BYTES = 1024 * MEGABYTE;
// 每帧上传的字节（ADR 0147 第 5 节）：GPU 耗时每 MB 约 0.5 毫秒，这么多放得进 60 帧的一帧。实测见 docs/modules/map-three.md"上传"
const UPLOAD_BYTES_PER_FRAME = 16 * MEGABYTE;
// 相机在一块瓦片加载完之前走的路达到瓦片直径就不请求，加载时间按实测（request-cull.ts）。实测见 docs/modules/map-three.md"动着的时候不请求"
const REQUEST_CULL_WINDOW: CullWindow = 'auto';
const FRAME_MS = 1000 / 60;
// 高斯泼溅的总预算（高斯个数，ADR 0149 第 5 节）：加了几份就平分，隐藏的、还在读索引的也算（隐藏的调度器仍占着数据）；
// 不是内存上限，默认值等显卡机器实测后再定（L.3）
const SPLAT_BUDGET = 3_000_000;

/** 构造参数都有默认值，性能测量时换着比较 */
export interface ThreeSceneRendererOptions {
  /** 缓存淘汰到的大小（字节） */
  readonly cacheBytes?: number;
  /** 到它不再加载（字节） */
  readonly cacheLimitBytes?: number;
  /** 每帧提前上传的字节；null 时不提前上传，第一次绘制时才上传 */
  readonly uploadBytesPerFrame?: number | null;
  /** 相机在这个窗口里走的路达到瓦片直径就不请求：秒数，'auto' 按实测的加载时间；null 时动着也请求 */
  readonly requestCullWindow?: CullWindow | null;
  /** 高斯泼溅的总预算（高斯个数），加了几份就平分 */
  readonly splatBudget?: number;
  /**
   * 瓦片记完字节以后释放内存里的贴图（ADR 0155 第 5 节，默认释放）：渲染进程省下约一个缓存大小；
   * 代价是上下文丢了以后瓦片要重新下载。测量工具用 false 作对照
   */
  readonly releaseImages?: boolean;
  /**
   * app 给的预算来源（ADR 0155 第 6 节）：第一次挂上时按显卡定预算，之后降档、恢复时改；
   * 不给时一直用上面这几项（不写的用标准档）
   */
  readonly budgetSource?: SceneBudgetSource;
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
  /** 瓦片库的 LRU 现在淘汰到的大小：读库本身的设置，不是渲染器记的预算 */
  readonly cacheBytes: number;
  /** 瓦片库的 LRU 现在到多少不再加载 */
  readonly cacheLimitBytes: number;
  /** 每帧提前上传的字节；null 不提前上传 */
  readonly uploadBytesPerFrame: number | null;
  /** 屏幕误差放宽的倍数 */
  readonly errorScale: number;
  /** 锁在这个姿态上：相机不离开就不再收紧 */
  readonly locked: boolean;
  /** 最粗一层也放不下，再放宽也没有用 */
  readonly saturated: boolean;
  /** 最近一帧因为缓存满没能排队的瓦片数 */
  readonly refused: number;
  /** 最近一帧的需求（在用的加上还要加载的估计），其中还要加载的，再其中没请求的（字节） */
  readonly demandBytes: number;
  readonly pendingBytes: number;
  readonly culledBytes: number;
  /** 累计：因为缓存满、因为停着估计放不下而放宽的帧数 */
  readonly raisedFull: number;
  readonly raisedPredicted: number;
  /** 下载、解析、等待上传的瓦片数 */
  readonly loading: number;
  /** 等待上传的瓦片数 */
  readonly uploadPending: number;
  /** 累计提前上传的字节 */
  readonly uploadedBytes: number;
  /** 累计释放了内存里那一份的贴图字节 */
  readonly releasedBytes: number;
  /** 瓦片都到了，放宽的倍数也不再变 */
  readonly settled: boolean;
  readonly tilesets: Readonly<Record<string, TilesetEntryInspection>>;
  /** 高斯泼溅的总预算和各份的读数（ADR 0149 第 5 节：和瓦片集分开管，一起报） */
  readonly splatBudget: number;
  readonly splats: Readonly<Record<string, SplatEntryInspection>>;
}

// WebGL 报的显卡名字（ANGLE 的写法）：读不到真实名字时用 RENDERER
function rendererName(gl: WebGL2RenderingContext): string {
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  return String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
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
 * （瓦片的贴图上传后释放了内存里的那份，要重新下载）
 */
export class ThreeSceneRenderer implements SceneRenderer {
  readonly #emitter = createNanoEvents<SceneRendererEvents>();
  readonly #tilesets = new Map<string, TilesetEntry>();
  readonly #splats = new Map<string, SplatEntry>();
  // 还在读索引的泼溅和这次加载的信号：同一个 ID 先中止、紧接着重新加时（同步换摆放、重试），上一份还没走到 catch 里移除
  readonly #loadingSplats = new WeakMap<SplatEntry, AbortSignal>();
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
  #cacheBytes: number;
  #cacheLimitBytes: number;
  readonly #requestCullWindow: CullWindow | null;
  #splatBudget: number;
  #uploadBytesPerFrame: number | null;
  readonly #releaseImages: boolean;
  readonly #budgetSource: SceneBudgetSource | null;
  readonly #unsubscribeBudget: Unsubscribe | null;
  // 预算来源已经按显卡定过预算：只在第一次挂上时问
  #budgetResolved = false;
  // gaussian-splat-lite 单独分块，第一次加泼溅时才下载；失败后下次重新下载
  #splatLibrary: Promise<SplatLibrary> | null = null;
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
  #pendingBytes = 0;
  #culledBytes = 0;
  #refused = 0;
  #steady = true;
  // 新瓦片到了、还没有画过的一帧：这时读数还是旧的
  #framePending = false;

  constructor({
    cacheBytes = CACHE_BYTES,
    cacheLimitBytes = CACHE_BYTES + CACHE_OVERFLOW_BYTES,
    uploadBytesPerFrame = UPLOAD_BYTES_PER_FRAME,
    requestCullWindow = REQUEST_CULL_WINDOW,
    splatBudget = SPLAT_BUDGET,
    releaseImages = true,
    budgetSource
  }: ThreeSceneRendererOptions = {}) {
    this.#splatBudget = splatBudget;
    this.#uploadBytesPerFrame = uploadBytesPerFrame;
    this.#releaseImages = releaseImages;
    this.#budgetSource = budgetSource ?? null;
    this.#unsubscribeBudget = budgetSource?.subscribe(budget => this.setBudget(budget)) ?? null;
    this.#cacheBytes = cacheBytes;
    this.#cacheLimitBytes = cacheLimitBytes;
    this.#requestCullWindow = requestCullWindow;
    this.#cache.unloadPriorityCallback = DEFAULT_LRU_CACHE.unloadPriorityCallback;
    this.#cache.minBytesSize = cacheBytes;
    this.#cache.maxBytesSize = cacheLimitBytes;
    this.#scale = new ErrorScale({ hardBytes: cacheLimitBytes });
    this.#uploader = new TileUploader(uploadBytesPerFrame, () => this.#requestFrame());
  }

  attach(surface: SceneSurface): void {
    this.#assertAlive();
    // 换了上下文（不同的地图）时旧的渲染器不能再用，释放过贴图的瓦片也要重新下载
    if (this.#webgl && this.#surface?.gl !== surface.gl) {
      this.#dropRenderer();
      this.#discardReleasedTiles();
    }
    this.#surface = surface;
    if (!this.#webgl) {
      const webgl = new WebGLRenderer({ canvas: surface.canvas, context: surface.gl });
      webgl.autoClear = false;
      // 一帧有多次 render：读数要整帧的
      webgl.info.autoReset = false;
      // 视口每帧按画布的实际像素设，不跟着设备像素比再放大
      webgl.setPixelRatio(1);
      // 倾斜模型在泼溅的范围里裁掉（ADR 0149）：材质上的平面要它打开；在着色器里 discard，不改 MapLibre 的 GL 状态
      webgl.localClippingEnabled = true;
      this.#webgl = webgl;
      for (const entry of this.#splats.values()) {
        entry.setRenderer(webgl);
      }
    }
    // 显卡的名字只有拿到 MapLibre 的上下文才知道：第一次挂上时按它定预算，瓦片这时还没开始加载
    if (this.#budgetSource && !this.#budgetResolved) {
      this.#budgetResolved = true;
      this.setBudget(this.#budgetSource.resolve(rendererName(surface.gl)));
    }
    this.#attached = true;
    this.#uploader.setActive(true);
    this.#budgetSource?.shown(true);
    surface.requestRepaint();
  }

  detach(): void {
    this.#attached = false;
    this.#uploader.setActive(false);
    this.#budgetSource?.shown(false);
  }

  /**
   * 改预算（ADR 0155 第 4 节：丢上下文降档、用户恢复画质）：缓存的上限调小以后，库在下一次更新时淘汰到新的大小，
   * 淘汰不掉的按放宽的规则放宽；放宽的判断重新来
   */
  setBudget({ cacheBytes, cacheLimitBytes, uploadBytesPerFrame, splatBudget }: SceneBudget): void {
    if (
      cacheBytes === this.#cacheBytes &&
      cacheLimitBytes === this.#cacheLimitBytes &&
      uploadBytesPerFrame === this.#uploadBytesPerFrame &&
      splatBudget === this.#splatBudget
    ) {
      return;
    }
    this.#cacheBytes = cacheBytes;
    this.#cacheLimitBytes = cacheLimitBytes;
    this.#uploadBytesPerFrame = uploadBytesPerFrame;
    this.#splatBudget = splatBudget;
    this.#cache.minBytesSize = cacheBytes;
    this.#cache.maxBytesSize = cacheLimitBytes;
    this.#scale.setBudget({ hardBytes: cacheLimitBytes });
    this.#uploader.setBytesPerFrame(uploadBytesPerFrame);
    this.#shareSplatBudget();
    this.#requestFrame();
  }

  loseContext(): void {
    this.#uploader.setActive(false);
    this.#dropRenderer();
    this.#frame = null;
    this.#discardReleasedTiles();
    // 降一档（ADR 0155 第 4 节）：预算来源经 subscribe 改预算，恢复后按新的预算加载
    this.#budgetSource?.contextLost();
  }

  // 释放过内存里贴图的瓦片不能再上传：卸载，恢复后重新下载。内容变了，放宽的判断重新来
  #discardReleasedTiles(): void {
    if (this.#releaseImages) {
      for (const entry of this.#tilesets.values()) {
        entry.discardContent();
      }
      this.#scale.release();
    }
  }

  // 什么也不画：有它时 MapLibre 在画图层之前作废自己的 GL 状态缓存
  prerender(): void {}

  render(mapFrame: SceneFrame): void {
    const webgl = this.#webgl;
    const surface = this.#surface;
    if (!this.#attached || !webgl || !surface) {
      return;
    }
    const frame = withDeeperFar(mapFrame);
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
      if (lifted && id !== lifted.modelId) {
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
    // 泼溅是半透明的、不写深度：在不透明的瓦片、模型之后画，用它们的深度做遮挡
    // 隔离一份泼溅时，别的每帧按看不见更新、放掉数据；还占着的时候接着画帧，放完以后漫游的那份才拿全部预算
    const isolating = lifted !== null && this.#splats.has(lifted.modelId);
    for (const [id, entry] of this.#splats) {
      if (lifted && id !== lifted.modelId) {
        entry.skipFrame(isolating);
      } else if (entry.prepare(frame, surface)) {
        webgl.render(entry.scene, entry.camera);
      }
    }
    if (isolating) {
      this.#shareSplatBudget();
      if ([...this.#splats].some(([id, entry]) => id !== lifted.modelId && entry.holding)) {
        surface.requestRepaint();
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
      requestCullWindow: this.#requestCullWindow,
      releaseImages: this.#releaseImages,
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
      if (this.#lift?.modelId === id) {
        entry.setLift(this.#lift.meters);
      }
      entry.setClipBoxes(this.#splatClipBoxes());
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

  async addSplat(id: string, source: SplatSource, options: SplatOptions, signal: AbortSignal): Promise<TilesetSphere> {
    this.#assertAlive();
    this.#releaseAbortedSplat(id);
    const library = await this.#loadSplatLibrary();
    signal.throwIfAborted();
    this.#assertAlive();
    this.#releaseAbortedSplat(id);
    const entry = new SplatEntry({
      library,
      source,
      options,
      math: this.#math,
      budget: this.#splatBudget,
      events: {
        failed: error => this.#emitter.emit('splatfailed', id, new Error(`高斯泼溅 ${id} 的数据加载失败`, { cause: error })),
        repaint: () => this.#surface?.requestRepaint()
      }
    });
    this.#splats.set(id, entry);
    this.#loadingSplats.set(entry, signal);
    this.#shareSplatBudget();
    entry.setRenderer(this.#webgl);
    try {
      const sphere = await entry.load(signal);
      signal.throwIfAborted();
      this.#assertAlive();
      this.#loadingSplats.delete(entry);
      this.#clipTilesets();
      return sphere;
    } catch (error) {
      if (this.#splats.get(id) === entry) {
        this.#splats.delete(id);
        this.#shareSplatBudget();
      }
      entry[Symbol.dispose]();
      throw error;
    }
  }

  updateSplat(id: string, options: SplatOptions): void {
    this.#splats.get(id)?.setOptions(options);
    this.#clipTilesets();
  }

  removeSplat(id: string): void {
    const entry = this.#splats.get(id);
    if (!entry) {
      return;
    }
    this.#splats.delete(id);
    entry[Symbol.dispose]();
    this.#shareSplatBudget();
    this.#clipTilesets();
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

  pick(point: ScreenPoint, { hover = false }: PickOptions = {}): ScenePick | null {
    const canvas = this.#surface?.canvas;
    if (!this.#frame || !canvas) {
      return null;
    }
    const ndc = toNdc(point, { width: canvas.clientWidth, height: canvas.clientHeight });
    let nearest: { distance: number; lngLatHeight: [number, number, number] } | null = null;
    // 每个瓦片集、泼溅有自己的局部系，同一条视线上的距离都是米、起点相同，可以直接比较。
    // 悬停时不打泼溅：每帧都会调用，泼溅的射线拾取每次可能几十毫秒（ADR 0149），打到泼溅的地方按后面的算
    const entries = hover ? [...this.#tilesets.values()] : [...this.#tilesets.values(), ...this.#splats.values()];
    for (const entry of entries) {
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
      entry.setLift(lift?.modelId === id ? lift.meters : 0);
    }
    this.#shareSplatBudget();
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
      cacheBytes: this.#cache.minBytesSize,
      cacheLimitBytes: this.#cache.maxBytesSize,
      uploadBytesPerFrame: this.#uploadBytesPerFrame,
      errorScale: this.#scale.value,
      locked: this.#scale.locked,
      saturated: this.#scale.saturated,
      refused: this.#refused,
      demandBytes: this.#pinnedBytes + this.#pendingBytes,
      pendingBytes: this.#pendingBytes,
      culledBytes: this.#culledBytes,
      raisedFull: this.#scale.raisedFull,
      raisedPredicted: this.#scale.raisedPredicted,
      loading,
      uploadPending,
      uploadedBytes: this.#uploader.uploadedBytes,
      releasedBytes: this.#uploader.releasedBytes,
      settled: this.#steady && !this.#framePending && loading === 0 && uploadPending === 0,
      tilesets: Object.fromEntries([...this.#tilesets].map(([id, entry]) => [id, entry.inspect()])),
      splatBudget: this.#splatBudget,
      splats: Object.fromEntries([...this.#splats].map(([id, entry]) => [id, entry.inspect()]))
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
    this.#unsubscribeBudget?.();
    if (this.#attached) {
      this.#attached = false;
      this.#budgetSource?.shown(false);
    }
    for (const entry of this.#tilesets.values()) {
      entry[Symbol.dispose]();
    }
    this.#tilesets.clear();
    for (const entry of this.#splats.values()) {
      entry[Symbol.dispose]();
    }
    this.#splats.clear();
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
    let culledBytes = 0;
    let usedTiles = 0;
    let culled = false;
    for (const entry of drawn) {
      culled ||= entry.culled > 0;
      const demand = entry.demand();
      refused += demand.refused;
      pinnedBytes += demand.pinnedBytes;
      pendingBytes += demand.pendingBytes;
      culledBytes += demand.culledBytes;
      usedTiles += demand.usedTiles;
      pose ??= entry.pose();
    }
    this.#refused = refused;
    this.#pinnedBytes = pinnedBytes;
    this.#pendingBytes = pendingBytes;
    this.#culledBytes = culledBytes;
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

  // 抬高的瓦片集、隔离的泼溅还在时才算：被移除以后照常画其他内容
  #activeLift(): SceneLift | null {
    const lift = this.#lift;
    return lift && (this.#tilesets.has(lift.modelId) || this.#splats.has(lift.modelId)) ? lift : null;
  }

  // 丢掉 WebGLRenderer：它跟踪的 GPU 资源随之作废，下次画时重新上传；内容（瓦片、泼溅、模型）保留。
  // 泼溅库的绘制对象绑定在渲染器上，一起丢掉
  #dropRenderer(): void {
    for (const entry of this.#splats.values()) {
      entry.setRenderer(null);
    }
    this.#webgl?.dispose();
    this.#webgl = null;
  }

  #loadSplatLibrary(): Promise<SplatLibrary> {
    this.#splatLibrary ??= import('gaussian-splat-lite').catch((error: unknown) => {
      this.#splatLibrary = null;
      throw error;
    });
    return this.#splatLibrary;
  }

  // 同一个 ID 已经有一份：加载已中止、只是还没清理的直接释放，否则是重复加
  #releaseAbortedSplat(id: string): void {
    const previous = this.#splats.get(id);
    if (!previous) {
      return;
    }
    if (!this.#loadingSplats.get(previous)?.aborted) {
      throw new Error(`高斯泼溅 ${id} 已经加过`);
    }
    this.#splats.delete(id);
    previous[Symbol.dispose]();
    this.#shareSplatBudget();
  }

  // 显示着、读到索引的泼溅的范围（ADR 0149）
  #splatClipBoxes(): ClipBox[] {
    return [...this.#splats.values()].flatMap(entry => entry.clipBox() ?? []);
  }

  // 泼溅加上、移除、显示变了：交给每个瓦片集，要求裁剪、范围重叠的在盒子里不画
  #clipTilesets(): void {
    const boxes = this.#splatClipBoxes();
    for (const entry of this.#tilesets.values()) {
      entry.setClipBoxes(boxes);
    }
    this.#surface?.requestRepaint();
  }

  // 总预算按份平分：多加一份不会让总的高斯个数翻倍。隔离一份泼溅时别的不画、预算设成 1、放掉数据（render 里），
  // 都放掉以后隔离的那份拿全部预算，之前仍按平分：任何时候总数不超过预算（ADR 0156 R.5）
  #shareSplatBudget(): void {
    const isolated = this.#activeLift()?.modelId;
    const alone = isolated !== undefined && this.#splats.has(isolated);
    const share = Math.max(1, Math.floor(this.#splatBudget / Math.max(1, this.#splats.size)));
    const released = alone && [...this.#splats].every(([id, entry]) => id === isolated || !entry.holding);
    for (const [id, entry] of this.#splats) {
      if (!alone) {
        entry.setBudget(share);
      } else if (id === isolated) {
        entry.setBudget(released ? this.#splatBudget : share);
      } else {
        entry.setBudget(1);
      }
    }
  }

  #assertAlive(): void {
    if (this.#disposed) {
      throw new Error('三维渲染器已释放');
    }
  }
}
