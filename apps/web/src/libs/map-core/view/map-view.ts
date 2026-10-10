import type { CameraState, ViewKind } from '../camera/camera-model';
import type { Unsubscribe } from '../events';
import type { LngLat, PickResult, ScreenPoint } from './view-input';

/** 视图的生命周期（ADR 0022 第 5 条、ADR 0026）；还没创建时没有视图对象，即文档里的 idle；样式加载失败的 failed 在样式出现新版本时自动恢复 */
export type ViewState = 'initializing' | 'ready' | 'paused' | 'failed' | 'disposed';

/**
 * 视图失败的原因（ADR 0030）：引擎失败不能恢复，只能释放后重新创建视图；样式失败在样式出现新版本时自动恢复。
 * webgl-unavailable 表示浏览器不支持 WebGL2 或显卡加速不可用
 */
export type MapViewFailure =
  | { readonly kind: 'engine'; readonly cause: 'webgl-unavailable' | 'unknown'; readonly error: unknown }
  | { readonly kind: 'style'; readonly error: unknown };

/** [西, 南, 东, 北]，单位是度 */
export type ViewBounds = readonly [west: number, south: number, east: number, north: number];

/** 定位时在画布四周留出的像素，只用于计算，不留在相机上 */
export type ViewPadding =
  | number
  | { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number };

export interface FlyToOptions {
  readonly duration?: number;
  /** 把目标中心放在去掉四边留白后的区域中央，只用于这一次定位，不留在相机上；没给中心时不起作用 */
  readonly padding?: ViewPadding;
}

export interface FitBoundsOptions {
  readonly padding?: ViewPadding;
  readonly maxZoom?: number;
  readonly duration?: number;
  /** 定位结束时的俯角；不传时保持当前俯角。旋转总是归零 */
  readonly pitch?: number;
}

/** 二三维共用的视图接口：生命周期、程序定位、拾取与投影（ADR 0024）；输入由视图交给会话的工具模型（ADR 0034） */
export interface MapView extends Disposable {
  readonly kind: ViewKind;
  readonly state: ViewState;
  /** 只在 failed 状态下有值 */
  readonly failure: MapViewFailure | null;
  /**
   * 当前这一轮整体加载的结果（创建地图、整体重建、重新加载各算一轮）：加载完成后结束（视图进入 ready，暂停时为 paused），
   * 失败时以原因结束，释放时以 AbortError 结束；上一轮已有结果时，新一轮换成新的 Promise
   */
  whenReady(): Promise<void>;
  pause(): void;
  resume(): void;
  /** 只在 ready 时可用：定位应由当前显示的视图发起 */
  flyTo(target: Partial<CameraState>, options?: FlyToOptions): void;
  fitBounds(bounds: ViewBounds, options?: FitBoundsOptions): void;
  /** 只在 ready 时可用：屏幕上的点打到哪个表面的哪个位置（ADR 0024 第 2 条） */
  pick(point: ScreenPoint): PickResult;
  /** 只在 ready 时可用：经纬度在屏幕上的位置；三维中点在相机背后时为 null（ADR 0024 第 7 条） */
  project(lngLat: LngLat, height?: number): ScreenPoint | null;
  /** 状态或失败原因变化时触发 */
  on(event: 'statechange', callback: (state: ViewState) => void): Unsubscribe;
  /** 画布尺寸变化：相机不变，屏幕上的投影变了，按屏幕位置摆放的浮层要重新投影 */
  on(event: 'resize', callback: () => void): Unsubscribe;
}
