import type { FilterSpecification, LayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Feature, Polygon, Position } from 'geojson';
import type { LngLat, StyleGroup } from '@yzt/map-core';
import type { PanKey } from '../pan-key';

/** 绘制范围的两种方式（数据查询的空间查询） */
export type ShapeKind = 'rectangle' | 'polygon';

/** 画完的范围：只保留一个，查询时再整理成发给后端的几何（ADR 0051 第 4 节） */
export interface DrawnShape {
  readonly kind: ShapeKind;
  readonly polygon: Polygon;
  /** 完成时一个屏幕像素对应的经纬度距离，整理几何时用作简化的容差；拾取不到时为 null */
  readonly pixelSize: number | null;
}

/** 正在画的多边形：已确定的节点和跟随鼠标的预览点 */
export interface PolygonDraft {
  readonly points: readonly LngLat[];
  readonly preview: LngLat | null;
}

/** 多边形至少要这么多个节点才能完成 */
export const MIN_POLYGON_POINTS = 3;

/** 节点连成闭合的多边形 */
export function polygonOf(points: readonly LngLat[]): Polygon {
  const ring: Position[] = points.map(([lng, lat]) => [lng, lat]);
  const [first] = ring;
  return { type: 'Polygon', coordinates: [first ? [...ring, first] : ring] };
}

/** 鼠标旁的提示，文案沿用旧页面；关掉拖动平移的框选写出临时拖动的键（ADR 0056） */
export function drawHintLines(kind: ShapeKind, progress: number, { label }: PanKey): readonly string[] {
  if (kind === 'rectangle') {
    return progress > 0
      ? ['拖动调整框选范围，松开鼠标完成绘制']
      : ['按下鼠标左键并拖动，绘制矩形范围', `按住 ${label} 拖动地图，Esc 退出`];
  }
  if (progress === 0) {
    return ['单击绘制首个节点', 'Esc 退出'];
  }
  return progress === 1
    ? ['单击继续绘制第二个节点', 'Esc 取消这次绘制']
    : ['单击继续绘制下一个节点，双击结束绘制', 'Esc 取消这次绘制'];
}

const SOURCE = 'draw';

// 同测量的绘制样式：完成的实线、画的过程中是虚线；地图样式里的颜色是数据，不走 CSS 令牌
const COMPLETED_COLOR = '#597EF7';
const DRAWING_COLOR = '#3B82F6';
const LINE_WIDTH = 2;

type Status = 'completed' | 'drawing' | 'vertex';

const byStatus = (status: Status): FilterSpecification => ['==', ['get', 'status'], status];

// fill 图层会把线也当成环填充，填充只给面
const LAYERS: readonly LayerSpecification[] = [
  {
    id: 'draw-fill',
    type: 'fill',
    source: SOURCE,
    filter: ['all', ['==', ['get', 'status'], 'completed'], ['==', ['geometry-type'], 'Polygon']],
    paint: { 'fill-color': COMPLETED_COLOR, 'fill-opacity': 0.12 }
  },
  {
    id: 'draw-line-completed',
    type: 'line',
    source: SOURCE,
    filter: byStatus('completed'),
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': COMPLETED_COLOR, 'line-width': LINE_WIDTH }
  },
  {
    id: 'draw-line-drawing',
    type: 'line',
    source: SOURCE,
    filter: byStatus('drawing'),
    paint: { 'line-color': DRAWING_COLOR, 'line-width': LINE_WIDTH, 'line-dasharray': [2, 2] }
  },
  {
    id: 'draw-vertex',
    type: 'circle',
    source: SOURCE,
    filter: byStatus('vertex'),
    paint: {
      'circle-radius': 3,
      'circle-color': COMPLETED_COLOR,
      'circle-stroke-color': '#FFFFFF',
      'circle-stroke-width': 2
    }
  }
];

const EMPTY_GROUP: StyleGroup = Object.freeze({ sources: Object.freeze({}), layers: Object.freeze([]) });

// 画的过程中：节点连同预览点是一条线，够三个点时闭合
function draftFeatures({ points, preview }: PolygonDraft): Feature[] {
  const line = preview ? [...points, preview] : points;
  const coordinates: Position[] = line.map(([lng, lat]) => [lng, lat]);
  const [first] = coordinates;
  const path = first && coordinates.length >= MIN_POLYGON_POINTS ? [...coordinates, first] : coordinates;
  const features: Feature[] = points.map(([lng, lat]) => ({
    type: 'Feature',
    properties: { status: 'vertex' },
    geometry: { type: 'Point', coordinates: [lng, lat] }
  }));
  if (path.length >= 2) {
    features.unshift({
      type: 'Feature',
      properties: { status: 'drawing' },
      geometry: { type: 'LineString', coordinates: path }
    });
  }
  return features;
}

/** 绘制的样式分组（分组名 draw）：画完的范围和正在画的多边形；都没有时为空分组 */
export function drawGroup(shape: DrawnShape | null, draft: PolygonDraft | null): StyleGroup {
  const features: Feature[] = [];
  if (shape) {
    features.push({ type: 'Feature', properties: { status: 'completed' }, geometry: shape.polygon });
  }
  if (draft) {
    features.push(...draftFeatures(draft));
  }
  if (features.length === 0) {
    return EMPTY_GROUP;
  }
  return {
    sources: { [SOURCE]: { type: 'geojson', data: { type: 'FeatureCollection', features } } },
    layers: LAYERS
  };
}
