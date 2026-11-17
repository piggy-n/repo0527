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

/** 场景在相机或尺寸变化时给出的朝向和取样，换算成米由调用方做 */
export interface SceneView {
  /** "北"（形状坐标 +y）相对屏幕上方的顺时针角度（度） */
  readonly north: number;
  /** 画布中心水平线上相距 pixels 个 CSS 像素的两点打到顶面后的形状坐标；打不到顶面时为 null */
  readonly sample: {
    readonly a: readonly [number, number];
    readonly b: readonly [number, number];
    readonly pixels: number;
  } | null;
}

export interface SceneCallbacks {
  onLabels(positions: LabelPosition[]): void;
  onHover(code: string | null): void;
  onCityPointer(code: string | null): void;
  onCityClick(code: string): void;
  onFailure(error: Error): void;
  /** 不传时场景不算朝向和取样 */
  onView?(view: SceneView): void;
}

export type MapValues = Readonly<Record<string, number | null>>;

/** 地图当前的朝向和比例，给指北针、比例尺用 */
export interface MapView {
  /** "北"相对屏幕上方的顺时针角度（度） */
  readonly northDegrees: number;
  /** 画布中心附近一个 CSS 像素代表的米数 */
  readonly metersPerPixel: number;
}

/** 地图右下角叠加插槽的参数 */
export interface MapCornerScope {
  /** 地图当前的朝向和比例；还没算出来时为 null */
  readonly view: MapView | null;
  /** 这个位置能用的宽度（CSS 像素），比例尺按它选长度 */
  readonly maxWidth: number;
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
