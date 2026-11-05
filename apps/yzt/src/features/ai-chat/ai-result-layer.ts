import type { ExpressionSpecification, LayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import { bbox } from '@turf/bbox';
import type { FeatureCollection } from 'geojson';
import type { StyleGroup, ViewBounds } from '@yzt/map-core';

/** 分组名：AI 回答里的 GeoJSON，放在底图之上、注记之下 */
export const AI_RESULT_GROUP = 'ai-result';

const SOURCE = AI_RESULT_GROUP;

// 沿用旧项目的红色描边、面的外发光和白边圆点；地图样式里的颜色是数据，不走 CSS 令牌
const COLOR = '#ff0000';

const POLYGONS: ExpressionSpecification = ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false];
// 面的描边和线
const OUTLINES: ExpressionSpecification = ['match', ['geometry-type'], ['Point', 'MultiPoint'], false, true];
const POINTS: ExpressionSpecification = ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false];
const LINE_LAYOUT = { 'line-join': 'round', 'line-cap': 'round' } as const;

const LAYERS: LayerSpecification[] = [
  {
    id: `${AI_RESULT_GROUP}-glow`,
    type: 'line',
    source: SOURCE,
    filter: POLYGONS,
    layout: LINE_LAYOUT,
    paint: { 'line-color': COLOR, 'line-width': 8, 'line-opacity': 0.8, 'line-blur': 5 }
  },
  {
    id: `${AI_RESULT_GROUP}-line`,
    type: 'line',
    source: SOURCE,
    filter: OUTLINES,
    layout: LINE_LAYOUT,
    paint: { 'line-color': COLOR, 'line-width': 2, 'line-opacity': 0.8 }
  },
  {
    id: `${AI_RESULT_GROUP}-circle`,
    type: 'circle',
    source: SOURCE,
    filter: POINTS,
    paint: { 'circle-color': COLOR, 'circle-radius': 5, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 }
  }
];

/** 推导 ai-result 分组：没有 GeoJSON 时是空分组；数据直接引用回答的结果，每次回答都是新对象（ADR 0022） */
export function aiResultGroup(geojson: FeatureCollection | null): StyleGroup {
  if (!geojson) {
    return { sources: {}, layers: [] };
  }
  return { sources: { [SOURCE]: { type: 'geojson', data: geojson } }, layers: LAYERS };
}

/** 结果的范围；坐标里没有有限的数时为 null */
export function resultBounds(geojson: FeatureCollection): ViewBounds | null {
  const [west, south, east, north] = bbox(geojson, { recompute: true });
  return [west, south, east, north].every(Number.isFinite) ? [west, south, east, north] : null;
}
