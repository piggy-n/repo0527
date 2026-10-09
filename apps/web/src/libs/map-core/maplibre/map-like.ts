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

export interface CameraEventData {
  readonly cause: CameraCause;
}

/** 适配器用到的地图能力；MapLibre 的 Map 满足这个接口（见测试中的类型检查），测试时换成假地图 */
export interface MapLike extends StyleTarget {
  setStyle(style: StyleSpecification, options: { diff: boolean }): void;
  on(type: 'style.load', listener: () => void): MapSubscription;
  on(type: 'error', listener: (event: { readonly error: Error }) => void): MapSubscription;
  on(type: 'move', listener: (event: MapMoveEventLike) => void): MapSubscription;
  getCenter(): { readonly lng: number; readonly lat: number };
  getZoom(): number;
  getBearing(): number;
  getPitch(): number;
  jumpTo(
    camera: { center: [number, number]; zoom: number; bearing: number; pitch: number },
    eventData: CameraEventData
  ): void;
  flyTo(
    camera: { center?: [number, number]; zoom?: number; bearing?: number; pitch?: number; duration?: number },
    eventData: CameraEventData
  ): void;
  fitBounds(
    bounds: [number, number, number, number],
    options: { padding?: ViewPadding; maxZoom?: number; duration?: number },
    eventData: CameraEventData
  ): void;
  remove(): void;
}
