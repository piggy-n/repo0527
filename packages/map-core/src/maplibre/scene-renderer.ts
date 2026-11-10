import type { Unsubscribe } from '../events';
import type { PreparedTileset } from '../scene/prepare-tileset';
import type { SplatOptions, SplatSource } from '../scene/splat-sync';
import type { TilesetSphere } from '../scene/tileset-camera';
import type { TilesetOptions } from '../scene/tileset-sync';
import type { LngLat, ScreenPoint } from '../view/view-input';

// MapLibre 引擎的三维渲染器和 MapLibre 适配器之间的窄接口（ADR 0147 第 5 节）：
// 适配器持有 custom layer 的外壳，每帧把矩阵、投影过渡值和 GL 上下文交给渲染器；渲染器（@mx/map-three）不碰 MapLibre

/** 4×4 矩阵，列主序 */
export type Matrix4Array = ArrayLike<number>;

/** 局部系（x 东、y 上、z 南，米，原点在锚点的椭球面上）到 MapLibre 两种投影的世界坐标 */
export interface AnchorMatrices {
  /** 墨卡托世界（0～1） */
  readonly mercator: Matrix4Array;
  /** 地球投影的单位球 */
  readonly globe: Matrix4Array;
}

/** 外壳挂上时交给渲染器的：共用的 GL 上下文和画布、请求重画、锚点矩阵 */
export interface SceneSurface {
  readonly gl: WebGL2RenderingContext;
  readonly canvas: HTMLCanvasElement;
  requestRepaint(): void;
  /** 东、北按 WGS84 椭球算比例，竖直方向和 MapLibre 的高度比例一致 */
  anchor(lng: number, lat: number): AnchorMatrices;
}

/** 每一帧的投影：来自 MapLibre 的 defaultProjectionData 和 projectionMatrix */
export interface SceneFrame {
  /** 世界坐标到裁剪空间；地球投影时是单位球的 */
  readonly mainMatrix: Matrix4Array;
  /** 过渡段里墨卡托一侧的矩阵 */
  readonly fallbackMatrix: Matrix4Array;
  /** 只有透视投影，不含相机位姿 */
  readonly projectionMatrix: Matrix4Array;
  /** 0 是墨卡托，1 是地球；中间是过渡段，要按 mix(墨卡托, 地球, t) 在裁剪空间插值 */
  readonly transition: number;
  /** 地球背面的裁剪面（单位球坐标） */
  readonly clippingPlane: readonly [number, number, number, number];
}

/** 渲染器报告的事件：瓦片失败、显示后首批瓦片到位、高斯泼溅的数据加载失败 */
export interface SceneRendererEvents {
  tilesetfailed: (id: string, error: unknown) => void;
  tilesetinitial: (id: string) => void;
  splatfailed: (id: string, error: unknown) => void;
}

/** 拾取到的模型表面：真实的经纬度和椭球高 */
export interface ScenePick {
  readonly lngLat: LngLat;
  readonly height: number;
}

/**
 * 抬高（ADR 0147 第 4 节）：MapLibre 把相机限制在 0 米以上，漫游地下的模型时把它抬高 meters 米。
 * 抬高期间只画这个瓦片集，画模型之前用 backdrop 清屏，盖住二维和天空
 */
export interface SceneLift {
  readonly tilesetId: string;
  readonly meters: number;
  /** CSS 颜色 */
  readonly backdrop: string;
}

/** 点击移动的落点：真实的经纬度和椭球高（脚下的地板） */
export interface SceneMarker {
  readonly lngLat: LngLat;
  readonly height: number;
}

/**
 * 三维渲染器（ADR 0147 第 2、5 节）：一个 WebGLRenderer 和 MapLibre 共用 GL 上下文；内容（瓦片集）和 GPU 资源分开，
 * 撤下层、上下文丢失时内容都保留
 */
export interface SceneRenderer extends Disposable {
  /** 外壳加到地图上（onAdd）：同一个上下文再次挂上时复用之前的渲染器和 GPU 资源 */
  attach(surface: SceneSurface): void;
  /** 外壳从地图撤下（onRemove）：不再画，内容和 GPU 资源保留 */
  detach(): void;
  /** GL 上下文丢失：丢掉渲染器和 GPU 资源，内容保留；恢复后再次 attach 时重新上传 */
  loseContext(): void;
  /** MapLibre 每帧在绘制图层之前调用 */
  prerender(): void;
  render(frame: SceneFrame): void;
  /** MapLibre 画完一帧（地图的 render 事件）：渲染器在回调外改过的 GL 状态要作废 */
  endFrame(): void;
  /** 建好瓦片集并加进场景，给出包围球；signal 中止时销毁建好的瓦片集、以中止的原因结束 */
  addTileset(id: string, tileset: PreparedTileset, options: TilesetOptions, signal: AbortSignal): Promise<TilesetSphere>;
  updateTileset(id: string, options: TilesetOptions): void;
  removeTileset(id: string): void;
  /**
   * 加一份 LCC2 高斯泼溅（ADR 0149）：读索引、按摆放放进场景，给出包围球；数据随相机流式加载。
   * signal 中止时释放建好的、以中止的原因结束
   */
  addSplat(id: string, source: SplatSource, options: SplatOptions, signal: AbortSignal): Promise<TilesetSphere>;
  updateSplat(id: string, options: SplatOptions): void;
  removeSplat(id: string): void;
  /**
   * 按最近一帧的相机拾取画出的模型（瓦片集和高斯泼溅），跳过半透明的表面（同 Cesium 的深度拾取，隔着玻璃点到的是后面）；
   * 结果是真实的高度（抬高时减回去）。没有打到、还没画过时为 null
   */
  pick(point: ScreenPoint): ScenePick | null;
  /** 按最近一帧的相机投影真实的位置（抬高时加上抬高量）；还没画过、在相机背后时为 null */
  project(lngLat: LngLat, height: number): ScreenPoint | null;
  /** 抬高一个瓦片集，null 时恢复；没有这个瓦片集时不抬高 */
  setLift(lift: SceneLift | null): void;
  /** 瓦片集根节点包围盒最低处的真实椭球高（米）；没有这个瓦片集、根索引还没读到时为 null */
  lowestHeight(id: string): number | null;
  /** 头灯按距离压暗远处：步行时打开（同 Cesium 的 uFog） */
  setInteriorFog(enabled: boolean): void;
  /** 点击移动的落点光环；null 撤掉 */
  setMarker(marker: SceneMarker | null): void;
  on<E extends keyof SceneRendererEvents>(event: E, callback: SceneRendererEvents[E]): Unsubscribe;
}

/** 创建渲染器 */
export type CreateSceneRenderer = () => SceneRenderer;

/** 加载三维模块后给出创建渲染器的函数：由 map-vue 动态导入 @mx/map-three（ADR 0147 第 5 节） */
export type SceneRendererLoader = () => Promise<CreateSceneRenderer>;
