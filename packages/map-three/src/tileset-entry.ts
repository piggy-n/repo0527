import {
  type AnchorMatrices,
  fromEcef,
  type PreparedTileset,
  type SceneFrame,
  type SceneSurface,
  type TilesetOptions,
  type TilesetSphere
} from '@mx/map-core';
import { abortReason } from '@mx/utils';
import type { LRUCache } from '3d-tiles-renderer';
import { TilesRenderer } from '3d-tiles-renderer';
import {
  Box3,
  Group,
  type Intersection,
  type Material,
  Matrix4,
  type Mesh,
  PerspectiveCamera,
  Plane,
  type Raycaster,
  Scene,
  Sphere,
  Vector3
} from 'three';
import type { BudgetPose } from './error-scale';
import type { FrameMath } from './frame';
import { createSunLights, type FogUniform, TilesetMaterials } from './lighting';
import { LocalFrame } from './local-frame';
import { type CullWindow, RequestCull } from './request-cull';
import { type TileInternals, TileLoadPlugin } from './tile-load-plugin';
import type { TileUploader } from './tile-uploader';

export interface TilesetEntryEvents {
  /** 瓦片的内容加载失败 */
  readonly failed: (error: unknown) => void;
  /** 显示后视野里的首批瓦片都到了（不在视野里时第一帧就到） */
  readonly initial: () => void;
  /** 有新内容要画 */
  readonly repaint: () => void;
}

export interface TilesetEntryOptions {
  readonly prepared: PreparedTileset;
  readonly options: TilesetOptions;
  /** 所有瓦片集共用的缓存（预算同 Cesium） */
  readonly cache: LRUCache;
  readonly math: FrameMath;
  /** 渲染器共用的头灯远处压暗开关 */
  readonly fog: FogUniform;
  /** 所有瓦片集共用的上传队列 */
  readonly uploader: TileUploader;
  /** 相机在这个窗口里走的路达到瓦片直径就不请求（'auto' 按实测的加载时间）；null 时动着也请求 */
  readonly requestCullWindow: CullWindow | null;
  readonly events: TilesetEntryEvents;
}

/** 裁剪盒（ADR 0149）：盒子的局部系（原点在盒子中心，轴和盒子的边平行）到地心坐标，和三个方向的半边长（米） */
export interface ClipBox {
  readonly toEcef: Matrix4;
  readonly half: Vector3;
}

// 盒子六个面的平面（盒子的局部系）：法线朝外，盒子里面在每个平面的负侧
const BOX_FACES = [
  [1, 0, 0, 'x'],
  [-1, 0, 0, 'x'],
  [0, 1, 0, 'y'],
  [0, -1, 0, 'y'],
  [0, 0, 1, 'z'],
  [0, 0, -1, 'z']
] as const;

/** 一个瓦片集这一帧对缓存的需求 */
export interface TilesetDemand {
  readonly refused: number;
  /** 在用的瓦片的字节 */
  readonly pinnedBytes: number;
  /** 还要加载的瓦片的估计字节 */
  readonly pendingBytes: number;
  /** 其中因为相机走得快没有请求的 */
  readonly culledBytes: number;
  readonly usedTiles: number;
}

/** 一个瓦片集的读数 */
export interface TilesetEntryInspection {
  readonly show: boolean;
  readonly errorTarget: number;
  /** 这一帧显示的瓦片数 */
  readonly visible: number;
  /** 累计：瓦片加载完成、被卸载、加载失败的次数 */
  readonly loaded: number;
  readonly unloaded: number;
  readonly failed: number;
  /** 这一帧因为相机走得快没有请求的瓦片数 */
  readonly culled: number;
  /** 动着不请求的窗口（秒）；动着也请求时为 null */
  readonly cullWindow: number | null;
  /** 现在：等下载和下载中的、解析中的瓦片数 */
  readonly downloading: number;
  readonly parsing: number;
  /** 这一帧在用的瓦片数，和其中视野外的：REPLACE 的节点要等全部子节点，视野外的也算 */
  readonly used: number;
  readonly usedOutOfView: number;
  /** 正在被高斯泼溅的范围裁剪（ADR 0149） */
  readonly clipped: boolean;
}

// 库的这些字段运行时有、类型声明里没有
interface TilesInternals {
  readonly usedSet: Set<TileInternals>;
  readonly loadingTiles: Set<TileInternals>;
  queueTileForDownload(tile: TileInternals): void;
  readonly stats: {
    readonly refused: number;
    readonly queued: number;
    readonly downloading: number;
    readonly parsing: number;
    readonly visible: number;
  };
}

/** 拾取到的点：经纬度、真实的椭球高（抬高时已减回去）和到相机的距离（米） */
export interface TilesetHit {
  readonly distance: number;
  readonly lngLatHeight: [number, number, number];
}

// 屏幕误差上限的默认值，和 Cesium 相同（map-cesium 的 DEFAULT_SCREEN_SPACE_ERROR）；清单可以按模型改
const ERROR_TARGET = 8;
// 一层完成这么多块瓦片才估计这一层的大小：一块特别大的瓦片不能让需求一下子超过上限，放宽了就收不回来
const MIN_SIZE_SAMPLES = 3;
// 瓦片还没有请求过：库的常量 UNLOADED，类型声明里没有导出
const UNLOADED = 0;

// 命中的面用的材质；多材质的网格按面的材质序号取
function hitMaterial({ object, face }: Intersection): Material | undefined {
  const { material } = object as Mesh;
  return Array.isArray(material) ? material[face?.materialIndex ?? 0] : material;
}

// 半透明的表面不算：同 Cesium 的深度拾取（深度只记录不透明物体），隔着玻璃点到的是后面
const opaque = (hit: Intersection) => hitMaterial(hit)?.transparent !== true;

/**
 * 一个 3D Tiles 瓦片集（ADR 0147 第 5 节）：一个 TilesRenderer，局部系锚在包围球的球心；
 * 每帧按这一帧的投影换算自己的相机，再由渲染器画到共用的 GL 上下文里
 */
export class TilesetEntry implements Disposable {
  readonly tiles: TilesRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera();
  readonly #math: FrameMath;
  readonly #events: TilesetEntryEvents;
  readonly #root = new Group();
  readonly #materials: TilesetMaterials;
  readonly #clip = new Matrix4();
  readonly #url: string;
  #options: TilesetOptions;
  // 所有瓦片集共用的放宽倍数，乘在各自的屏幕误差上限上
  #errorScale = 1;
  #frame: LocalFrame | null = null;
  #anchor: AnchorMatrices | null = null;
  #initial = false;
  // 最近一帧画了：拾取只看画出来的
  #drawn = false;
  // 抬高量（米，ADR 0147 第 4 节）：局部系里沿 y 上移，拾取的命中点减回去
  #lift = 0;
  readonly #cache: LRUCache;
  // 最近一次更新以来还算着"在用"：共用的缓存淘汰不掉，不画的瓦片集要解除
  #pinned = false;
  // 每一层完成的瓦片的总字节和块数，估计还要加载的字节用
  readonly #sizeByDepth = new Map<number, { bytes: number; count: number }>();
  // 样本够了的最深一层：没到过的层按它估计
  #deepestSized = -1;
  #loaded = 0;
  #unloaded = 0;
  #failed = 0;
  readonly #requestCull: RequestCull | null;
  // 这一帧因为相机走得快没有请求的瓦片
  readonly #culled = new Set<TileInternals>();
  // 相机动着时请求的瓦片和请求的时刻：能画了以后算加载要多久
  readonly #requestedAt = new WeakMap<TileInternals, number>();
  readonly #sphere = new Sphere();
  // 裁剪平面（这个瓦片集的场景坐标，抬高时跟着上移）：所有材质共用这个数组，原地改；空的时候不裁
  readonly #clipPlanes: Plane[] = [];
  // 渲染器给的显示着的泼溅的范围：只用第一个和这个瓦片集重叠的
  #clipBoxes: readonly ClipBox[] = [];
  // 根索引的包围球（地心坐标）：判断和裁剪盒是否重叠
  #ecefSphere: Sphere | null = null;

  constructor({ prepared, options, cache, math, fog, uploader, requestCullWindow, events }: TilesetEntryOptions) {
    this.#requestCull = requestCullWindow === null ? null : new RequestCull(requestCullWindow);
    this.#cache = cache;
    this.#math = math;
    this.#events = events;
    this.#options = options;
    this.#materials = new TilesetMaterials(fog, this.#clipPlanes);
    // 整理后的索引里内容都是绝对地址，用 Blob 地址交给瓦片库，读到根索引后释放
    this.#url = URL.createObjectURL(new Blob([JSON.stringify(prepared)], { type: 'application/json' }));
    const tiles = new TilesRenderer(this.#url);
    tiles.lruCache = cache;
    tiles.errorTarget = this.#errorTarget();
    tiles.registerPlugin(new TileLoadPlugin(uploader, cache, tile => this.#onTileReady(tile)));
    // 库没有按瓦片决定要不要请求的接口：选瓦片时调用的这个方法是唯一的入口。版本锁定，浏览器测试用真实的库验证
    const internals = tiles as unknown as TilesInternals;
    const queue = internals.queueTileForDownload.bind(tiles);
    internals.queueTileForDownload = tile => {
      if (this.#cullsRequest(tile)) {
        this.#culled.add(tile);
      } else {
        this.#noteRequest(tile);
        queue(tile);
      }
    };
    tiles.setCamera(this.camera);
    tiles.setResolution(this.camera, 1, 1);
    tiles.addEventListener('load-model', ({ scene, tile }) => {
      this.#materials.adopt(scene, this.#options.lighting);
      this.#loaded++;
      this.#rememberSize(tile as unknown as TileInternals);
    });
    tiles.addEventListener('dispose-model', ({ scene }) => {
      this.#materials.release(scene);
      this.#unloaded++;
    });
    tiles.addEventListener('load-error', ({ tile, error }) => {
      if (tile) {
        this.#failed++;
        events.failed(error);
      }
    });
    tiles.addEventListener('needs-update', () => events.repaint());
    this.tiles = tiles;
    this.#root.matrixAutoUpdate = false;
    this.#root.add(tiles.group);
    this.scene.add(this.#root, ...createSunLights());
  }

  /** 读入根索引：锚点放在包围球的球心，给出包围球；signal 中止时以它的原因结束 */
  load(signal: AbortSignal): Promise<TilesetSphere> {
    const { tiles } = this;
    return new Promise<TilesetSphere>((resolve, reject) => {
      const cleanup = () => {
        tiles.removeEventListener('load-root-tileset', onRoot);
        tiles.removeEventListener('load-error', onError);
        signal.removeEventListener('abort', onAbort);
        URL.revokeObjectURL(this.#url);
      };
      const onRoot = () => {
        cleanup();
        const sphere = new Sphere();
        if (!tiles.getBoundingSphere(sphere)) {
          reject(new Error('瓦片集的根节点没有包围体'));
          return;
        }
        this.#frame = LocalFrame.fromEcefCenter(sphere.center);
        this.#ecefSphere = sphere;
        this.#placeRoot();
        this.#placeClip();
        resolve({ center: this.#frame.anchor, radius: sphere.radius });
      };
      const onError = ({ tile, error }: { tile: unknown; error: Error }) => {
        if (tile === null) {
          cleanup();
          reject(error);
        }
      };
      const onAbort = () => {
        cleanup();
        reject(abortReason(signal));
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      tiles.addEventListener('load-root-tileset', onRoot);
      tiles.addEventListener('load-error', onError);
      signal.addEventListener('abort', onAbort);
      // 第一次更新时开始读根索引，此时还没有相机，不选瓦片
      tiles.update();
    });
  }

  setOptions(options: TilesetOptions): void {
    if (options.lighting !== this.#options.lighting) {
      this.#materials.apply(this.tiles.group, options.lighting);
    }
    this.#options = options;
    this.tiles.errorTarget = this.#errorTarget();
    this.#placeClip();
  }

  /** 显示着的高斯泼溅的范围（ADR 0149）：选项要求裁剪、和这个瓦片集重叠时裁掉第一个重叠的盒子里面的部分 */
  setClipBoxes(boxes: readonly ClipBox[]): void {
    this.#clipBoxes = boxes;
    this.#placeClip();
  }


  /** 抬高 meters 米（ADR 0147 第 4 节）：0 时恢复 */
  setLift(meters: number): void {
    if (meters !== this.#lift) {
      this.#lift = meters;
      this.#placeRoot();
      this.#placeClip();
    }
  }

  /**
   * 根节点包围体最低处的真实椭球高（米）；根索引还没读到时为 null。包围盒（球时是按地心坐标轴的外接盒）的角点
   * 和包围球的最低点都不会高于模型，取两者里高的那个：苏州站的根节点是半径 335 米的球，外接盒的角点要低两百多米
   */
  lowestHeight(): number | null {
    const box = new Box3();
    const matrix = new Matrix4();
    const sphere = new Sphere();
    // 包围盒、包围球和变换都在瓦片库的坐标系里，也就是地心坐标
    if (!this.#frame || !this.tiles.getOrientedBoundingBox(box, matrix) || !this.tiles.getBoundingSphere(sphere)) {
      return null;
    }
    const { center } = sphere;
    const sphereLowest = fromEcef([center.x, center.y, center.z])[2] - sphere.radius;
    let boxLowest = Infinity;
    const corner = new Vector3();
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) {
          corner.set(x, y, z).applyMatrix4(matrix);
          boxLowest = Math.min(boxLowest, fromEcef([corner.x, corner.y, corner.z])[2]);
        }
      }
    }
    return Math.max(sphereLowest, boxLowest);
  }

  /** 这一帧不画（抬高别的瓦片集期间）：也拾取不到 */
  skipFrame(): void {
    this.#drawn = false;
    this.#releaseUsed();
  }

  /** 屏幕误差放宽 scale 倍 */
  setErrorScale(scale: number): void {
    this.#errorScale = scale;
    this.tiles.errorTarget = this.#errorTarget();
  }

  /** 这一帧对缓存的需求：最近一次 prepare 之后读 */
  demand(): TilesetDemand {
    const { usedSet, loadingTiles, stats } = this.tiles as unknown as TilesInternals;
    let pinnedBytes = 0;
    for (const tile of usedSet) {
      pinnedBytes += this.#cache.getMemoryUsage(tile);
    }
    // 缓存满的时候排不进队的瓦片不知道是哪些，按最深一层算
    let pendingBytes = stats.refused * this.#sizeAt(this.#deepestSized);
    for (const tile of loadingTiles) {
      // 已经不要了、但还在下载的不算：它们不占需求，算上的话放宽以后需求也不降，会一直放宽到它们下载完
      if (tile.internal.hasRenderableContent && usedSet.has(tile)) {
        pendingBytes += this.#sizeAt(tile.internal.depth);
      }
    }
    // 没有请求的也算：这一路还是要它们。不算的话动着的时候需求总是很低，一路收紧，停下时要从最细的一层开始放宽
    let culledBytes = 0;
    for (const tile of this.#culled) {
      culledBytes += this.#sizeAt(tile.internal.depth);
    }
    return {
      refused: stats.refused,
      pinnedBytes,
      pendingBytes: pendingBytes + culledBytes,
      culledBytes,
      usedTiles: usedSet.size
    };
  }

  /** 这一帧因为相机走得快没有请求的瓦片数：不是 0 时要再画一帧，相机停下才请求得到 */
  get culled(): number {
    return this.#culled.size;
  }

  /** 现在正在下载、解析、等待上传的瓦片数：请求被取消时不一定还有下一帧，要现读 */
  get loading(): number {
    const { queued, downloading, parsing } = (this.tiles as unknown as TilesInternals).stats;
    return queued + downloading + parsing;
  }

  /** 最近一帧的相机：地心坐标，离地高度取局部系的 y */
  pose(): BudgetPose | null {
    const frame = this.#frame;
    if (!frame) {
      return null;
    }
    const position = new Vector3().copy(this.camera.position).applyMatrix4(frame.toEcef);
    const direction = this.camera.getWorldDirection(new Vector3()).transformDirection(frame.toEcef);
    return { position: [position.x, position.y, position.z], direction: [direction.x, direction.y, direction.z], height: this.camera.position.y };
  }

  inspect(): TilesetEntryInspection {
    const { stats, usedSet } = this.tiles as unknown as TilesInternals;
    let usedOutOfView = 0;
    for (const tile of usedSet) {
      if (!tile.traversal.inFrustum) {
        usedOutOfView++;
      }
    }
    return {
      show: this.#options.show,
      errorTarget: this.tiles.errorTarget,
      // 不画的瓦片集不再更新：库的统计停在之前
      visible: this.#drawn ? stats.visible : 0,
      loaded: this.#loaded,
      unloaded: this.#unloaded,
      failed: this.#failed,
      culled: this.#culled.size,
      cullWindow: this.#requestCull?.windowSeconds ?? null,
      downloading: stats.queued + stats.downloading,
      parsing: stats.parsing,
      used: usedSet.size,
      usedOutOfView,
      clipped: this.#clipPlanes.length > 0
    };
  }

  /** 画一帧之前：按这一帧的投影换算相机、选瓦片；不显示、根索引没到、在地球背面时不画 */
  prepare(frame: SceneFrame, surface: SceneSurface, width: number, height: number): boolean {
    this.#drawn = false;
    const localFrame = this.#frame;
    if (!this.#options.show || !localFrame) {
      this.#releaseUsed();
      return false;
    }
    this.#anchor ??= surface.anchor(...localFrame.anchor);
    if (this.#math.behindGlobe(frame, this.#anchor)) {
      this.#releaseUsed();
      return false;
    }
    this.#math.syncCamera(this.camera, this.#math.clipMatrix(frame, this.#anchor, this.#clip), frame);
    this.scene.updateMatrixWorld(true);
    this.tiles.setResolution(this.camera, width, height);
    this.#updateRequestCull();
    this.tiles.update();
    this.#pinned = true;
    // 还有没请求的瓦片时库的进度也是 1：要等它们都到了才算
    if (!this.#initial && this.tiles.root && this.tiles.loadProgress === 1 && this.#culled.size === 0) {
      this.#initial = true;
      this.#events.initial();
    }
    this.#drawn = true;
    return true;
  }

  /**
   * 按最近一帧的投影拾取：射线由裁剪矩阵的逆直接算出近处、远处两点（ndc 是画布上的点），不用拆出的相机位置。
   * 地球投影的过渡段是两个投影的插值，拆出的位置不是真正的投影中心，用它会偏一两个像素
   */
  pick(raycaster: Raycaster, ndc: readonly [number, number]): TilesetHit | null {
    const localFrame = this.#frame;
    if (!this.#drawn || !localFrame) {
      return null;
    }
    const { origin, direction } = raycaster.ray;
    origin.set(ndc[0], ndc[1], -1).unproject(this.camera);
    direction.set(ndc[0], ndc[1], 1).unproject(this.camera).sub(origin).normalize();
    // 裁掉的部分画不出来，也不该拾取到
    const hit = raycaster.intersectObject(this.tiles.group, true).find(item => opaque(item) && !this.#isClipped(item.point));
    if (!hit) {
      return null;
    }
    // 命中点在抬高后的局部系里：减回去才是真实的位置
    const real = hit.point.clone().setY(hit.point.y - this.#lift);
    return { distance: hit.distance, lngLatHeight: localFrame.toLngLatHeight(real) };
  }

  [Symbol.dispose](): void {
    URL.revokeObjectURL(this.#url);
    this.tiles.dispose();
    this.#materials.dispose();
  }

  // 按选项、重叠和抬高量重算裁剪平面：盒子的局部系 → 地心坐标 → 这个瓦片集的局部系，再整体上移抬高量
  #placeClip(): void {
    const planes = this.#clipPlanes;
    const frame = this.#frame;
    const box = this.#options.clippedBySplats ? this.#clipBoxes.find(item => this.#overlaps(item)) : undefined;
    planes.length = 0;
    if (!box || !frame) {
      return;
    }
    const matrix = new Matrix4().makeTranslation(0, this.#lift, 0).multiply(frame.fromEcef).multiply(box.toEcef);
    for (const [x, y, z, axis] of BOX_FACES) {
      planes.push(new Plane(new Vector3(x, y, z), -box.half[axis]).applyMatrix4(matrix));
    }
  }

  // 根索引的包围球和盒子相交：球心换到盒子的局部系，离盒子最近的点不超过半径
  #overlaps({ toEcef, half }: ClipBox): boolean {
    const sphere = this.#ecefSphere;
    if (!sphere) {
      return false;
    }
    const center = sphere.center.clone().applyMatrix4(toEcef.clone().invert());
    const nearest = center.clone().clamp(half.clone().negate(), half);
    return nearest.distanceTo(center) <= sphere.radius;
  }

  #isClipped(point: Vector3): boolean {
    const planes = this.#clipPlanes;
    return planes.length > 0 && planes.every(plane => plane.distanceToPoint(point) < 0);
  }

  #updateRequestCull(): void {
    this.#culled.clear();
    const pose = this.#requestCull ? this.pose() : null;
    if (pose) {
      this.#requestCull?.update(pose.position, performance.now());
    }
  }

  // 动着时请求的记下时刻。停着时请求的不算：停下时看到的一次全请求，排队很长，不代表动着的时候要等多久
  #noteRequest(tile: TileInternals): void {
    if (!this.#requestCull || tile.internal.loadingState !== UNLOADED) {
      return;
    }
    if (this.#requestCull.moving) {
      this.#requestedAt.set(tile, performance.now());
    } else {
      this.#requestedAt.delete(tile);
    }
  }

  #onTileReady(tile: TileInternals): void {
    const requestedAt = this.#requestedAt.get(tile);
    if (requestedAt !== undefined) {
      this.#requestedAt.delete(tile);
      this.#requestCull?.recordLoad(performance.now() - requestedAt);
    }
  }

  // 只拦还没开始的瓦片。外部索引在整理时都展开了，走到这里的都是有内容的瓦片
  #cullsRequest(tile: TileInternals): boolean {
    if (!this.#requestCull || tile.internal.loadingState !== UNLOADED) {
      return false;
    }
    tile.engineData.boundingVolume.getSphere(this.#sphere);
    return this.#requestCull.culls(this.#sphere.radius);
  }

  // 不再更新的瓦片集不会自己解除"在用"：所有瓦片集共用一个缓存，不解除的话它占的字节别的瓦片集永远用不上
  #releaseUsed(): void {
    if (!this.#pinned) {
      return;
    }
    this.#pinned = false;
    const { usedSet } = this.tiles as unknown as TilesInternals;
    for (const tile of usedSet) {
      this.#cache.markUnused(tile);
    }
    usedSet.clear();
  }

  #rememberSize(tile: TileInternals): void {
    const { depth } = tile.internal;
    const size = this.#sizeByDepth.get(depth) ?? { bytes: 0, count: 0 };
    size.bytes += this.#cache.getMemoryUsage(tile);
    size.count++;
    this.#sizeByDepth.set(depth, size);
    if (size.count >= MIN_SIZE_SAMPLES) {
      this.#deepestSized = Math.max(this.#deepestSized, depth);
    }
  }

  // 这一层一块瓦片的估计大小；样本不够时按样本够了的最深一层，都不够时不估计
  #sizeAt(depth: number): number {
    const size = this.#sizeByDepth.get(depth);
    if (size && size.count >= MIN_SIZE_SAMPLES) {
      return size.bytes / size.count;
    }
    const deepest = this.#sizeByDepth.get(this.#deepestSized);
    return deepest ? deepest.bytes / deepest.count : 0;
  }

  #errorTarget(): number {
    return (this.#options.maximumScreenSpaceError ?? ERROR_TARGET) * this.#errorScale;
  }

  // 地心坐标到局部系，抬高时再沿局部系的 y 上移
  #placeRoot(): void {
    const frame = this.#frame;
    if (!frame) {
      return;
    }
    this.#root.matrix.makeTranslation(0, this.#lift, 0).multiply(frame.fromEcef);
    this.#root.matrixWorldNeedsUpdate = true;
  }
}
