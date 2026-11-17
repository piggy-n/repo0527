import type { Shape, Vector2 } from 'three';
import type { City } from '../model';

/** 场景只接收投影后的形状，不读取 Vue 状态 */
export interface MapRegion extends City {
  readonly shapes: Shape[];
  readonly anchorPoint: Vector2;
}

export interface LabelPosition {
  readonly code: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly offsetX?: number;
  readonly offsetY?: number;
}

export interface MapLabel extends LabelPosition {
  readonly anchorX: number;
  readonly anchorY: number;
  readonly halfWidth: number;
  readonly halfHeight: number;
  readonly connected: boolean;
}

export interface SceneCallbacks {
  onLabels(positions: LabelPosition[]): void;
  onHover(code: string | null): void;
  onCityPointer(code: string | null): void;
  onCityClick(code: string): void;
  onFailure(error: Error): void;
}

export type MapValues = Readonly<Record<string, number | null>>;

/** 地图当前的朝向和比例，给指北针、比例尺用；二维降级时北朝正上方 */
export interface MapView {
  /** "北"相对屏幕上方的顺时针角度（度） */
  readonly northDegrees: number;
  /** 画布中心附近一个 CSS 像素代表的米数 */
  readonly metersPerPixel: number;
}

/** 导出时冻结地图像素、标签位置与数值，字体等待期间不再读取活动场景 */
export interface DashboardMapSnapshot {
  readonly canvas: HTMLCanvasElement;
  readonly labels: readonly MapLabel[];
  readonly values: MapValues;
  readonly simple: boolean;
  readonly labelScale: number;
}

export interface NumberUniform {
  value: number;
}

export interface SweepUniforms {
  uSweepPosition: NumberUniform;
  uSweepStrength: NumberUniform;
}
