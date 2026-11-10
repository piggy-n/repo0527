import type {
  AnchorMatrices,
  SceneFrame,
  SceneSurface,
  SplatOptions,
  SplatPlacement,
  SplatSource,
  TilesetSphere
} from '@mx/map-core';
import { abortReason } from '@mx/utils';
import type { GaussianSplatRenderer, Lcc2StreamScheduler } from 'gaussian-splat-lite';
import {
  type Box3,
  Matrix4,
  PerspectiveCamera,
  type Raycaster,
  Scene,
  Sphere,
  Vector3,
  type WebGLRenderer
} from 'three';
import type { FrameMath } from './frame';
import { LocalFrame } from './local-frame';
import type { ClipBox, TilesetHit } from './tileset-entry';

/** gaussian-splat-lite 的模块：单独分块，第一次加载 LCC2 时才下载（ADR 0149 第 2 节） */
export type SplatLibrary = typeof import('gaussian-splat-lite');

export interface SplatEntryEvents {
  /** 数据（索引、数据块）加载失败，库不再重试的 */
  readonly failed: (error: unknown) => void;
  /** 有新内容要画：数据到了、排序完了 */
  readonly repaint: () => void;
}

export interface SplatEntryOptions {
  readonly library: SplatLibrary;
  readonly source: SplatSource;
  readonly options: SplatOptions;
  readonly math: FrameMath;
  /** 这份泼溅的高斯个数预算（库的 splatBudget） */
  readonly budget: number;
  readonly events: SplatEntryEvents;
}

/** 诊断读数：库自己估计的数，给性能测量和测试 */
export interface SplatEntryInspection {
  readonly budget: number;
  readonly visibleSplats: number;
  readonly residentChunks: number;
  readonly loadingChunks: number;
  /** 当前视角要的细节到了多少，0～1 */
  readonly loadProgress: number;
  readonly cpuBytes: number;
  readonly gpuBytes: number;
  readonly pendingBytes: number;
}

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

// 裁剪盒四周多留的米数（ADR 0149）：盖住泼溅软的边缘和配准的误差（L.2 的验收是 0.5 米），倾斜模型不在边上和泼溅交错
const CLIP_MARGIN = 1;

/**
 * LCC2 的局部系（网格东、北、上，Z 向上）到锚点的局部系（x 东、y 上、z 南）：
 * 先绕竖直轴转 heading（逆时针），再抬到原点的椭球高（ADR 0149 第 3 节）
 */
export function placementMatrix({ height, heading }: SplatPlacement): Matrix4 {
  const cos = Math.cos(toRadians(heading));
  const sin = Math.sin(toRadians(heading));
  // 东 = x cos − y sin，北 = x sin + y cos，上 = z + height；局部系的 z 是南（−北）
  return new Matrix4().set(cos, -sin, 0, 0, 0, 0, 1, height, -sin, -cos, 0, 0, 0, 0, 0, 1);
}

/**
 * 一份 LCC2 高斯泼溅（ADR 0149）：库的流式调度器放在自己的场景里，局部系锚在摆放的原点；
 * 每帧按这一帧的投影换算自己的相机，库按相机选细节、排序，再由渲染器画到共用的 GL 上下文里。
 * 库的绘制对象（GaussianSplatRenderer）跟着 WebGLRenderer 走：上下文丢失时丢掉，恢复后重建
 */
export class SplatEntry implements Disposable {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera();
  readonly #library: SplatLibrary;
  readonly #scheduler: Lcc2StreamScheduler;
  readonly #source: SplatSource;
  readonly #frame: LocalFrame;
  readonly #math: FrameMath;
  readonly #events: SplatEntryEvents;
  readonly #clip = new Matrix4();
  #anchor: AnchorMatrices | null = null;
  #options: SplatOptions;
  #webgl: WebGLRenderer | null = null;
  #splatRenderer: GaussianSplatRenderer | null = null;
  // 最近一帧画了：拾取只看画出来的
  #drawn = false;
  #disposed = false;
  // 索引根节点的包围盒（LCC2 的局部系）：读到索引以后才有
  #box: Box3 | null = null;

  constructor({ library, source, options, math, budget, events }: SplatEntryOptions) {
    this.#library = library;
    this.#source = source;
    this.#options = options;
    this.#math = math;
    this.#events = events;
    const { lng, lat } = source.placement;
    this.#frame = new LocalFrame([lng, lat]);
    // ADR 0149 第 5 节：按个数的预算、只要基础颜色、并发 2；淡入淡出要连续画帧，关掉
    const scheduler = new library.Lcc2StreamScheduler({
      splatBudget: budget,
      splatBudgetMode: 'limit',
      maxSh: 0,
      maxConcurrentLoads: 2,
      fadeDurationMs: 0,
      onChange: () => events.repaint(),
      onError: (error, url) => events.failed(new Error(`读取 ${url} 失败`, { cause: error }))
    });
    scheduler.group.matrixAutoUpdate = false;
    scheduler.group.matrix.copy(placementMatrix(source.placement));
    scheduler.setCamera(this.camera);
    this.#scheduler = scheduler;
    this.scene.matrixAutoUpdate = false;
    this.scene.add(scheduler.group);
  }

  /** 读索引（环境层不读）：给出包围球；signal 中止时以它的原因结束 */
  async load(signal: AbortSignal): Promise<TilesetSphere> {
    signal.throwIfAborted();
    const added = this.#scheduler.addSource({ url: this.#source.url, environment: false });
    // 中止时以中止的原因结束；之后释放调度器会让 addSource 以 AbortError 结束，那时已经没人等它
    const listening = new AbortController();
    try {
      await Promise.race([
        added,
        new Promise<never>((_, reject) => {
          signal.addEventListener('abort', () => reject(abortReason(signal)), { once: true, signal: listening.signal });
        })
      ]);
    } finally {
      listening.abort();
    }
    return this.#sphere();
  }

  setOptions(options: SplatOptions): void {
    this.#options = options;
  }

  /** 预算（高斯个数）：渲染器按显示的泼溅分配总预算 */
  setBudget(budget: number): void {
    this.#scheduler.splatBudget = budget;
  }

  /** 换 WebGLRenderer（挂上、上下文丢失后恢复）：库的绘制对象绑定在渲染器上，跟着重建；null 时只丢掉 */
  setRenderer(webgl: WebGLRenderer | null): void {
    if (webgl === this.#webgl || this.#disposed) {
      return;
    }
    this.#dropSplatRenderer();
    this.#webgl = webgl;
    if (webgl) {
      const events = this.#events;
      const splatRenderer = new this.#library.GaussianSplatRenderer({ renderer: webgl, onDirty: () => events.repaint() });
      this.scene.add(splatRenderer);
      this.#splatRenderer = splatRenderer;
    }
  }

  /** 画一帧之前：按这一帧的投影换算相机，让库选细节；不显示、没有绘制对象、在地球背面时不画 */
  prepare(frame: SceneFrame, surface: SceneSurface): boolean {
    this.#drawn = false;
    if (!this.#options.show || !this.#splatRenderer) {
      return false;
    }
    this.#anchor ??= surface.anchor(...this.#frame.anchor);
    if (this.#math.behindGlobe(frame, this.#anchor)) {
      return false;
    }
    this.#math.syncCamera(this.camera, this.#math.clipMatrix(frame, this.#anchor, this.#clip), frame);
    this.scene.updateMatrixWorld(true);
    this.#scheduler.update();
    this.#drawn = true;
    return true;
  }

  /** 这一帧不画（抬高期间只画抬高的瓦片集）：拾取不到 */
  skipFrame(): void {
    this.#drawn = false;
  }

  /** 按最近一帧的投影拾取（做法同瓦片集）；命中的是当前加载的细节 */
  pick(raycaster: Raycaster, ndc: readonly [number, number]): TilesetHit | null {
    if (!this.#drawn) {
      return null;
    }
    const { origin, direction } = raycaster.ray;
    origin.set(ndc[0], ndc[1], -1).unproject(this.camera);
    direction.set(ndc[0], ndc[1], 1).unproject(this.camera).sub(origin).normalize();
    const [hit] = raycaster.intersectObject(this.#scheduler.group, true);
    return hit ? { distance: hit.distance, lngLatHeight: this.#frame.toLngLatHeight(hit.point) } : null;
  }

  /**
   * 同一处的倾斜模型在这个盒子里不画（ADR 0149）：索引根节点的包围盒按摆放换到地心坐标，四周多留 CLIP_MARGIN；
   * 还没读到索引、隐藏时为 null。包围盒比实际扫描到的范围大，盒子里没扫到的地方两者都没有
   */
  clipBox(): ClipBox | null {
    const box = this.#box;
    if (!box || !this.#options.show) {
      return null;
    }
    const center = box.getCenter(new Vector3());
    const half = box.getSize(new Vector3()).multiplyScalar(0.5).addScalar(CLIP_MARGIN);
    const toEcef = this.#frame.toEcef
      .clone()
      .multiply(this.#scheduler.group.matrix)
      .multiply(new Matrix4().makeTranslation(center));
    return { toEcef, half };
  }

  inspect(): SplatEntryInspection {
    const stats = this.#scheduler.stats;
    return {
      budget: this.#scheduler.splatBudget,
      visibleSplats: stats.visibleSplats,
      residentChunks: stats.residentChunks,
      loadingChunks: stats.loadingChunks,
      loadProgress: stats.loadProgress,
      cpuBytes: stats.residentCpuBytes,
      gpuBytes: stats.residentGpuBytes,
      pendingBytes: stats.pendingBytes
    };
  }

  [Symbol.dispose](): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#dropSplatRenderer();
    this.#scheduler.dispose();
    this.#scheduler.group.removeFromParent();
  }

  #dropSplatRenderer(): void {
    this.#splatRenderer?.removeFromParent();
    this.#splatRenderer?.dispose();
    this.#splatRenderer = null;
  }

  // 库给的包围盒在调度器的组里（LCC2 的局部系），按摆放换到锚点的局部系再取包围球
  #sphere(): TilesetSphere {
    const box = this.#scheduler.getBoundingBox();
    if (box.isEmpty()) {
      throw new Error(`${this.#source.url} 没有包围盒`);
    }
    this.#box = box.clone();
    const sphere = box.clone().applyMatrix4(this.#scheduler.group.matrix).getBoundingSphere(new Sphere());
    const [lng, lat] = this.#frame.toLngLatHeight(sphere.center);
    return { center: [lng, lat], radius: sphere.radius };
  }
}
