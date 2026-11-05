import type { Geometry } from 'geojson';
import type { ScreenPoint } from './view-input';

/** 屏幕上的矩形：两个对角点，顺序不限 */
export interface ScreenBox {
  readonly from: ScreenPoint;
  readonly to: ScreenPoint;
}

export interface RenderedQueryOptions {
  /** 只查这些数据源的图层 */
  readonly sources: readonly string[];
  /** 要渲染用的几何时传 true：换算成经纬度有开销，只要属性时不取 */
  readonly withGeometry?: boolean;
}

/** 画出来的要素（ADR 0047 第 4 节）：属性由调用方收窄；几何是渲染用的，可能被瓦片切开，只用于排序和距离 */
export interface RenderedFeature {
  readonly sourceId: string;
  readonly layerId: string;
  readonly properties: Readonly<Record<string, unknown>>;
  /** 只在 withGeometry 时有 */
  readonly geometry?: Geometry;
}
