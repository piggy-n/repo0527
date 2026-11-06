import type { AnchorMatrices, PreparedTileset, SceneFrame, SceneSurface, TilesetOptions, TilesetSphere } from '@mx/map-core';
import { abortReason } from '@mx/utils';
import { type LRUCache, TilesRenderer } from '3d-tiles-renderer';
import { Group, Matrix4, PerspectiveCamera, type Raycaster, Scene, Sphere } from 'three';
import type { FrameMath } from './frame';
import { createSunLights, TilesetMaterials } from './lighting';
import { LocalFrame } from './local-frame';

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
  readonly events: TilesetEntryEvents;
}

/** 拾取到的点：经纬度、椭球高和到相机的距离（米） */
export interface TilesetHit {
  readonly distance: number;
  readonly lngLatHeight: [number, number, number];
}

// 和 Cesium 的 maximumScreenSpaceError 相同（scene-tilesets 的 TILESET_OPTIONS）
const ERROR_TARGET = 16;

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
  readonly #materials = new TilesetMaterials();
  readonly #clip = new Matrix4();
  readonly #url: string;
  #options: TilesetOptions;
  #frame: LocalFrame | null = null;
  #anchor: AnchorMatrices | null = null;
  #initial = false;
  // 最近一帧画了：拾取只看画出来的
  #drawn = false;

  constructor({ prepared, options, cache, math, events }: TilesetEntryOptions) {
    this.#math = math;
    this.#events = events;
    this.#options = options;
    // 整理后的索引里内容都是绝对地址，用 Blob 地址交给瓦片库，读到根索引后释放
    this.#url = URL.createObjectURL(new Blob([JSON.stringify(prepared)], { type: 'application/json' }));
    const tiles = new TilesRenderer(this.#url);
    tiles.lruCache = cache;
    tiles.errorTarget = ERROR_TARGET;
    tiles.setCamera(this.camera);
    tiles.setResolution(this.camera, 1, 1);
    tiles.addEventListener('load-model', ({ scene }) => this.#materials.adopt(scene, this.#options.lighting));
    tiles.addEventListener('dispose-model', ({ scene }) => this.#materials.release(scene));
    tiles.addEventListener('load-error', ({ tile, error }) => {
      if (tile) {
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
        const frame = LocalFrame.fromEcefCenter(sphere.center);
        this.#frame = frame;
        this.#root.matrix.copy(frame.fromEcef);
        this.#root.matrixWorldNeedsUpdate = true;
        resolve({ center: frame.anchor, radius: sphere.radius });
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
  }

  /** 画一帧之前：按这一帧的投影换算相机、选瓦片；不显示、根索引没到、在地球背面时不画 */
  prepare(frame: SceneFrame, surface: SceneSurface, width: number, height: number): boolean {
    this.#drawn = false;
    const localFrame = this.#frame;
    if (!this.#options.show || !localFrame) {
      return false;
    }
    this.#anchor ??= surface.anchor(...localFrame.anchor);
    if (this.#math.behindGlobe(frame, this.#anchor)) {
      return false;
    }
    this.#math.syncCamera(this.camera, this.#math.clipMatrix(frame, this.#anchor, this.#clip), frame);
    this.scene.updateMatrixWorld(true);
    this.tiles.setResolution(this.camera, width, height);
    this.tiles.update();
    if (!this.#initial && this.tiles.root && this.tiles.loadProgress === 1) {
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
    const [hit] = raycaster.intersectObject(this.tiles.group, true);
    return hit ? { distance: hit.distance, lngLatHeight: localFrame.toLngLatHeight(hit.point) } : null;
  }

  [Symbol.dispose](): void {
    URL.revokeObjectURL(this.#url);
    this.tiles.dispose();
    this.#materials.dispose();
  }
}
