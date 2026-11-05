import type {
  FilterSpecification,
  LayerSpecification,
  SourceSpecification
} from '@maplibre/maplibre-gl-style-spec';
import type { StyleGroup } from '@mx/map-core';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import type { RegionCover } from '@/shared/map/area/area-coverage';
import { clipMask } from '@/shared/map/region/region-clip';
import {
  AREA_CASING_COLOR,
  AREA_COLOR,
  AREA_MASK_COLOR,
  COVER_FULL_COLOR,
  COVER_PARTIAL_COLOR,
  DISTRICT_EDGE_COLOR
} from '../map/colors';

// 范围弹窗的两个分组（ADR 0121、0131）：scope-cover 在注记之下，scope-area 在边界之上

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
    paint: { 'line-color': DISTRICT_EDGE_COLOR, 'line-width': 0.8, 'line-opacity': 0.55 }
  });
  return {
    sources: {
      [`${COVER_GROUP}-edges`]: { type: 'geojson', data: edges },
      ...(pieces && { [`${COVER_GROUP}-pieces`]: { type: 'geojson', data: pieces } })
    },
    layers
  };
}

/** 地图上的范围：它本身和范围以外的遮罩 */
export interface AreaShape {
  readonly geometry: MultiPolygon;
  readonly mask: MultiPolygon;
}

/** 算好遮罩：节点多时不便宜，由拥有者随范围缓存，悬停时不重算 */
export const areaShape = (geometry: MultiPolygon): AreaShape => ({ geometry, mask: clipMask(geometry) });

// 白色衬底上的主色边线：和颜色相近的省界、市界分得开
const outlined = (id: string, source: string, width: number): LayerSpecification[] => [
  {
    id: `${id}-casing`,
    type: 'line',
    source,
    layout: { 'line-join': 'round' },
    paint: { 'line-color': AREA_CASING_COLOR, 'line-width': width + 3, 'line-opacity': 0.9 }
  },
  {
    id: `${id}-line`,
    type: 'line',
    source,
    layout: { 'line-join': 'round' },
    paint: { 'line-color': AREA_COLOR, 'line-width': width }
  }
];

/** scope-area：范围（外面压暗、深色边线）和悬停的区县在范围内的部分（填充和边线）；都没有时为空 */
export function areaGroup(area: AreaShape | null, hovered: Polygonal | null): StyleGroup {
  if (!area && !hovered) {
    return EMPTY;
  }
  const layers: LayerSpecification[] = [];
  const sources: Record<string, SourceSpecification> = {};
  if (area) {
    sources[`${AREA_GROUP}-mask`] = { type: 'geojson', data: area.mask };
    sources[`${AREA_GROUP}-shape`] = { type: 'geojson', data: area.geometry };
    layers.push(
      {
        id: `${AREA_GROUP}-mask`,
        type: 'fill',
        source: `${AREA_GROUP}-mask`,
        filter: POLYGONS,
        // 大面积的面关掉抗锯齿，瓦片接缝处不出现细线（同 region-clip）
        paint: { 'fill-color': AREA_MASK_COLOR, 'fill-opacity': 0.16, 'fill-antialias': false }
      },
      ...outlined(AREA_GROUP, `${AREA_GROUP}-shape`, 2.5)
    );
  }
  if (hovered) {
    const id = `${AREA_GROUP}-hover`;
    sources[id] = { type: 'geojson', data: hovered };
    layers.push(
      {
        id: `${id}-fill`,
        type: 'fill',
        source: id,
        filter: POLYGONS,
        // 要压得住下面琥珀色的部分覆盖：太淡时两色混成灰色
        paint: { 'fill-color': AREA_COLOR, 'fill-opacity': 0.6 }
      },
      ...outlined(id, id, 2)
    );
  }
  return { sources, layers };
}
