import type { ExpressionSpecification, LayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Feature, FeatureCollection } from 'geojson';
import type { StyleGroup } from '@yzt/map-core';
import type { QueryRequest, ResultFeatures } from './api';
import type { QueryLayer } from './topics';

/** 选了图层还没查询时的灰色预览（全省、不带条件）；压在注记下面，同旧页面 */
export const PREVIEW_GROUP = 'query-preview';
/** 查询结果：属性类是带条件的 MVT，空间类是命中的要素 */
export const RESULT_GROUP = 'query-result';

/** 全省的行政区划代码：预览、高级查询没写区划时用 */
export const PROVINCE_CODE = '320000';

const POINTS: ExpressionSpecification = ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false];
const POLYGONS: ExpressionSpecification = ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false];

// 地图样式里的颜色是数据，不走 CSS 令牌；预览沿用旧页面的灰色，结果用现状底图点选的高亮色
const PREVIEW_COLOR = '#808080';
const PREVIEW_STROKE = '#C8C8C8';
const RESULT_COLOR = '#F5222D';

const EMPTY_GROUP: StyleGroup = Object.freeze({ sources: Object.freeze({}), layers: Object.freeze([]) });

// MVT 的级别范围同旧页面
const TILE_ZOOMS = { minzoom: 3, maxzoom: 18 } as const;

/** 查询瓦片的地址：同源的 /backend 换成绝对地址（MapLibre 在 Worker 里请求） */
export function queryTileBase(apiBaseUrl: string, origin: string): string {
  return new URL(`${apiBaseUrl}/api/query/mvt`, origin).href;
}

/** 带条件的 MVT 地址：条件做 URL 编码，瓦片坐标的占位符原样保留 */
export function mvtTiles(tileBase: string, layerCode: string, xzqdm: string, conditions: string): string[] {
  const query = new URLSearchParams({ layerCode, xzqdm, conditions });
  return [`${tileBase}?${query.toString()}&z={z}&x={x}&y={y}`];
}

/** 预览：点层画灰点，面层画灰色的填充和边线；没有图层时为空分组 */
export function previewGroup(layer: QueryLayer | null, tileBase: string): StyleGroup {
  if (layer === null) {
    return EMPTY_GROUP;
  }
  const source = PREVIEW_GROUP;
  const common = { source, 'source-layer': layer.sourceLayer } as const;
  const layers: LayerSpecification[] =
    layer.geometry === 'point'
      ? [
          {
            id: `${PREVIEW_GROUP}-point`,
            type: 'circle',
            ...common,
            filter: POINTS,
            paint: {
              'circle-radius': 4,
              'circle-color': PREVIEW_COLOR,
              'circle-opacity': 0.55,
              'circle-stroke-width': 1,
              'circle-stroke-color': PREVIEW_STROKE,
              'circle-stroke-opacity': 0.8
            }
          }
        ]
      : [
          {
            id: `${PREVIEW_GROUP}-fill`,
            type: 'fill',
            ...common,
            filter: POLYGONS,
            paint: { 'fill-color': PREVIEW_COLOR, 'fill-opacity': 0.25 }
          },
          {
            id: `${PREVIEW_GROUP}-line`,
            type: 'line',
            ...common,
            paint: { 'line-color': PREVIEW_STROKE, 'line-width': 1, 'line-opacity': 0.45 }
          }
        ];
  return {
    sources: { [source]: { type: 'vector', tiles: mvtTiles(tileBase, layer.table, PROVINCE_CODE, ''), ...TILE_ZOOMS } },
    layers
  };
}

// 结果的样式：面和线画红色边线，点画带白边的红点（同旧页面）
function resultLayers(sourceLayer: string | null, geometry: QueryLayer['geometry'] | 'mixed'): LayerSpecification[] {
  const common = { source: RESULT_GROUP, ...(sourceLayer !== null && { 'source-layer': sourceLayer }) };
  const line: LayerSpecification = {
    id: `${RESULT_GROUP}-line`,
    type: 'line',
    ...common,
    filter: ['!', POINTS],
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': RESULT_COLOR, 'line-width': 2, 'line-opacity': 0.8 }
  };
  const point: LayerSpecification = {
    id: `${RESULT_GROUP}-point`,
    type: 'circle',
    ...common,
    filter: POINTS,
    paint: {
      'circle-radius': 5,
      'circle-color': RESULT_COLOR,
      'circle-stroke-width': 2,
      'circle-stroke-color': '#FFFFFF'
    }
  };
  if (geometry === 'mixed') {
    return [line, point];
  }
  return geometry === 'point' ? [point] : [line];
}

/** 空间查询命中的要素转成 GeoJSON；属性放主键，用不到别的 */
export function featureCollection(features: ResultFeatures): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: features.map(({ guid, geom }): Feature => ({ type: 'Feature', properties: { guid }, geometry: geom }))
  };
}

/**
 * 结果分组：属性类按查询的条件出 MVT；空间类等命中的要素到了才出图层（后端可能返回点、线、面，都画）。
 * 没有查询时为空分组
 */
export function resultGroup(
  request: QueryRequest | null,
  layer: QueryLayer | null,
  features: FeatureCollection | null,
  tileBase: string
): StyleGroup {
  if (request === null || layer === null) {
    return EMPTY_GROUP;
  }
  if (request.kind === 'attribute') {
    const tiles = mvtTiles(tileBase, request.layerCode, request.xzqdm, request.conditions);
    return {
      sources: { [RESULT_GROUP]: { type: 'vector', tiles, ...TILE_ZOOMS } },
      layers: resultLayers(layer.sourceLayer, layer.geometry)
    };
  }
  if (features === null || features.features.length === 0) {
    return EMPTY_GROUP;
  }
  return {
    sources: { [RESULT_GROUP]: { type: 'geojson', data: features } },
    layers: resultLayers(null, 'mixed')
  };
}
