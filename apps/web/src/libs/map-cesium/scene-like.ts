import type {
  CameraState,
  ClientPoint,
  LngLat,
  MapPointerEvent,
  PickResult,
  RoutePath,
  ScreenPoint,
  TilesetLighting,
  UndergroundView,
  Unsubscribe
} from '@yzt/map-core';
import type { OverlayLayer } from './overlay-plan';
import type { PreparedTileset } from './prepare-tileset';
import type { ImageryPlan } from './scene-style';

/** 离开三维时记下的精确相机（地心坐标系）：视图只保存、原样还原，不解读（ADR 0020 第 5 条） */
export interface ScenePose {
  readonly position: readonly [number, number, number];
  readonly direction: readonly [number, number, number];
  readonly up: readonly [number, number, number];
}

/** 瓦片集可以随时改的部分 */
export interface TilesetOptions {
  readonly show: boolean;
  readonly lighting: TilesetLighting;
}

/** 路线漫游的播放（ADR 0083 第 3 节）：rate 是倍速 */
export interface RoutePlayback {
  readonly playing: boolean;
  readonly rate: number;
}

/** 工具对相机控制的要求：drag 是左键拖动（地球上是旋转），为 false 时关掉 */
export interface SceneGestures {
  readonly drag: boolean;
}

export interface SceneEvents {
  /** 用户在画布上按下鼠标或滚动滚轮：接下来的相机变化是用户操作 */
  interact: () => void;
  /** 相机变了：动画的每一帧、用户拖动中 */
  camerachange: () => void;
  /** 相机停下 */
  cameraidle: () => void;
  /** 画布上的鼠标事件，格式和二维相同（ADR 0024 第 8 条） */
  pointer: (event: MapPointerEvent) => void;
  /** 画布获得焦点时的按键 */
  key: (key: string) => void;
  /** 画布尺寸变了 */
  resize: () => void;
  /** 相机停下、视野里的瓦片都已画出 */
  settle: () => void;
  /** 影像图层的瓦片加载失败，按二维的数据源 ID 报告 */
  imageryerror: (sourceId: string, error: unknown) => void;
  /** 瓦片集的瓦片加载失败（ADR 0081 第 2 节） */
  tilesetfailed: (id: string, error: unknown) => void;
  /** 瓦片集显示后，视野里的首批瓦片已到位（不在视野里时第一帧就到） */
  tilesetinitial: (id: string) => void;
  /** 路线漫游走过的距离（米）：播放时每帧一次，回到起点时一次 */
  routeprogress: (distance: number) => void;
  /** 路线漫游走到了终点，已经停下 */
  routeend: () => void;
  /** 渲染出错，渲染循环已经停下：引擎失败 */
  failure: (error: unknown) => void;
}

/** CesiumView 用到的场景能力（ADR 0079 第 3 节）：只有 CesiumScene 实现它时调用 Cesium，测试注入假场景 */
export interface SceneLike extends Disposable {
  /** 画布中心对着的地面点换算成的二三维共用相机；画布还没有尺寸时为 null */
  readCamera(): CameraState | null;
  /** 立即定位；画布还没有尺寸时不动 */
  jumpTo(camera: CameraState): void;
  /** 动画定位，duration 单位毫秒，不传时由场景决定；为 0 时等于 jumpTo */
  flyTo(camera: CameraState, duration: number | undefined): void;
  /** 有没有进行中的定位动画 */
  readonly flying: boolean;
  /** 进行中的定位动画直接到终点 */
  completeFlight(): void;
  /** 进行中的定位动画停在当前位置 */
  cancelFlight(): void;
  savePose(): ScenePose;
  restorePose(pose: ScenePose): void;
  /**
   * 临时拖动的一步（ADR 0080 第 4 节）：指针从 from 移到 to（客户区坐标），转动相机让 from 处的地面点来到 to 下面；
   * 任一点没打到地球时不动
   */
  panBetween(from: ClientPoint, to: ClientPoint): void;
  /** 先模型、再地球；什么都没打到时是 miss（ADR 0024 第 2 条） */
  pick(point: ScreenPoint): PickResult;
  /** 点在地球背面或相机背后时为 null（ADR 0024 第 7 条） */
  project(lngLat: LngLat, height?: number): ScreenPoint | null;
  /** 画布的 CSS 尺寸 */
  size(): { readonly width: number; readonly height: number };
  /** 相机在椭球面以上的高度，单位米 */
  eyeHeight(): number;
  /** 影像图层整体替换：按 ID 增删改，按给出的顺序从下到上叠放 */
  setImagery(imagery: readonly ImageryPlan[]): void;
  /** 地球的底色；null 用场景的默认颜色 */
  setBaseColor(color: string | null): void;
  /**
   * 覆盖物整体替换（ADR 0080 第 1 节）：按图层 ID 增删改；同一个对象不重画，
   * 样式和形状个数都没变时只改坐标
   */
  setOverlays(layers: readonly OverlayLayer[]): void;
  /**
   * 把整理好的索引交给 Cesium，建好后加进场景（ADR 0081 第 3 节），给出让整个瓦片集进入画布的相机；
   * signal 中止时销毁建好的瓦片集、以中止的原因结束
   */
  addTileset(id: string, tileset: PreparedTileset, options: TilesetOptions, signal: AbortSignal): Promise<CameraState>;
  updateTileset(id: string, options: TilesetOptions): void;
  removeTileset(id: string): void;
  /** 钻地观察（ADR 0081 第 6 节）；瓦片集还没加进来时，等加进来再生效 */
  setUnderground(underground: UndergroundView | null): void;
  /**
   * 开始一条路线（ADR 0083 第 3 节）：飞到起点停住，接管相机的拖动、缩放和视场角；之前的路线一并结束。
   * 播放时每帧推进，暂停时拖动转头看四周
   */
  startRoute(path: RoutePath): void;
  /** 回到起点，按当前的播放状态 */
  restartRoute(): void;
  setRoutePlayback(playback: RoutePlayback): void;
  /** 结束路线漫游，恢复视场角和相机控制；back 为 true 时飞回开始前的位置 */
  stopRoute(back: boolean): void;
  setGestures(gestures: SceneGestures): void;
  setCursor(cursor: string | undefined): void;
  /** 让画布获得焦点，按键才能交给工具 */
  focus(): void;
  /** 暂停时停止渲染，恢复时继续 */
  setRendering(active: boolean): void;
  /** 按容器的实际尺寸调整画布 */
  resize(): void;
  on<E extends keyof SceneEvents>(event: E, callback: SceneEvents[E]): Unsubscribe;
}

/** 创建场景；浏览器不支持 WebGL 时抛 WebGLUnavailableError */
export type CreateScene = (container: HTMLElement) => SceneLike;

/** 浏览器不支持 WebGL，或者显卡加速不可用 */
export class WebGLUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super('浏览器不支持 WebGL，三维场景无法创建', options);
    this.name = 'WebGLUnavailableError';
  }
}
