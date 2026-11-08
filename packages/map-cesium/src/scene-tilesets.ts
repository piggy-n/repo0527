import type { PreparedTileset, TilesetLighting } from '@mx/map-core';
import {
  type BoundingSphere,
  Cartesian3,
  type Cesium3DTile,
  Cesium3DTileset,
  type CesiumWidget,
  CustomShader,
  LightingModel,
  Math as CesiumMath,
  PerspectiveFrustum,
  ShadowMode,
  UniformType
} from 'cesium';
import type { TileSelectionSummary, TilesetInspection, TilesetStatistics } from './scene-inspection';
import type { TilesetOptions } from './scene-like';

const MEGABYTE = 1024 * 1024;

// 相机停下时离定地板的位置超过椭球高的这个比例，或者转过这个角度，才算换了姿态、放开地板
const FLOOR_RELEASE_DISTANCE_RATIO = 0.25;
const FLOOR_RELEASE_ANGLE = CesiumMath.toRadians(10);
// 放大后的屏幕误差不超过根节点屏幕误差的这个比例：超过了 Cesium 一个瓦片都不画
const ROOT_CAP_RATIO = 0.9;

// 沿用旧项目实测的参数（ADR 0081 第 3 节）：移动时不请求、不预加载。显存预算按倾斜摄影定（取值的理由见
// docs/modules/map-cesium.md）：缓存加溢出要放得下视野里最粗一级的全部块（JKQ2 远看块根就要 1.7 GB），
// 否则 Cesium 一个瓦片都不画
const TILESET_OPTIONS = {
  maximumScreenSpaceError: 16,
  cacheBytes: 1024 * MEGABYTE,
  maximumCacheOverflowBytes: 1024 * MEGABYTE,
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

// 屏幕误差开始涨时的相机：位置、朝向和椭球高
interface CameraPose {
  readonly position: Cartesian3;
  readonly direction: Cartesian3;
  readonly height: number;
}

interface Entry {
  readonly tileset: Cesium3DTileset;
  readonly unsubscribe: () => void;
  // 设定的屏幕误差；Cesium 按显存放大后回落时不低于这个姿态下的峰值（地板）
  configuredError: number;
  // 上一个 tick 读到的按显存调整后的屏幕误差，以及这个姿态下看到的上涨里最高的
  adjustedError: number;
  peakError: number;
  // 这个姿态下第一次涨时记下的相机；相机离开得够远就从设定值重来，峰值不带到下一个姿态
  pose: CameraPose | null;
  // 已经把 maximumScreenSpaceError 提到峰值（地板）或压到根节点以下
  pinned: boolean;
  // 诊断用的累计次数
  loaded: number;
  unloaded: number;
  failed: number;
  // 这一帧、上一帧画出的瓦片（tileVisible），inspect 算清晰度用
  frameTiles: Cesium3DTile[];
  lastFrameTiles: Cesium3DTile[];
}

// 一帧画出的瓦片合起来的清晰度：贴图像素数开方除以投影直径（像素），几何误差换算成像素，都按投影面积加权
function summarizeSelection(
  tiles: readonly Cesium3DTile[],
  cameraPosition: Cartesian3,
  pixelsPerMeterAtUnitDistance: number
): TileSelectionSummary | null {
  if (tiles.length === 0) {
    return null;
  }
  let area = 0;
  let density = 0;
  let blurry = 0;
  let errorPixels = 0;
  let coarsestError = 0;
  for (const tile of tiles) {
    const { radius, center } = tile.boundingSphere;
    const distance = Math.max(1, Cartesian3.distance(cameraPosition, center) - radius);
    const diameter = (2 * radius * pixelsPerMeterAtUnitDistance) / distance;
    const tileArea = Math.PI * (diameter / 2) ** 2;
    const texels = (tile.content?.texturesByteLength ?? 0) / 4;
    const tileDensity = Math.sqrt(texels) / Math.max(1, diameter);
    area += tileArea;
    density += tileDensity * tileArea;
    blurry += tileDensity < 1 ? tileArea : 0;
    errorPixels += ((tile.geometricError * pixelsPerMeterAtUnitDistance) / distance) * tileArea;
    coarsestError = Math.max(coarsestError, tile.geometricError);
  }
  if (area === 0) {
    return null;
  }
  return {
    count: tiles.length,
    texelDensity: density / area,
    blurryShare: blurry / area,
    errorPixels: errorPixels / area,
    coarsestError
  };
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
    // postUpdate 每个 tick 都触发，在 Cesium 调整屏幕误差之后；
    // preRender 只在真的画一帧之前触发，这时上一帧画过的瓦片收齐了
    const stopAdjusting = widget.scene.postUpdate.addEventListener(() => this.#watchAdjusting());
    const stopFrames = widget.scene.preRender.addEventListener(() => {
      for (const entry of this.#entries.values()) {
        entry.lastFrameTiles = entry.frameTiles;
        entry.frameTiles = [];
      }
    });
    this.#stopWatching = () => {
      stopAdjusting();
      stopFrames();
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
      pose: null,
      pinned: false,
      loaded: 0,
      unloaded: 0,
      failed: 0,
      frameTiles: [],
      lastFrameTiles: []
    };
    this.#apply(entry, options);
    this.#widget.scene.primitives.add(tileset);
    unsubscribers.push(
      tileset.tileVisible.addEventListener((tile: Cesium3DTile) => {
        entry.frameTiles.push(tile);
      }),
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
        screenSpaceErrorFloor: entry.pinned ? tileset.maximumScreenSpaceError : null,
        memoryAdjustedScreenSpaceError: memoryAdjustedError(tileset),
        totalMemoryUsageInBytes: tileset.totalMemoryUsageInBytes,
        tilesLoaded: tileset.tilesLoaded,
        statistics: readStatistics(tileset),
        selection: summarizeSelection(
          entry.lastFrameTiles,
          this.#widget.camera.positionWC,
          this.#pixelsPerMeterAtUnitDistance()
        ),
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
  // 再整级丢掉，这样循环不止（俯视平地时各块离相机一样远，一级要么全要、要么全不要）。
  // 峰值只算这个姿态下看到的上涨：相机离开开始涨的位置就从设定值重来（每个 tick 看，等 moveEnd 来不及：
  // 换姿态后缓存一卸载 Cesium 就开始回落，上一个姿态的峰值会被当成新姿态的地板）
  #watchAdjusting(): void {
    let changed = false;
    for (const entry of this.#entries.values()) {
      if (entry.pose && this.#leftPose(entry.pose)) {
        this.#resetFloor(entry);
        continue;
      }
      const error = memoryAdjustedError(entry.tileset);
      if (error === entry.adjustedError) {
        continue;
      }
      // 涨过根节点的屏幕误差时 Cesium 一个瓦片都不画（根节点没有内容的 JKQ2 整个消失）：压回根节点以下，
      // 已经加载的瓦片继续画，显存超预算就超着，没加载的那些不再加载。压住以后 Cesium 每个 tick 还会再涨 2%，
      // 又被压回来：画的东西没变，不为这个请求渲染
      const cap = this.#rootCap(entry);
      if (error > cap) {
        entry.tileset.maximumScreenSpaceError = cap;
        entry.pose ??= this.#cameraPose();
        entry.pinned = true;
        entry.peakError = cap;
        changed ||= entry.adjustedError !== cap;
        entry.adjustedError = cap;
        continue;
      }
      changed = true;
      if (error > entry.adjustedError) {
        entry.pose ??= this.#cameraPose();
        entry.peakError = Math.max(entry.peakError, error);
      } else if (entry.peakError > entry.configuredError) {
        // setter 会把调整后的值也设成地板
        entry.tileset.maximumScreenSpaceError = entry.peakError;
        entry.pinned = true;
        entry.adjustedError = entry.peakError;
        continue;
      }
      entry.adjustedError = error;
    }
    if (changed) {
      this.#widget.scene.requestRender();
    }
  }

  // 根节点屏幕误差的九成，不低于设定值。Cesium 判断要不要往下走用的是根节点到包围盒的距离，它每次遍历都算好
  // 放在根节点上（@private，和统计一样按类型断言读；包围球算出来偏大，不能用）
  #rootCap(entry: Entry): number {
    const { _screenSpaceError: rootError } = entry.tileset.root as Cesium3DTile & {
      readonly _screenSpaceError: number;
    };
    return Math.max(entry.configuredError, ROOT_CAP_RATIO * rootError);
  }

  // 1 米远处 1 米长在屏幕上的像素数：画布高 / (2 tan(竖直视场角 / 2))，Cesium 算屏幕误差用的同一个比例
  #pixelsPerMeterAtUnitDistance(): number {
    const { scene, camera } = this.#widget;
    const { frustum } = camera;
    const fovy = (frustum instanceof PerspectiveFrustum ? frustum.fovy : undefined) ?? Math.PI / 3;
    return scene.drawingBufferHeight / (2 * Math.tan(fovy / 2));
  }

  // 相机换了姿态：离开始涨的位置够远（按当时的椭球高算），或者转过头去。视野变了，放得下的一级也变了
  #leftPose(pose: CameraPose): boolean {
    const { camera } = this.#widget;
    const moved =
      Cartesian3.distance(camera.positionWC, pose.position) >
      FLOOR_RELEASE_DISTANCE_RATIO * Math.max(1, Math.abs(pose.height));
    return moved || Cartesian3.angleBetween(camera.directionWC, pose.direction) > FLOOR_RELEASE_ANGLE;
  }

  #cameraPose(): CameraPose {
    const { camera } = this.#widget;
    return {
      position: Cartesian3.clone(camera.positionWC),
      direction: Cartesian3.clone(camera.directionWC),
      height: camera.positionCartographic.height
    };
  }

  // 从设定值重来：setter 会把 Cesium 调整后的值也设回去
  #resetFloor(entry: Entry): void {
    entry.pose = null;
    entry.pinned = false;
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
