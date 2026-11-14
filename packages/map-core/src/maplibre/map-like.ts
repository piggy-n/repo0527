import type {
  LayerSpecification,
  ProjectionSpecification,
  StyleSpecification
} from '@maplibre/maplibre-gl-style-spec';
import type { Geometry } from 'geojson';
import type { CustomLayerInterface, LngLatLike, MapOptions } from 'maplibre-gl';
import type { CameraCause } from '../camera/camera-model';
import type { ViewPadding } from '../view/map-view';
import type { StyleTarget } from './apply-style-command';

export type MapLibreMapOptions = MapOptions;

export interface MapSubscription {
  unsubscribe(): void;
}

export interface MapMoveEventLike {
  // 用户操作引起的移动才带原始的 DOM 事件
  readonly originalEvent?: unknown;
  // jumpTo 等方法的 eventData 会合并进事件
  readonly cause?: unknown;
}

/** 转成工具输入的地图鼠标事件（ADR 0034 第 1 条）；mouseout 是指针离开画布 */
export type MapMouseEventType = 'mousedown' | 'mousemove' | 'mouseup' | 'click' | 'dblclick' | 'mouseout';

export interface MapMouseEventLike {
  // 画布左上角为原点的 CSS 像素
  readonly point: { readonly x: number; readonly y: number };
  readonly originalEvent: MouseEvent;
  /** mousedown 时调用：这次按下不交给拖动平移等手势（ADR 0122） */
  preventDefault(): void;
}

/** 地图的一种手势（拖动平移、双击放大、Shift 框选放大）的开关 */
export interface GestureHandlerLike {
  isEnabled(): boolean;
  enable(): void;
  disable(): void;
}

/** 滚轮缩放：普通鼠标的滚轮和触控板分开调速率（ADR 0053 第 3 节）；漫游期间关掉 */
export interface ScrollZoomLike extends GestureHandlerLike {
  setWheelZoomRate(rate: number): void;
  setZoomRate(rate: number): void;
}

export interface CameraEventData {
  readonly cause: CameraCause;
}

/**
 * MapLibre 相机当前的变换（ADR 0147 第 2 节）：只用三维的视点高度、拾取打到天空、点在地球背面这三项。
 * 6.12 的类型里有，后两项标了 @internal，升级时由契约测试发现变化；换投影时整个换掉，每次现取
 */
export interface CameraTransformLike {
  /** 相机在海平面以上的高度，米 */
  getCameraAltitude(): number;
  /** 相机所在的经纬度：开始漫游时从这里算视点 */
  getCameraLngLat(): { readonly lng: number; readonly lat: number };
  /** 画布上的点打不打得到地面：地平线以上、地球以外的天空打不到 */
  isPointOnMapSurface(point: { readonly x: number; readonly y: number }): boolean;
  /** 地面上的点被地球挡住（在地球背面） */
  isLocationOccluded(lngLat: { readonly lng: number; readonly lat: number }): boolean;
}

/** queryRenderedFeatures 返回的要素：几何是取值时才从瓦片坐标换算的 */
export interface RenderedFeatureLike {
  readonly source: string;
  readonly layer: { readonly id: string };
  readonly properties: Record<string, unknown>;
  readonly geometry: Geometry;
}

/**
 * 瓦片事件里的瓦片：用键区分是哪一张，用状态看引擎没发事件的结果（MapLibre 6.12：栅格瓦片返回 404 时只把状态改成 `errored`，
 * 矢量瓦片的 404 当作空瓦片照常发 `data`；304 时只改成 `loaded`）。状态不在公开的类型里，升级时由适配器的测试和页面上的检查发现变化
 */
export interface TileLike {
  readonly tileID: { readonly key: string | number };
  readonly state?: string;
}

/**
 * 数据源的加载事件（ADR 0158）：dataType 为 source 时带 sourceId，和瓦片有关时带 tile；样式的加载事件 dataType 为 style。
 * 不用事件里的 isSourceLoaded：数据源有一张瓦片失败以后，MapLibre 在下一次开始请求以前一直报 true
 */
export interface SourceDataEventLike {
  readonly dataType: 'source' | 'style';
  readonly sourceId?: string;
  readonly tile?: TileLike;
}

/** 地图的错误事件：数据源上的错误由 MapLibre 转发时带上 sourceId，瓦片的错误还带 tile */
export interface MapErrorEventLike {
  readonly error: Error;
  readonly sourceId?: unknown;
  readonly tile?: TileLike;
}

/** 适配器用到的地图能力；MapLibre 的 Map 满足这个接口（见测试中的类型检查），测试时换成假地图 */
export interface MapLike extends StyleTarget {
  setStyle(style: StyleSpecification, options: { diff: boolean }): void;
  on(type: 'style.load', listener: () => void): MapSubscription;
  /**
   * 数据源上的错误（瓦片、GeoJSON 加载失败）由 MapLibre 转发时带上 sourceId，瓦片的错误还带 tile；瓦片返回 404 时不报错
   * （栅格瓦片只把状态改成 errored，矢量瓦片当空瓦片照常发 data）
   */
  on(type: 'error', listener: (event: MapErrorEventLike) => void): MapSubscription;
  /**
   * 开始加载：带 tile 的是数据源开始请求一张新瓦片，之后跟着 sourcedata、dataabort 或 error；已有瓦片的重新加载不发。
   * 栅格瓦片返回 404（状态改成 errored）、瓦片没有变化（状态改成 loaded）时只改状态，不发事件；矢量瓦片的 404 当空瓦片照常发 data
   */
  on(type: 'dataloading', listener: (event: SourceDataEventLike) => void): MapSubscription;
  /** 数据源的数据到了或变了：带 tile 的是一张瓦片到了 */
  on(type: 'sourcedata', listener: (event: SourceDataEventLike) => void): MapSubscription;
  /** 一张瓦片的请求取消了（移出视野） */
  on(type: 'dataabort', listener: (event: SourceDataEventLike) => void): MapSubscription;
  on(type: 'move', listener: (event: MapMoveEventLike) => void): MapSubscription;
  /** 一次移动开始：用户的手势带原始的 DOM 事件（松手后的惯性在松手时算一次）；之后的每一帧只有 move */
  on(type: 'movestart', listener: (event: MapMoveEventLike) => void): MapSubscription;
  /** 一次移动结束：动画到达终点、被新的移动或用户的操作打断时；没有动画的移动同步发出 */
  on(type: 'moveend', listener: (event: MapMoveEventLike) => void): MapSubscription;
  /** 容器尺寸变化、画布重新调整之后 */
  on(type: 'resize', listener: () => void): MapSubscription;
  /** 没有相机动画和过渡、请求的瓦片都已加载并画出之后；每次进入这种状态触发一次 */
  on(type: 'idle', listener: () => void): MapSubscription;
  on(type: MapMouseEventType, listener: (event: MapMouseEventLike) => void): MapSubscription;
  /** 画完一帧；GL 上下文丢失、恢复（ADR 0147 第 2 节，三维模型层用） */
  on(type: 'render' | 'webglcontextlost' | 'webglcontextrestored', listener: () => void): MapSubscription;
  /** 按容器现在的尺寸调整画布，同步发出 resize；平时由 MapLibre 自己的尺寸监听在下一帧调用 */
  resize(): void;
  getCenter(): { readonly lng: number; readonly lat: number };
  getZoom(): number;
  getBearing(): number;
  getPitch(): number;
  /** elevation 是中心点的高度（米）：只有漫游的第一人称相机给，那时 centerClampedToGround 关着 */
  jumpTo(
    camera: { center: [number, number]; zoom: number; bearing: number; pitch: number; elevation?: number },
    eventData: CameraEventData
  ): void;
  flyTo(
    camera: {
      center?: [number, number];
      zoom?: number;
      bearing?: number;
      pitch?: number;
      duration?: number;
      offset?: [number, number];
    },
    eventData: CameraEventData
  ): void;
  /** 地球投影下中心不变时代替 flyTo，见 globe-fly.ts */
  easeTo(
    camera: {
      center?: [number, number];
      zoom?: number;
      bearing?: number;
      pitch?: number;
      duration?: number;
      offset?: [number, number];
    },
    eventData: CameraEventData
  ): void;
  /** 视野按屏幕像素移动（地图内容反向移动）；animate 为 false 时同步到位，和 jumpTo 一样发出 movestart、move */
  panBy(offset: [number, number], options: { animate: false }, eventData: CameraEventData): void;
  fitBounds(
    bounds: [number, number, number, number],
    options: { padding?: ViewPadding; maxZoom?: number; duration?: number; linear?: boolean },
    eventData: CameraEventData
  ): void;
  /** fitBounds 会到的相机；放不下时没有 */
  cameraForBounds(
    bounds: [number, number, number, number],
    options: { padding?: ViewPadding; maxZoom?: number }
  ): { readonly center?: LngLatLike; readonly zoom?: number } | undefined;
  unproject(point: [number, number]): { readonly lng: number; readonly lat: number };
  /** 点或矩形（两个对角点）里画出的要素，从上到下；layers 只能是地图上有的图层 */
  queryRenderedFeatures(
    geometry: [number, number] | [[number, number], [number, number]],
    options: { layers: string[] }
  ): readonly RenderedFeatureLike[];
  project(lngLat: [number, number]): { readonly x: number; readonly y: number };
  /** 光标写在画布上 */
  getCanvas(): HTMLCanvasElement;
  /** 地图获得焦点时的按键从这里监听 */
  getCanvasContainer(): HTMLElement;
  readonly dragPan: GestureHandlerLike;
  readonly doubleClickZoom: GestureHandlerLike;
  readonly boxZoom: GestureHandlerLike;
  readonly scrollZoom: ScrollZoomLike;
  /** 下面四种手势只在漫游期间关掉（ADR 0147 第 4 节），工具不声明 */
  readonly dragRotate: GestureHandlerLike;
  readonly keyboard: GestureHandlerLike;
  readonly touchZoomRotate: GestureHandlerLike;
  readonly touchPitch: GestureHandlerLike;
  /** 样式命令加普通图层；三维模型层（custom layer）只由适配器加上（ADR 0147 第 5 节） */
  addLayer(layer: LayerSpecification | CustomLayerInterface, beforeId?: string): void;
  getLayer(id: string): unknown;
  /** 不给 beforeId 时挪到最上面 */
  moveLayer(id: string, beforeId?: string): void;
  /** 图层 ID，从下到上 */
  getLayersOrder(): string[];
  /** 请求重画下一帧：三维内容自己变了（瓦片到了）时用 */
  triggerRepaint(): void;
  /** 投影；同时担任二三维的视图切换种类时设置（ADR 0147 第 2 节）。样式加载完成之前调用会抛错 */
  getProjection(): ProjectionSpecification | undefined;
  setProjection(projection: ProjectionSpecification): void;
  getMaxPitch(): number;
  /** 当前俯角超过新的上限时 MapLibre 自己收回并发出不带 eventData 的 move，所以先把相机放到上限以内再调用 */
  setMaxPitch(maxPitch: number): void;
  /** 漫游期间放宽到 24 级（ADR 0147 第 5 节），结束时还原；同样先把相机放到上限以内再收紧 */
  getMaxZoom(): number;
  setMaxZoom(maxZoom: number): void;
  /** 竖直视场角（度）：漫游时 60°，结束时还原 */
  getVerticalFieldOfView(): number;
  setVerticalFieldOfView(fov: number, eventData: CameraEventData): void;
  /** 中心点的高度夹到地面：漫游时关掉，第一人称的目标点不在地面上（PoC 的坑 3） */
  getCenterClampedToGround(): boolean;
  setCenterClampedToGround(clamped: boolean): void;
  readonly _camera: { readonly transform: CameraTransformLike };
  remove(): void;
}
