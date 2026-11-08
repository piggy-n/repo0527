import type { Point3 } from '../../scene/nav/nav-frame';
import type { ScreenPoint } from '../../view/view-input';
import type { RoamEye } from './roam-camera';

/**
 * 步行、路线漫游的控制器对引擎的要求（ADR 0147 第 4 节）：全部是真实的坐标（地心坐标，真实的椭球高），
 * 抬高只在实现里加减。现在由 MapLibre 的漫游实现，以后第一人称改成独立画布时只换这一个实现
 */
export interface RoamHost {
  /** 拦键鼠、放黑幕的容器 */
  readonly container: HTMLElement;
  /** 画布：光标、画布坐标 */
  readonly canvas: HTMLElement;
  /** 设相机：真实的视点，fovy 是竖直视场角（弧度） */
  setEye(eye: RoamEye, fovy: number): void;
  /** 画布上的点打到的模型表面（地心坐标），跳过半透明的；没打到为 null */
  pick(point: ScreenPoint): Point3 | null;
  /** 地心坐标的点投影到画布；看不到时为 null */
  project(point: Point3): ScreenPoint | null;
  /** 下一帧之前调用一次控制器的 tick */
  requestFrame(): void;
  /** 点击移动的落点光环（脚下地板的地心坐标）；null 淡出 */
  setMarker(position: Point3 | null): void;
}
