import type {
  ExpressionSpecification,
  GeoJSONSourceSpecification,
  LineLayerSpecification
} from '@maplibre/maplibre-gl-style-spec';
import type { StyleGroup } from '@yzt/map-core';
import cityUrl from './data/jiangsu-city.json?url';
import countyUrl from './data/jiangsu-county.json?url';
import provinceUrl from './data/jiangsu-province.json?url';

/** 行政区边界的级别 */
export type BoundaryLevel = 'province' | 'city' | 'county';

/** 边界拥有者的状态：每一级是否显示，三级共用一个透明度（0～1） */
export interface BoundaryState {
  readonly visible: Readonly<Record<BoundaryLevel, boolean>>;
  readonly opacity: number;
}

export interface BoundaryOption {
  readonly id: BoundaryLevel;
  readonly label: string;
}

/** 面板里的顺序 */
export const BOUNDARY_OPTIONS: readonly BoundaryOption[] = [
  { id: 'province', label: '省界' },
  { id: 'city', label: '市界' },
  { id: 'county', label: '县界' }
];

/** 进入页面时只显示省界 */
export const INITIAL_BOUNDARY_STATE: BoundaryState = {
  visible: { province: true, city: false, county: false },
  opacity: 1
};

interface LevelStyle {
  readonly width: ExpressionSpecification;
  /** 各级原有的不透明度，状态里的透明度乘在它上面 */
  readonly opacity: number;
  readonly dasharray?: readonly number[];
}

// 沿用旧项目的样式：颜色相同，靠线宽、不透明度和虚线区分级别；地图样式里的颜色是数据，不走 CSS 令牌
const COLOR = '#597EF7';
const LEVEL_STYLES: Record<BoundaryLevel, LevelStyle> = {
  province: { width: ['interpolate', ['linear'], ['zoom'], 5, 1.8, 9, 2.4, 13, 3.2], opacity: 0.94 },
  city: { width: ['interpolate', ['linear'], ['zoom'], 5, 1.1, 9, 1.6, 13, 2.3], opacity: 0.78 },
  county: {
    width: ['interpolate', ['linear'], ['zoom'], 8, 0.6, 11, 0.95, 14, 1.25],
    opacity: 0.62,
    dasharray: [2.2, 1.6]
  }
};

// 从下到上：省界压在市界、县界上面
const BOTTOM_UP: readonly BoundaryLevel[] = ['county', 'city', 'province'];

// 数据源直接写地址，由 MapLibre 在 Worker 里下载和解析；关闭的级别不放进样式，打开时才下载（ADR 0033）
const SOURCES: Record<BoundaryLevel, GeoJSONSourceSpecification> = {
  province: { type: 'geojson', data: provinceUrl },
  city: { type: 'geojson', data: cityUrl },
  county: { type: 'geojson', data: countyUrl }
};

const layerId = (level: BoundaryLevel) => `boundaries-${level}`;

function lineLayer(level: BoundaryLevel, opacity: number): LineLayerSpecification {
  const { width, opacity: base, dasharray } = LEVEL_STYLES[level];
  return {
    id: layerId(level),
    type: 'line',
    source: layerId(level),
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': COLOR,
      'line-width': width,
      'line-opacity': base * opacity,
      ...(dasharray ? { 'line-dasharray': [...dasharray] } : {})
    }
  };
}

/** 推导 boundaries 分组：每个打开的级别一个数据源和一条线 */
export function boundaryGroup({ visible, opacity }: BoundaryState): StyleGroup {
  const levels = BOTTOM_UP.filter(level => visible[level]);
  return {
    sources: Object.fromEntries(levels.map(level => [layerId(level), SOURCES[level]])),
    layers: levels.map(level => lineLayer(level, opacity))
  };
}
