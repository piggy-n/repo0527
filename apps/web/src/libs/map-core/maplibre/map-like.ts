import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Geometry } from 'geojson';
import type { MapOptions } from 'maplibre-gl';
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
}

/** 地图的一种手势（拖动平移、双击放大、Shift 框选放大）的开关 */
export interface GestureHandlerLike {
  isEnabled(): boolean;
  enable(): void;
  disable(): void;
}

/** 滚轮缩放：普通鼠标的滚轮和触控板分开调速率（ADR 0053 第 3 节） */
export interface ScrollZoomLike {
  setWheelZoomRate(rate: number): void;
  setZoomRate(rate: number): void;
}

export interface CameraEventData {
  readonly cause: CameraCause;
}

/** queryRenderedFeatures 返回的要素：几何是取值时才从瓦片坐标换算的 */
export interface RenderedFeatureLike {
  readonly source: string;
  readonly layer: { readonly id: string };
  readonly properties: Record<string, unknown>;
  readonly geometry: Geometry;
}

/** 适配器用到的地图能力；MapLibre 的 Map 满足这个接口（见测试中的类型检查），测试时换成假地图 */
export interface MapLike extends StyleTarget {
  setStyle(style: StyleSpecification, options: { diff: boolean }): void;
  on(type: 'style.load', listener: () => void): MapSubscription;
  /** 数据源上的错误（瓦片、GeoJSON 加载失败）由 MapLibre 转发时带上 sourceId；瓦片返回 404 时不报错 */
  on(type: 'error', listener: (event: { readonly error: Error; readonly sourceId?: unknown }) => void): MapSubscription;
  on(type: 'move', listener: (event: MapMoveEventLike) => void): MapSubscription;
  /** 一次移动开始：用户的手势带原始的 DOM 事件（松手后的惯性在松手时算一次）；之后的每一帧只有 move */
  on(type: 'movestart', listener: (event: MapMoveEventLike) => void): MapSubscription;
  /** 容器尺寸变化、画布重新调整之后 */
  on(type: 'resize', listener: () => void): MapSubscription;
  on(type: MapMouseEventType, listener: (event: MapMouseEventLike) => void): MapSubscription;
  getCenter(): { readonly lng: number; readonly lat: number };
  getZoom(): number;
  getBearing(): number;
  getPitch(): number;
  jumpTo(
    camera: { center: [number, number]; zoom: number; bearing: number; pitch: number },
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
  /** 视野按屏幕像素移动（地图内容反向移动）；animate 为 false 时同步到位，和 jumpTo 一样发出 movestart、move */
  panBy(offset: [number, number], options: { animate: false }, eventData: CameraEventData): void;
  fitBounds(
    bounds: [number, number, number, number],
    options: { padding?: ViewPadding; maxZoom?: number; duration?: number },
    eventData: CameraEventData
  ): void;
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
  remove(): void;
}
