/** 画布左上角为原点的 CSS 像素 */
export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

/** [经度, 纬度]，单位是度 */
export type LngLat = readonly [lng: number, lat: number];

/** 拾取命中的表面（ADR 0024 第 2 条）：打到三维模型是 model，否则是地图表面 map；ellipsoid、terrain 现在没有视图给出 */
export type PickSurface = 'map' | 'ellipsoid' | 'terrain' | 'model';

/** 拾取的结果；什么都没打到时是 miss，不悄悄退回到别的表面。高度的单位是米，以椭球面为基准 */
export type PickResult =
  | { readonly kind: 'miss' }
  | { readonly kind: 'hit'; readonly surface: PickSurface; readonly lngLat: LngLat; readonly height?: number };

/** 拾取的选项 */
export interface PickOptions {
  /**
   * 悬停：每帧都会调用的拾取（状态栏的读数、绘制和逐点编辑跟着鼠标的预览），跳过代价大的表面：高斯泼溅（ADR 0149）的射线拾取
   * 每次可能几十毫秒，打到泼溅的地方按后面的模型或地面算。点击的落点、测量、坐标定位、点选不写；没有泼溅的引擎忽略它
   */
  readonly hover?: boolean;
  /**
   * 只打地面：跳过三维模型和泼溅（ADR 0157）。资源的点/框选用它取框和容差框的四角，模型永远不是识别的结果；
   * 二维、没有模型的引擎忽略它
   */
  readonly ground?: boolean;
}

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
