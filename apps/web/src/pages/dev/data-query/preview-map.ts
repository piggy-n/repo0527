import type { StyleGroup } from '@yzt/map-core';
import provinceUrl from '@/shared/map/boundary/data/jiangsu-province.json?url';

// 仅使用本地省界与固定样例，地图样式颜色属于渲染数据
export const PREVIEW_BACKGROUND: StyleGroup = {
  sources: { 'query-preview-province': { type: 'geojson', data: provinceUrl } },
  layers: [
    { id: 'query-preview-background', type: 'background', paint: { 'background-color': '#EEF1F5' } },
    { id: 'query-preview-land', type: 'fill', source: 'query-preview-province',
      filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#FBFCFF' } }
  ]
};

export function previewSelection(range: boolean, results: boolean): StyleGroup {
  if (!range && !results) {
    return { sources: {}, layers: [] };
  }
  return {
    sources: {
      'query-preview-selection': { type: 'geojson', data: {
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: {}, geometry: {
          type: 'Polygon', coordinates: [[[118.5, 31.8], [119, 31.8], [119, 32.25], [118.5, 32.25], [118.5, 31.8]]]
        } }]
      } }
    },
    layers: [
      { id: 'query-preview-fill', type: 'fill', source: 'query-preview-selection',
        filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#597EF7', 'fill-opacity': 0.16 } },
      { id: 'query-preview-line', type: 'line', source: 'query-preview-selection',
        paint: { 'line-color': '#597EF7', 'line-width': 2 } }
    ]
  };
}
