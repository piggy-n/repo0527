import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
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

export interface CameraEventData {
  readonly cause: CameraCause;
}

/** 适配器用到的地图能力；MapLibre 的 Map 满足这个接口（见测试中的类型检查），测试时换成假地图 */
export interface MapLike extends StyleTarget {
  setStyle(style: StyleSpecification, options: { diff: boolean }): void;
  on(type: 'style.load', listener: () => void): MapSubscription;
  on(type: 'error', listener: (event: { readonly error: Error }) => void): MapSubscription;
  on(type: 'move', listener: (event: MapMoveEventLike) => void): MapSubscription;
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
  fitBounds(
    bounds: [number, number, number, number],
    options: { padding?: ViewPadding; maxZoom?: number; duration?: number },
    eventData: CameraEventData
  ): void;
  unproject(point: [number, number]): { readonly lng: number; readonly lat: number };
  project(lngLat: [number, number]): { readonly x: number; readonly y: number };
  /** 光标写在画布上 */
  getCanvas(): HTMLCanvasElement;
  /** 地图获得焦点时的按键从这里监听 */
  getCanvasContainer(): HTMLElement;
  readonly dragPan: GestureHandlerLike;
  readonly doubleClickZoom: GestureHandlerLike;
  readonly boxZoom: GestureHandlerLike;
  remove(): void;
}
