import type { LayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Feature, Geometry } from 'geojson';
import type { StyleGroup } from '@yzt/map-core';

/** 分组名：选中要素的高亮，放在 resources 之上、basemap-labels 之下（ADR 0047 第 5 节） */
export const SELECTION_GROUP = 'selection';

const SOURCE = SELECTION_GROUP;

// 沿用旧项目的高亮色和闪烁色；地图样式里的颜色是数据，不走 CSS 令牌
const HIGHLIGHT_COLOR = '#f5222d';
const FLASH_COLOR = '#ff7875';

function layers(color: string): LayerSpecification[] {
  return [
    {
      id: `${SELECTION_GROUP}-fill`,
      type: 'fill',
      source: SOURCE,
      filter: ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false],
      paint: { 'fill-color': color, 'fill-opacity': 0.12 }
    },
    // 面的描边和线
    {
      id: `${SELECTION_GROUP}-line`,
      type: 'line',
      source: SOURCE,
      filter: ['match', ['geometry-type'], ['Point', 'MultiPoint'], false, true],
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': color, 'line-width': 3 }
    },
    {
      id: `${SELECTION_GROUP}-circle`,
      type: 'circle',
      source: SOURCE,
      filter: ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false],
      paint: { 'circle-color': color, 'circle-radius': 8, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 }
    }
  ];
}

const HIGHLIGHT_LAYERS = layers(HIGHLIGHT_COLOR);
const FLASH_LAYERS = layers(FLASH_COLOR);

/** 推导 selection 分组：选中要素的完整几何；没有几何（没选中、加载中、不能查详情）时是空分组 */
export function selectionGroup(geometry: Geometry | null, flashing: boolean): StyleGroup {
  if (!geometry) {
    return { sources: {}, layers: [] };
  }
  // 几何直接引用查询结果，外面的要素每次换新对象（ADR 0022）
  const data: Feature = { type: 'Feature', properties: {}, geometry };
  return { sources: { [SOURCE]: { type: 'geojson', data } }, layers: flashing ? FLASH_LAYERS : HIGHLIGHT_LAYERS };
}
