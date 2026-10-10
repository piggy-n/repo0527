/** 画布左上角为原点的 CSS 像素 */
export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

/** [经度, 纬度]，单位是度 */
export type LngLat = readonly [lng: number, lat: number];

/** 拾取命中的表面：二维总是 map（地图平面）；三维按模型、地形、椭球的顺序由 map-cesium 决定（ADR 0024 第 2 条） */
export type PickSurface = 'map' | 'ellipsoid' | 'terrain' | 'model';

/** 拾取的结果；什么都没打到时是 miss，不悄悄退回到别的表面。高度的单位是米，以椭球面为基准 */
export type PickResult =
  | { readonly kind: 'miss' }
  | { readonly kind: 'hit'; readonly surface: PickSurface; readonly lngLat: LngLat; readonly height?: number };

export interface Modifiers {
  readonly shift: boolean;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly meta: boolean;
}

/** 指针事件：只带屏幕坐标、按键和修饰键，要经纬度时再调用拾取（ADR 0024 第 8 条） */
export interface MapPointerEvent {
  readonly type: 'down' | 'move' | 'up' | 'click' | 'dblclick' | 'leave';
  readonly point: ScreenPoint;
  /** 0 是左键，2 是右键 */
  readonly button: number;
  /** 连击次数：双击时第二次单击为 2，工具据此忽略它（ADR 0035）；二维取 MouseEvent.detail */
  readonly clickCount: number;
  readonly modifiers: Modifiers;
}

/** 地图获得焦点时的按键 */
export interface MapKeyEvent {
  readonly type: 'key';
  readonly key: string;
}

export type MapInputEvent = MapPointerEvent | MapKeyEvent;
