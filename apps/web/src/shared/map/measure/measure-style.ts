import type { LayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Feature, FeatureCollection, Geometry, Position } from 'geojson';
import type { LngLat, MeasureState, StyleGroup } from '@yzt/map-core';

const SOURCE = 'measure';

// 沿用旧项目的绘制样式：完成的实线、画的过程中是虚线；地图样式里的颜色是数据，不走 CSS 令牌
const COMPLETED_COLOR = '#597EF7';
const DRAWING_COLOR = '#3B82F6';
const LINE_WIDTH = 3;

// 从下到上：填充、完成的线、画的过程中的虚线、节点
const LAYERS: readonly LayerSpecification[] = [
  {
    id: 'measure-fill-completed',
    type: 'fill',
    source: SOURCE,
    filter: ['==', ['get', 'status'], 'completed'],
    paint: { 'fill-color': DRAWING_COLOR, 'fill-opacity': 0.2 }
  },
  {
    id: 'measure-fill-drawing',
    type: 'fill',
    source: SOURCE,
    filter: ['==', ['get', 'status'], 'drawing'],
    paint: { 'fill-color': DRAWING_COLOR, 'fill-opacity': 0.12 }
  },
  {
    id: 'measure-line-completed',
    type: 'line',
    source: SOURCE,
    filter: ['==', ['get', 'status'], 'completed'],
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': COMPLETED_COLOR, 'line-width': LINE_WIDTH }
  },
  {
    id: 'measure-line-drawing',
    type: 'line',
    source: SOURCE,
    filter: ['==', ['get', 'status'], 'drawing'],
    paint: { 'line-color': DRAWING_COLOR, 'line-width': LINE_WIDTH, 'line-dasharray': [2, 2] }
  },
  {
    id: 'measure-vertex',
    type: 'circle',
    source: SOURCE,
    filter: ['==', ['get', 'status'], 'vertex'],
    paint: {
      'circle-radius': 3,
      'circle-color': COMPLETED_COLOR,
      'circle-stroke-color': '#FFFFFF',
      'circle-stroke-width': 2
    }
  }
];

type Status = 'completed' | 'drawing' | 'vertex';

function feature(geometry: Geometry, status: Status): Feature {
  return { type: 'Feature', properties: { status }, geometry };
}

// 测距是线；测面不少于三个点时是面（闭合），点不够时退化成线
function shape(kind: 'distance' | 'area', points: readonly LngLat[], status: Status): Feature | null {
  const coordinates: Position[] = points.map(([lng, lat]) => [lng, lat]);
  if (coordinates.length < 2) {
    return null;
  }
  if (kind === 'area' && coordinates.length >= 3) {
    return feature({ type: 'Polygon', coordinates: [[...coordinates, coordinates[0]]] }, status);
  }
  return feature({ type: 'LineString', coordinates }, status);
}

function vertices(points: readonly LngLat[]): Feature[] {
  return points.map(([lng, lat]) => feature({ type: 'Point', coordinates: [lng, lat] }, 'vertex'));
}

/** 推导 measure 分组（ADR 0035）：完成的测量、正在画的那一条（连同预览点）和所有节点；没有测量时是空分组 */
export function measureGroup({ measurements, draft }: MeasureState): StyleGroup {
  if (measurements.length === 0 && !draft) {
    return { sources: {}, layers: [] };
  }
  const features: Feature[] = [];
  for (const { kind, points } of measurements) {
    const completed = shape(kind, points, 'completed');
    if (completed) {
      features.push(completed);
    }
    features.push(...vertices(points));
  }
  if (draft) {
    // 预览点只出现在线和面里，不画节点
    const drawing = shape(draft.kind, draft.preview ? [...draft.points, draft.preview] : draft.points, 'drawing');
    if (drawing) {
      features.push(drawing);
    }
    features.push(...vertices(draft.points));
  }
  // 交给会话的 GeoJSON 每次换新对象（ADR 0022）
  const data: FeatureCollection = { type: 'FeatureCollection', features };
  return { sources: { [SOURCE]: { type: 'geojson', data } }, layers: LAYERS };
}
