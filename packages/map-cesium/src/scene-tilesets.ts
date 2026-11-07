import type { PreparedTileset, TilesetLighting } from '@mx/map-core';
import {
  type BoundingSphere,
  Cartesian3,
  Cesium3DTileset,
  type CesiumWidget,
  CustomShader,
  LightingModel,
  Math as CesiumMath,
  ShadowMode,
  UniformType
} from 'cesium';
import type { TilesetInspection, TilesetStatistics } from './scene-inspection';
import type { TilesetOptions } from './scene-like';

const MEGABYTE = 1024 * 1024;

// 相机停下时离定地板的位置超过椭球高的这个比例，或者转过这个角度，才算换了姿态、放开地板
const FLOOR_RELEASE_DISTANCE_RATIO = 0.25;
const FLOOR_RELEASE_ANGLE = CesiumMath.toRadians(10);

// 沿用旧项目实测的参数（ADR 0081 第 3 节）：移动时不请求、不预加载。显存预算按倾斜摄影定（取值的理由见
// docs/modules/map-cesium.md）：缓存要放得下视野里最粗一级的全部块，屏幕误差才能降回 16
const TILESET_OPTIONS = {
  maximumScreenSpaceError: 16,
  cacheBytes: 1024 * MEGABYTE,
  maximumCacheOverflowBytes: 512 * MEGABYTE,
  cullRequestsWhileMoving: true,
  preloadWhenHidden: false,
  preloadFlightDestinations: false,
  skipLevelOfDetail: false,
  dynamicScreenSpaceError: false,
  foveatedTimeDelay: 0.2,
  shadows: ShadowMode.DISABLED,
  enableCollision: false,
  backFaceCulling: false
} satisfies Cesium3DTileset.ConstructorOptions;

/**
 * 地下、室内的"头灯"光照（旧项目的做法）：以相机为光源，正对视线的面亮、斜掠的面暗，和时间无关；
 * 模型的材质是双面的，法线用屏幕空间导数求。第三人称的人物也用它，站内明暗一致
 */
export function createHeadlightShader(): CustomShader {
  return new CustomShader({
    lightingModel: LightingModel.UNLIT,
    uniforms: { uFog: { type: UniformType.FLOAT, value: 0 } },
    fragmentShaderText: `
      void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
        vec3 positionEC = fsInput.attributes.positionEC;
        vec3 normalEC = normalize(cross(dFdx(positionEC), dFdy(positionEC)));
        float facing = abs(dot(normalEC, normalize(-positionEC)));
        float fog = mix(1.0, 0.45, smoothstep(15.0, 180.0, length(positionEC)) * uFog);
        material.diffuse *= (0.5 + 0.5 * facing) * fog * 1.15;
      }
    `
  });
}

// Cesium 标成 @private、类型声明里没有，但它的文档和超出预算的警告都让看这个值；版本精确锁定，改名时浏览器测试会失败
/** 按显存调整后的屏幕误差（只读） */
export function memoryAdjustedError(tileset: Cesium3DTileset): number {
  const { memoryAdjustedScreenSpaceError } = tileset as Cesium3DTileset & {
    readonly memoryAdjustedScreenSpaceError: number;
  };
  return memoryAdjustedScreenSpaceError;
}

// 同样标成 @private 的统计：诊断读数只读它的计数
function readStatistics(tileset: Cesium3DTileset): TilesetStatistics {
  const { statistics } = tileset as Cesium3DTileset & { readonly statistics: TilesetStatistics };
  return {
    selected: statistics.selected,
    visited: statistics.visited,
    numberOfAttemptedRequests: statistics.numberOfAttemptedRequests,
    numberOfPendingRequests: statistics.numberOfPendingRequests,
    numberOfTilesProcessing: statistics.numberOfTilesProcessing,
    numberOfTilesWithContentReady: statistics.numberOfTilesWithContentReady,
    numberOfTilesTotal: statistics.numberOfTilesTotal,
    numberOfLoadedTilesTotal: statistics.numberOfLoadedTilesTotal
  };
}

export interface SceneTilesetEvents {
  readonly failed: (id: string, error: unknown) => void;
  readonly initial: (id: string) => void;
}

// 定地板时的相机：位置、朝向和椭球高
interface FloorPose {
  readonly position: Cartesian3;
  readonly direction: Cartesian3;
  readonly height: number;
}

interface Entry {
  readonly tileset: Cesium3DTileset;
  readonly unsubscribe: () => void;
  // 设定的屏幕误差；Cesium 按显存放大后回落时不低于这个姿态下的峰值（地板）
  configuredError: number;
  // 上一个 tick 读到的按显存调整后的屏幕误差，以及这个姿态下涨到的最高值
  adjustedError: number;
  peakError: number;
  // 定了地板时记下的相机；相机离开得够远才放开
  floor: FloorPose | null;
  // 诊断用的累计次数
  loaded: number;
  unloaded: number;
  failed: number;
}

/** 场景里的 3D Tiles 瓦片集（ADR 0081 第 3 节）：按 ID 加、改、删，瓦片失败和首批瓦片到位通过回调报告 */
export class SceneTilesets implements Disposable {
  readonly #widget: CesiumWidget;
  readonly #events: SceneTilesetEvents;
  readonly #entries = new Map<string, Entry>();
  readonly #headlight = createHeadlightShader();
  readonly #stopWatching: () => void;
  #disposed = false;

  constructor(widget: CesiumWidget, events: SceneTilesetEvents) {
    this.#widget = widget;
    this.#events = events;
    // postUpdate 每个 tick 都触发，在 Cesium 调整屏幕误差之后；相机停下时看要不要放开地板
    const stopAdjusting = widget.scene.postUpdate.addEventListener(() => this.#watchAdjusting());
    const stopIdle = widget.camera.moveEnd.addEventListener(() => this.#releaseFloors());
    this.#stopWatching = () => {
      stopAdjusting();
      stopIdle();
    };
  }

  /** 建好瓦片集并加进场景；signal 中止或已释放时销毁建好的瓦片集、以原因结束 */
  async add(
    id: string,
    prepared: PreparedTileset,
    options: TilesetOptions,
    signal: AbortSignal
  ): Promise<BoundingSphere> {
    if (this.#entries.has(id)) {
      throw new Error(`瓦片集 ${id} 已经加过`);
    }
    // 整理后的索引里内容都是绝对地址，用 Blob 地址交给 Cesium，建好后就可以释放
    const url = URL.createObjectURL(new Blob([JSON.stringify(prepared)], { type: 'application/json' }));
    let tileset: Cesium3DTileset;
    try {
      tileset = await Cesium3DTileset.fromUrl(url, TILESET_OPTIONS);
    } finally {
      URL.revokeObjectURL(url);
    }
    if (signal.aborted || this.#disposed || this.#entries.has(id)) {
      tileset.destroy();
      signal.throwIfAborted();
      throw new Error(this.#disposed ? '场景已释放' : `瓦片集 ${id} 已经加过`);
    }
    const unsubscribers: (() => void)[] = [];
    const entry: Entry = {
      tileset,
      unsubscribe: () => unsubscribers.forEach(unsubscribe => unsubscribe()),
      configuredError: TILESET_OPTIONS.maximumScreenSpaceError,
      adjustedError: memoryAdjustedError(tileset),
      peakError: TILESET_OPTIONS.maximumScreenSpaceError,
      floor: null,
      loaded: 0,
      unloaded: 0,
      failed: 0
    };
    this.#apply(entry, options);
    this.#widget.scene.primitives.add(tileset);
    unsubscribers.push(
      tileset.tileFailed.addEventListener(({ message }: { message: unknown }) => {
        entry.failed++;
        this.#events.failed(id, new Error(`瓦片集 ${id} 的瓦片加载失败`, { cause: message }));
      }),
      tileset.initialTilesLoaded.addEventListener(() => this.#events.initial(id)),
      tileset.tileLoad.addEventListener(() => {
        entry.loaded++;
      }),
      tileset.tileUnload.addEventListener(() => {
        entry.unloaded++;
      })
    );
    this.#entries.set(id, entry);
    this.#widget.scene.requestRender();
    return tileset.boundingSphere;
  }

  update(id: string, options: TilesetOptions): void {
    const entry = this.#entries.get(id);
    if (entry) {
      this.#apply(entry, options);
      this.#widget.scene.requestRender();
    }
  }

  remove(id: string): void {
    const entry = this.#entries.get(id);
    if (!entry) {
      return;
    }
    entry.unsubscribe();
    // 从场景移除时 Cesium 销毁瓦片集，释放显存
    this.#widget.scene.primitives.remove(entry.tileset);
    this.#entries.delete(id);
    this.#widget.scene.requestRender();
  }

  boundingSphere(id: string): BoundingSphere | undefined {
    return this.#entries.get(id)?.tileset.boundingSphere;
  }

  /** 步行时按距离压暗远处，增加通道的纵深（旧项目的做法）；平时关掉，俯瞰整座车站时不发灰 */
  setInteriorFog(enabled: boolean): void {
    this.#headlight.setUniform('uFog', enabled ? 1 : 0);
    this.#widget.scene.requestRender();
  }

  /** 诊断读数：每个瓦片集的显存、屏幕误差、统计和累计次数 */
  inspect(): TilesetInspection[] {
    return [...this.#entries].map(([id, entry]) => {
      const { tileset } = entry;
      return {
        id,
        show: tileset.show,
        cacheBytes: tileset.cacheBytes,
        maximumCacheOverflowBytes: tileset.maximumCacheOverflowBytes,
        maximumScreenSpaceError: tileset.maximumScreenSpaceError,
        screenSpaceErrorFloor: entry.floor ? tileset.maximumScreenSpaceError : null,
        memoryAdjustedScreenSpaceError: memoryAdjustedError(tileset),
        totalMemoryUsageInBytes: tileset.totalMemoryUsageInBytes,
        tilesLoaded: tileset.tilesLoaded,
        statistics: readStatistics(tileset),
        loaded: entry.loaded,
        unloaded: entry.unloaded,
        failed: entry.failed
      };
    });
  }

  /** 有显示着的瓦片集：没有时拾取模型注定落空 */
  get anyShown(): boolean {
    for (const { tileset } of this.#entries.values()) {
      if (tileset.show) {
        return true;
      }
    }
    return false;
  }

  [Symbol.dispose](): void {
    this.#disposed = true;
    this.#stopWatching();
    for (const id of this.#entries.keys()) {
      this.remove(id);
    }
    this.#headlight.destroy();
  }

  // 超出显存预算时 Cesium 每个 tick 放大屏幕误差，卸载瓦片却只在渲染的帧里做：按需渲染下两次渲染之间它一直涨，
  // 越过没有内容的根节点后整棵树都不画（见 docs/modules/map-cesium.md）。变了就请求渲染，和连续渲染一样及时卸载。
  // 放大后一回落就把地板定在这个姿态下的峰值：放不下的那一级被整级丢掉以后显存远低于缓存，Cesium 会立刻降回去重新加载，
  // 再整级丢掉，这样循环不止（俯视平地时各块离相机一样远，一级要么全要、要么全不要）
  #watchAdjusting(): void {
    let changed = false;
    for (const entry of this.#entries.values()) {
      const error = memoryAdjustedError(entry.tileset);
      if (error === entry.adjustedError) {
        continue;
      }
      changed = true;
      entry.peakError = Math.max(entry.peakError, error);
      if (error < entry.adjustedError && entry.peakError > entry.configuredError) {
        // setter 会把调整后的值也设成地板
        entry.tileset.maximumScreenSpaceError = entry.peakError;
        entry.floor ??= this.#cameraPose();
        entry.adjustedError = entry.peakError;
        continue;
      }
      entry.adjustedError = error;
    }
    if (changed) {
      this.#widget.scene.requestRender();
    }
  }

  // 相机换了姿态（离定地板的位置够远，或者转过头去）再从设定值重新来：视野变了，放得下的一级也变了
  #releaseFloors(): void {
    const { camera } = this.#widget;
    for (const entry of this.#entries.values()) {
      const { floor } = entry;
      if (!floor) {
        continue;
      }
      const moved =
        Cartesian3.distance(camera.positionWC, floor.position) >
        FLOOR_RELEASE_DISTANCE_RATIO * Math.max(1, Math.abs(floor.height));
      const turned = Cartesian3.angleBetween(camera.directionWC, floor.direction) > FLOOR_RELEASE_ANGLE;
      if (moved || turned) {
        this.#resetFloor(entry);
      }
    }
  }

  #cameraPose(): FloorPose {
    const { camera } = this.#widget;
    return {
      position: Cartesian3.clone(camera.positionWC),
      direction: Cartesian3.clone(camera.directionWC),
      height: camera.positionCartographic.height
    };
  }

  #resetFloor(entry: Entry): void {
    entry.floor = null;
    entry.peakError = entry.configuredError;
    entry.adjustedError = entry.configuredError;
    entry.tileset.maximumScreenSpaceError = entry.configuredError;
    this.#widget.scene.requestRender();
  }

  #apply(entry: Entry, { show, lighting, maximumScreenSpaceError }: TilesetOptions): void {
    entry.tileset.show = show;
    entry.tileset.customShader = lightingShader(lighting, this.#headlight);
    const configured = maximumScreenSpaceError ?? TILESET_OPTIONS.maximumScreenSpaceError;
    if (configured !== entry.configuredError) {
      entry.configuredError = configured;
      this.#resetFloor(entry);
    }
  }
}

function lightingShader(lighting: TilesetLighting, headlight: CustomShader): CustomShader | undefined {
  return lighting === 'headlight' ? headlight : undefined;
}
