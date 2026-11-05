import type { LayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { FeatureCollection } from 'geojson';
import type { StyleGroup } from '@yzt/map-core';
import type { RegionBoundary } from './region-geometry';

const SOURCE = 'region';

// 沿用旧项目区划定位的高亮：红色光晕加实线；地图样式里的颜色是数据，不走 CSS 令牌
const HIGHLIGHT_COLOR = '#FF0000';

const LAYOUT = { 'line-join': 'round', 'line-cap': 'round' } as const;

// 光晕在下，实线在上
const LAYERS: readonly LayerSpecification[] = [
  {
    id: 'region-glow',
    type: 'line',
    source: SOURCE,
    layout: LAYOUT,
    paint: { 'line-color': HIGHLIGHT_COLOR, 'line-width': 8, 'line-blur': 5, 'line-opacity': 0.8 }
  },
  {
    id: 'region-line',
    type: 'line',
    source: SOURCE,
    layout: LAYOUT,
    paint: { 'line-color': HIGHLIGHT_COLOR, 'line-width': 2, 'line-opacity': 0.9 }
  }
];

/** 推导 region 分组（ADR 0036）：高亮选中区划的边界；没有边界（全省、加载中、失败）时是空分组 */
export function regionGroup(boundary: RegionBoundary | null): StyleGroup {
  if (!boundary) {
    return { sources: {}, layers: [] };
  }
  // 交给会话的 GeoJSON 每次换新对象（ADR 0022）
  const data: FeatureCollection = {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: { code: boundary.code }, geometry: boundary.geometry }]
  };
  return { sources: { [SOURCE]: { type: 'geojson', data } }, layers: LAYERS };
}
