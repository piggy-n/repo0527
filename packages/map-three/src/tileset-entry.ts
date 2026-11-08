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
import { type LRUCache, TilesRenderer } from '3d-tiles-renderer';
import {
  Box3,
  Group,
  type Intersection,
  type Material,
  Matrix4,
  type Mesh,
  PerspectiveCamera,
  type Raycaster,
  Scene,
  Sphere,
  Vector3
} from 'three';
import type { FrameMath } from './frame';
import { createSunLights, type FogUniform, TilesetMaterials } from './lighting';
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
  /** 渲染器共用的头灯远处压暗开关 */
  readonly fog: FogUniform;
  readonly events: TilesetEntryEvents;
}

/** 拾取到的点：经纬度、真实的椭球高（抬高时已减回去）和到相机的距离（米） */
export interface TilesetHit {
  readonly distance: number;
  readonly lngLatHeight: [number, number, number];
}

// 和 Cesium 的 maximumScreenSpaceError 相同（scene-tilesets 的 TILESET_OPTIONS）
const ERROR_TARGET = 16;

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
  #frame: LocalFrame | null = null;
  #anchor: AnchorMatrices | null = null;
  #initial = false;
  // 最近一帧画了：拾取只看画出来的
  #drawn = false;
  // 抬高量（米，ADR 0147 第 4 节）：局部系里沿 y 上移，拾取的命中点减回去
  #lift = 0;

  constructor({ prepared, options, cache, math, fog, events }: TilesetEntryOptions) {
    this.#math = math;
    this.#events = events;
    this.#options = options;
    this.#materials = new TilesetMaterials(fog);
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
        this.#frame = LocalFrame.fromEcefCenter(sphere.center);
        this.#placeRoot();
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
  }

  /** 抬高 meters 米（ADR 0147 第 4 节）：0 时恢复 */
  setLift(meters: number): void {
    if (meters !== this.#lift) {
      this.#lift = meters;
      this.#placeRoot();
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
    const hit = raycaster.intersectObject(this.tiles.group, true).find(opaque);
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
