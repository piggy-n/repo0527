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

/** 一级边界由几条线叠成：色带、白边在下，核心线在上 */
type LinePart = 'band' | 'casing' | 'line';

interface LineStyle {
  readonly part: LinePart;
  readonly color: string;
  /** 线宽的几档：[级别, 线宽]，地图上按级别线性插值，面板的线型示意取中间一档 */
  readonly widths: readonly (readonly [zoom: number, width: number])[];
  /** 原有的不透明度，状态里的透明度乘在它上面 */
  readonly opacity: number;
  /** 边缘虚化的宽度（像素） */
  readonly blur?: number;
  /** 虚线的线段和间隔，单位是线宽 */
  readonly dasharray?: readonly number[];
}

// 线型（ADR 0057）：省界加主色色带、核心线更深，市界细实线，县界虚线；省界、市界下面的白边让影像底图上的线更清楚。
// 省、市都是实线，共用的边上一级盖住下一级；地图样式里的颜色是数据，不走 CSS 令牌
const BLUE = '#597EF7';
const DEEP_BLUE = '#2F54EB';
const WHITE = '#FFFFFF';
const LEVEL_STYLES: Record<BoundaryLevel, readonly LineStyle[]> = {
  province: [
    { part: 'band', color: BLUE, widths: [[5, 7], [9, 10], [13, 16]], opacity: 0.22, blur: 1 },
    { part: 'casing', color: WHITE, widths: [[5, 3.4], [9, 4.4], [13, 5.6]], opacity: 0.7 },
    { part: 'line', color: DEEP_BLUE, widths: [[5, 1.8], [9, 2.4], [13, 3.2]], opacity: 1 }
  ],
  city: [
    { part: 'casing', color: WHITE, widths: [[5, 2.4], [9, 3.2], [13, 4]], opacity: 0.6 },
    { part: 'line', color: BLUE, widths: [[5, 1], [9, 1.4], [13, 2]], opacity: 0.95 }
  ],
  county: [{ part: 'line', color: BLUE, widths: [[8, 0.8], [11, 1.1], [14, 1.4]], opacity: 0.8, dasharray: [3, 2] }]
};

/** 面板线型示意里的一条线（从下到上）：和地图上同色、同样的不透明度和虚线，线宽取中间一档 */
export interface BoundarySwatchLine {
  readonly color: string;
  readonly width: number;
  readonly opacity: number;
  readonly dasharray?: readonly number[];
}

/** 面板里一级边界的线型示意；色带的虚化只有 1 像素，示意里不画 */
export function boundarySwatch(level: BoundaryLevel): readonly BoundarySwatchLine[] {
  return LEVEL_STYLES[level].map(({ color, widths, opacity, dasharray }) => {
    const [, width] = widths[Math.floor(widths.length / 2)];
    return { color, width, opacity, ...(dasharray ? { dasharray } : {}) };
  });
}

// 从下到上：省界压在市界、县界上面
const BOTTOM_UP: readonly BoundaryLevel[] = ['county', 'city', 'province'];

// 数据源直接写地址，由 MapLibre 在 Worker 里下载和解析；关闭的级别不放进样式，打开时才下载（ADR 0033）
const SOURCES: Record<BoundaryLevel, GeoJSONSourceSpecification> = {
  province: { type: 'geojson', data: provinceUrl },
  city: { type: 'geojson', data: cityUrl },
  county: { type: 'geojson', data: countyUrl }
};

const sourceId = (level: BoundaryLevel) => `boundaries-${level}`;

// 核心线的 ID 就是 boundaries-province 等，色带、白边在后面加上部位
const layerId = (level: BoundaryLevel, part: LinePart) =>
  part === 'line' ? sourceId(level) : `${sourceId(level)}-${part}`;

function lineLayer(level: BoundaryLevel, style: LineStyle, opacity: number): LineLayerSpecification {
  const { part, color, widths, opacity: base, blur, dasharray } = style;
  const width: ExpressionSpecification = ['interpolate', ['linear'], ['zoom'], ...widths.flat()];
  return {
    id: layerId(level, part),
    type: 'line',
    source: sourceId(level),
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': color,
      'line-width': width,
      'line-opacity': base * opacity,
      ...(blur ? { 'line-blur': blur } : {}),
      ...(dasharray ? { 'line-dasharray': [...dasharray] } : {})
    }
  };
}

/** 推导 boundaries 分组：每个打开的级别一个数据源和几条线 */
export function boundaryGroup({ visible, opacity }: BoundaryState): StyleGroup {
  const levels = BOTTOM_UP.filter(level => visible[level]);
  return {
    sources: Object.fromEntries(levels.map(level => [sourceId(level), SOURCES[level]])),
    layers: levels.flatMap(level => LEVEL_STYLES[level].map(style => lineLayer(level, style, opacity)))
  };
}
