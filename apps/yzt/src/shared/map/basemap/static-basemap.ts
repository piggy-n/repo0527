import type {
  BackgroundLayerSpecification,
  ExpressionSpecification,
  FillLayerSpecification,
  FilterSpecification,
  GeoJSONSourceSpecification,
  LineLayerSpecification,
  SymbolLayerSpecification
} from '@maplibre/maplibre-gl-style-spec';
import { overlayDetailMetadata, type StyleGroup, type StyleRoot } from '@mx/map-core';
import cityUrl from '../boundary/data/jiangsu-city.json?url';
import labelsUrl from './data/jiangsu-labels.json?url';
import { STATIC_BASEMAP_OPTIONS } from './static-options';
import {
  STATIC_CITY_COLORS,
  STATIC_CITY_LINE_COLOR,
  STATIC_LAND_COLOR,
  STATIC_OUTSIDE_COLOR
} from './static-palette';

/**
 * 静态底图的地名只有汉字，由 MapLibre 用本地字体画，这个地址不会被请求；样式校验要求有 text-field 时必须有 glyphs。
 * 使用 useBasemap 的页面都要在 provideMap 时传入，标注可以在页面上随时打开（ADR 0133、0146）
 */
export const BASEMAP_STYLE_ROOT: StyleRoot = { glyphs: '/fonts/glyphs/{fontstack}/{range}.pbf' };

const BACKGROUND: BackgroundLayerSpecification = {
  id: 'basemap-background',
  type: 'background',
  paint: { 'background-color': STATIC_OUTSIDE_COLOR }
};

// 和行政区边界同一份市界：面和线与边界严格重合，文件也只下载一次（ADR 0133）
const CITY_SOURCE_ID = 'basemap-static';
const CITY_SOURCE: GeoJSONSourceSpecification = { type: 'geojson', data: cityUrl };

const CITY_COLOR: ExpressionSpecification = [
  'match',
  ['get', 'code'],
  ...Object.entries(STATIC_CITY_COLORS).flat(),
  STATIC_OUTSIDE_COLOR
] as unknown as ExpressionSpecification;

// 三维按要素原来的类型求值：不写 MultiPolygon 的话南京会被滤掉
const POLYGONS: FilterSpecification = ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false];

// 三维的面和线到 11 级不再加细：约 1.6 万个顶点、误差约 19 米；不设上限时靠近模型要重建约 6 万个（ADR 0135）
const OVERLAY_DETAIL = overlayDetailMetadata(11);

function landLayer(opacity: number, cityColors: boolean): FillLayerSpecification {
  return {
    id: 'basemap-static-land',
    type: 'fill',
    source: CITY_SOURCE_ID,
    filter: POLYGONS,
    metadata: OVERLAY_DETAIL,
    paint: { 'fill-color': cityColors ? CITY_COLOR : STATIC_LAND_COLOR, 'fill-opacity': opacity }
  };
}

function cityLineLayer(opacity: number): LineLayerSpecification {
  return {
    id: 'basemap-static-line',
    type: 'line',
    source: CITY_SOURCE_ID,
    metadata: OVERLAY_DETAIL,
    layout: { 'line-join': 'round' },
    paint: {
      'line-color': STATIC_CITY_LINE_COLOR,
      'line-opacity': 0.9 * opacity,
      'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.5, 9, 1, 13, 1.5]
    }
  };
}

/** 静态底图的 basemap 分组：省外的底色、陆地的面和市之间的细线（ADR 0133、0134） */
export function staticBasemapGroup(opacity: number, options = STATIC_BASEMAP_OPTIONS): StyleGroup {
  return {
    sources: { [CITY_SOURCE_ID]: CITY_SOURCE },
    layers: [BACKGROUND, landLayer(opacity, options.cityColors), cityLineLayer(opacity)]
  };
}

const LABELS_SOURCE_ID = 'basemap-labels-static';
const LABELS_SOURCE: GeoJSONSourceSpecification = { type: 'geojson', data: labelsUrl };

// 区县的地名在 8.5 级才出现，低级别时只看到市名
const COUNTY_LABEL_MIN_ZOOM = 8.5;

function labelLayer(
  level: 'city' | 'county',
  { size, color, minzoom }: { readonly size: number; readonly color: string; readonly minzoom?: number },
  opacity: number
): SymbolLayerSpecification {
  return {
    id: `${LABELS_SOURCE_ID}-${level}`,
    type: 'symbol',
    source: LABELS_SOURCE_ID,
    ...(minzoom === undefined ? {} : { minzoom }),
    filter: ['==', ['get', 'level'], level],
    layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': size },
    paint: {
      'text-color': color,
      'text-opacity': opacity,
      'text-halo-color': '#FFFFFF',
      'text-halo-width': 1.5,
      'text-halo-blur': 0.5
    }
  };
}

/** 静态底图的 basemap-labels 分组：市、区县的地名，二三维都画（ADR 0146）；市名在上，避让时优先 */
export function staticLabelsGroup(opacity: number): StyleGroup {
  return {
    sources: { [LABELS_SOURCE_ID]: LABELS_SOURCE },
    layers: [
      labelLayer('county', { size: 12, color: '#6B7280', minzoom: COUNTY_LABEL_MIN_ZOOM }, opacity),
      labelLayer('city', { size: 14, color: '#374151' }, opacity)
    ]
  };
}
