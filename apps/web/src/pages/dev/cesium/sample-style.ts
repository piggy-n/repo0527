import type {
  FillLayerSpecification, LayerSpecification, RasterSourceSpecification
} from '@maplibre/maplibre-gl-style-spec';
import type { FeatureCollection } from 'geojson';
import type { StyleGroup } from '@yzt/map-core';
import { SAMPLE_MVT_SOURCE } from './sample-mvt';

/** 开发页只保存样例显示意图，两个视图共用推导后的会话样式 */
export interface SampleStyleState {
  readonly visible: boolean;
  readonly alternateColors: boolean;
  readonly rasterAbove: boolean;
}

export const INITIAL_SAMPLE_STYLE_STATE: SampleStyleState = {
  visible: true, alternateColors: false, rasterAbove: true
};

// 内嵌棋盘图片，二维和三维都不需要后端或公网瓦片
const CHECKER_IMAGE = 'data:image/png;base64,' +
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAIElEQVR4nGP4TwDcefIOL2YYNWBYGEBIASEwasCwMAAAAAjUrjqlR0cAAAAASUVORK5CYII=';
const RASTER_SOURCE: RasterSourceSpecification = {
  type: 'raster', tiles: [CHECKER_IMAGE], tileSize: 256, minzoom: 0, maxzoom: 14,
  bounds: [118.74, 32.01, 118.86, 32.09]
};
const BACKGROUND: LayerSpecification = {
  id: 'sample-background', type: 'background', paint: { 'background-color': '#f3f5f8' }
};
const BACKGROUND_ONLY: StyleGroup = { sources: {}, layers: [BACKGROUND] };

// 南京附近的面、洞、折线和节点；定位按钮在俯视与斜视下都能覆盖
const SAMPLE_DATA: FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature', id: 'primary-area', properties: { category: 'primary' },
      geometry: {
        type: 'Polygon', coordinates: [
          [[118.70, 31.98], [118.88, 31.98], [118.88, 32.12], [118.70, 32.12], [118.70, 31.98]],
          [[118.77, 32.03], [118.77, 32.07], [118.83, 32.07], [118.83, 32.03], [118.77, 32.03]]
        ]
      }
    },
    {
      type: 'Feature', id: 'secondary-area', properties: { category: 'secondary' },
      geometry: {
        type: 'Polygon', coordinates: [
          [[118.89, 32.01], [118.95, 32.01], [118.95, 32.09], [118.89, 32.09], [118.89, 32.01]]
        ]
      }
    },
    {
      type: 'Feature', id: 'path', properties: {},
      geometry: { type: 'LineString', coordinates: [[118.72, 32.0], [118.75, 32.10], [118.91, 32.06]] }
    },
    {
      type: 'Feature', id: 'primary-point', properties: { category: 'primary' },
      geometry: { type: 'Point', coordinates: [118.75, 32.10] }
    },
    {
      type: 'Feature', id: 'secondary-point', properties: { category: 'secondary' },
      geometry: { type: 'Point', coordinates: [118.91, 32.06] }
    }
  ]
};
const SOURCES: StyleGroup['sources'] = {
  'sample-raster': RASTER_SOURCE,
  'sample-geometry': { type: 'geojson', data: SAMPLE_DATA },
  'sample-mvt': SAMPLE_MVT_SOURCE
};
const BASE_RASTER: LayerSpecification = {
  id: 'sample-raster-below', type: 'raster', source: 'sample-raster', paint: { 'raster-opacity': 0.7 }
};
const OVERLAY_RASTER: LayerSpecification = {
  id: 'sample-raster-overlay', type: 'raster', source: 'sample-raster', paint: { 'raster-opacity': 0.55 }
};
const LINE: LayerSpecification = {
  id: 'sample-line', type: 'line', source: 'sample-geometry',
  filter: ['==', ['geometry-type'], 'LineString'],
  layout: { 'line-cap': 'round', 'line-join': 'round' },
  paint: { 'line-color': '#253858', 'line-width': 4 }
};
const MVT_LINE: LayerSpecification = {
  id: 'sample-mvt-line', type: 'line', source: 'sample-mvt', 'source-layer': 'detail', minzoom: 10,
  filter: ['==', ['geometry-type'], 'LineString'],
  layout: { 'line-cap': 'round', 'line-join': 'round' },
  paint: { 'line-color': '#389e0d', 'line-width': 3 }
};

/** 推导同一份基础样式：面夹在两张栅格之间，调整时只改变会话层序 */
export function sampleStyleGroup({ visible, alternateColors, rasterAbove }: SampleStyleState): StyleGroup {
  if (!visible) {
    return BACKGROUND_ONLY;
  }
  const primary = alternateColors ? '#13c2c2' : '#597ef7';
  const secondary = alternateColors ? '#eb2f96' : '#fa8c16';
  const fill: FillLayerSpecification = {
    id: 'sample-fill', type: 'fill', source: 'sample-geometry',
    filter: ['==', ['geometry-type'], 'Polygon'],
    paint: {
      'fill-color': ['match', ['get', 'category'], 'primary', primary, secondary],
      'fill-opacity': 0.8
    }
  };
  const mvtFill: FillLayerSpecification = {
    id: 'sample-mvt-fill', type: 'fill', source: 'sample-mvt', 'source-layer': 'landuse', minzoom: 10,
    filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['in', ['id'], ['literal', ['area-primary', 'area-secondary']]]],
    paint: { 'fill-color': fill.paint?.['fill-color'], 'fill-opacity': 0.65 }
  };
  return {
    sources: SOURCES,
    layers: [
      BACKGROUND, BASE_RASTER,
      ...(rasterAbove ? [mvtFill, fill, OVERLAY_RASTER] : [OVERLAY_RASTER, mvtFill, fill]),
      MVT_LINE, LINE,
      {
        id: 'sample-mvt-points', type: 'circle', source: 'sample-mvt', 'source-layer': 'detail', minzoom: 10,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-color': ['match', ['get', 'category'], 'primary', primary, secondary],
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 7, 14, 12],
          'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2
        }
      },
      {
        id: 'sample-points', type: 'circle', source: 'sample-geometry',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-color': ['match', ['get', 'category'], 'primary', primary, secondary],
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 4, 10, 8, 14, 12],
          'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2
        }
      }
    ]
  };
}
