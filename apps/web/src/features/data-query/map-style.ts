import type { StyleGroup } from '@yzt/map-core';
import type { Geometry } from 'geojson';
import type { QueryLayer, QuerySnapshot } from './types';

// MapLibre 的样式取不到 CSS 变量，查询用到的颜色在这里命名
/** 查询结果、绘制中的范围 */
export const RESULT_COLOR = '#577CFF';
/** 选中的一条结果 */
export const SELECTION_COLOR = '#FF9C40';
// 还没有查询时图层的底色
const IDLE_COLOR = '#8C9BB5';
const POINT_STROKE_COLOR = '#FFFFFF';

/** 属性结果使用后端筛选过的 MVT，URL 只走项目同源代理 */
export function queryLayerGroup(
  layer: QueryLayer | undefined,
  snapshot: QuerySnapshot | null,
  base: string
): StyleGroup {
  if (!layer || (snapshot && snapshot.scope.kind !== 'region')) {
    return { sources: {}, layers: [] };
  }
  const target = snapshot?.layer ?? layer;
  const params = new URLSearchParams({
    layerCode: target.code,
    xzqdm: snapshot?.scope.kind === 'region' ? snapshot.scope.code : '320000',
    conditions: snapshot?.conditions ?? ''
  });
  const source = 'query-layer-source';
  const common = { source, 'source-layer': target.sourceLayer };
  const color = snapshot ? RESULT_COLOR : IDLE_COLOR;
  const tiles = [`${base}/api/query/mvt?${params}&z={z}&x={x}&y={y}`];
  if (target.geometry === 'point') {
    return {
      sources: { [source]: { type: 'vector', tiles } },
      layers: [
        {
          ...common,
          id: 'query-layer-point',
          type: 'circle',
          paint: {
            'circle-color': color,
            'circle-radius': 4,
            'circle-stroke-color': POINT_STROKE_COLOR,
            'circle-stroke-width': 1
          }
        }
      ]
    };
  }
  return {
    sources: { [source]: { type: 'vector', tiles } },
    layers: [
      {
        ...common,
        id: 'query-layer-fill',
        type: 'fill',
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': color, 'fill-opacity': snapshot ? 0.3 : 0.12 }
      },
      {
        ...common,
        id: 'query-layer-line',
        type: 'line',
        paint: { 'line-color': color, 'line-width': 1 }
      }
    ]
  };
}

/** 完整空间结果与单条选中高亮共用绘制方式，数据源身份按所属分组区分 */
export function geometryGroup(name: string, geometries: readonly Geometry[], color: string): StyleGroup {
  if (!geometries.length) {
    return { sources: {}, layers: [] };
  }
  const source = `${name}-source`;
  const features = geometries.map(geometry => ({ type: 'Feature' as const, geometry, properties: {} }));
  return {
    sources: { [source]: { type: 'geojson', data: { type: 'FeatureCollection', features } } },
    layers: [
      {
        id: `${name}-fill`,
        source,
        type: 'fill',
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': color, 'fill-opacity': 0.2 }
      },
      {
        id: `${name}-line`,
        source,
        type: 'line',
        paint: { 'line-color': color, 'line-width': 2 }
      },
      {
        id: `${name}-point`,
        source,
        type: 'circle',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-color': color,
          'circle-radius': 5,
          'circle-stroke-color': POINT_STROKE_COLOR,
          'circle-stroke-width': 2
        }
      }
    ]
  };
}
