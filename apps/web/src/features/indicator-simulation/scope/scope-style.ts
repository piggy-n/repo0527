import type {
  FilterSpecification,
  LayerSpecification,
  SourceSpecification
} from '@maplibre/maplibre-gl-style-spec';
import type { StyleGroup } from '@yzt/map-core';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import type { RegionCover } from '@/shared/map/area/area-coverage';
import {
  AREA_CASING_COLOR,
  AREA_COLOR,
  COVER_FULL_COLOR,
  COVER_PARTIAL_COLOR,
  DISTRICT_EDGE_COLOR,
  HIGHLIGHT_COLOR
} from '../map/colors';

// 范围弹窗的两个分组（ADR 0121）：scope-cover 在注记之下，scope-area 在边界之上

export const COVER_GROUP = 'scope-cover';
export const AREA_GROUP = 'scope-area';

const EMPTY: StyleGroup = Object.freeze({ sources: Object.freeze({}), layers: Object.freeze([]) });
// fill 图层只给面（MapLibre 会把线也当成环填充）
const POLYGONS: FilterSpecification = ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false];

type Polygonal = Polygon | MultiPolygon;
const feature = <P>(geometry: Polygonal, properties: P): Feature<Polygonal, P> => ({
  type: 'Feature',
  geometry,
  properties
});

/** 全省区县的分界线：弹窗打开时铺在底图上，看得出范围压在哪些区县上 */
export const districtEdges = (geometries: readonly Polygonal[]): FeatureCollection<Polygonal> => ({
  type: 'FeatureCollection',
  features: geometries.map(geometry => feature(geometry, {}))
});

/** 覆盖的区县在范围内的部分，按全部、部分覆盖着色 */
export const coverPieces = (
  covers: readonly RegionCover[]
): FeatureCollection<Polygonal, { readonly full: boolean }> => ({
  type: 'FeatureCollection',
  features: covers.map(cover => feature(cover.geometry, { full: cover.relation === 'full' }))
});

/** scope-cover：区县的分界线和覆盖的部分；弹窗关着时为空 */
export function coverGroup(
  edges: FeatureCollection<Polygonal> | null,
  pieces: FeatureCollection<Polygonal> | null
): StyleGroup {
  if (!edges) {
    return EMPTY;
  }
  const layers: LayerSpecification[] = [];
  if (pieces) {
    layers.push({
      id: `${COVER_GROUP}-fill`,
      type: 'fill',
      source: `${COVER_GROUP}-pieces`,
      filter: POLYGONS,
      paint: {
        'fill-color': ['case', ['get', 'full'], COVER_FULL_COLOR, COVER_PARTIAL_COLOR],
        'fill-opacity': 0.55
      }
    });
  }
  layers.push({
    id: `${COVER_GROUP}-edge`,
    type: 'line',
    source: `${COVER_GROUP}-edges`,
    paint: { 'line-color': DISTRICT_EDGE_COLOR, 'line-width': 0.8, 'line-opacity': 0.7 }
  });
  return {
    sources: {
      [`${COVER_GROUP}-edges`]: { type: 'geojson', data: edges },
      ...(pieces && { [`${COVER_GROUP}-pieces`]: { type: 'geojson', data: pieces } })
    },
    layers
  };
}

/** scope-area：范围（浅填充、主色边线）和悬停的区县（深色边线）；都没有时为空 */
export function areaGroup(area: MultiPolygon | null, hovered: Polygonal | null): StyleGroup {
  if (!area && !hovered) {
    return EMPTY;
  }
  const layers: LayerSpecification[] = [];
  const sources: Record<string, SourceSpecification> = {};
  if (area) {
    sources[`${AREA_GROUP}-shape`] = { type: 'geojson', data: area };
    layers.push(
      {
        id: `${AREA_GROUP}-fill`,
        type: 'fill',
        source: `${AREA_GROUP}-shape`,
        filter: POLYGONS,
        paint: { 'fill-color': AREA_COLOR, 'fill-opacity': 0.06 }
      },
      // 白色衬底：和颜色相近的省界、市界分得开
      {
        id: `${AREA_GROUP}-casing`,
        type: 'line',
        source: `${AREA_GROUP}-shape`,
        layout: { 'line-join': 'round' },
        paint: { 'line-color': AREA_CASING_COLOR, 'line-width': 5, 'line-opacity': 0.9 }
      },
      {
        id: `${AREA_GROUP}-line`,
        type: 'line',
        source: `${AREA_GROUP}-shape`,
        layout: { 'line-join': 'round' },
        paint: { 'line-color': AREA_COLOR, 'line-width': 2 }
      }
    );
  }
  if (hovered) {
    sources[`${AREA_GROUP}-hover`] = { type: 'geojson', data: hovered };
    layers.push({
      id: `${AREA_GROUP}-hover`,
      type: 'line',
      source: `${AREA_GROUP}-hover`,
      paint: { 'line-color': HIGHLIGHT_COLOR, 'line-width': 2 }
    });
  }
  return { sources, layers };
}
