import type { CameraState, ViewKind } from '../camera/camera-model';
import type { Unsubscribe } from '../events';

/** 视图的生命周期（ADR 0022 第 5 条）；还没创建时没有视图对象，即文档里的 idle */
export type ViewState = 'initializing' | 'ready' | 'paused' | 'failed' | 'disposed';

/** [西, 南, 东, 北]，单位是度 */
export type ViewBounds = readonly [west: number, south: number, east: number, north: number];

/** 定位时在画布四周留出的像素，只用于计算，不留在相机上 */
export type ViewPadding =
  | number
  | { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number };

export interface FlyToOptions {
  readonly duration?: number;
}

export interface FitBoundsOptions {
  readonly padding?: ViewPadding;
  readonly maxZoom?: number;
  readonly duration?: number;
}

/** 二三维共用的视图接口：生命周期与程序定位（ADR 0024）；输入、拾取、投影在做交互工具时加入 */
export interface MapView extends Disposable {
  readonly kind: ViewKind;
  readonly state: ViewState;
  /** 可以应用样式时结束；创建失败时以该错误结束，释放时以 AbortError 结束 */
  whenReady(): Promise<void>;
  pause(): void;
  resume(): void;
  /** 只在 ready 时可用：定位应由当前显示的视图发起 */
  flyTo(target: Partial<CameraState>, options?: FlyToOptions): void;
  fitBounds(bounds: ViewBounds, options?: FitBoundsOptions): void;
  on(event: 'statechange', callback: (state: ViewState) => void): Unsubscribe;
}
