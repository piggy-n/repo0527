import type { ExpressionSpecification, LayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Feature, Geometry } from 'geojson';
import type { StyleGroup } from '@yzt/map-core';

/** 分组名：选中要素的高亮，放在 resources 之上、basemap-labels 之下（ADR 0047 第 5 节） */
export const SELECTION_GROUP = 'selection';

const SOURCE = SELECTION_GROUP;

// 沿用旧项目的高亮色和闪烁色；地图样式里的颜色是数据，不走 CSS 令牌
const HIGHLIGHT_COLOR = '#f5222d';
const FLASH_COLOR = '#ff7875';

const POLYGONS: ExpressionSpecification = ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false];
// 面的描边和线
const OUTLINES: ExpressionSpecification = ['match', ['geometry-type'], ['Point', 'MultiPoint'], false, true];
const POINTS: ExpressionSpecification = ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false];
const LINE_LAYOUT = { 'line-join': 'round', 'line-cap': 'round' } as const;

function detailLayers(color: string): LayerSpecification[] {
  return [
    {
      id: `${SELECTION_GROUP}-fill`,
      type: 'fill',
      source: SOURCE,
      filter: POLYGONS,
      paint: { 'fill-color': color, 'fill-opacity': 0.12 }
    },
    {
      id: `${SELECTION_GROUP}-line`,
      type: 'line',
      source: SOURCE,
      filter: OUTLINES,
      layout: LINE_LAYOUT,
      paint: { 'line-color': color, 'line-width': 3 }
    },
    {
      id: `${SELECTION_GROUP}-circle`,
      type: 'circle',
      source: SOURCE,
      filter: POINTS,
      paint: { 'circle-color': color, 'circle-radius': 8, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 }
    }
  ];
}

const HIGHLIGHT_LAYERS = detailLayers(HIGHLIGHT_COLOR);
const FLASH_LAYERS = detailLayers(FLASH_COLOR);

/** 框选结果的批量高亮：画在资源的瓦片上，按 guid 过滤（ADR 0049 第 3 节） */
export interface BatchHighlight {
  /** 资源分组里的数据源；推导方要保证它此刻在资源分组里 */
  readonly sourceId: string;
  readonly sourceLayer: string;
  /** 同资源的最小显示级别 */
  readonly minzoom: number | undefined;
  /** 不重复 */
  readonly guids: readonly string[];
}

function batchLayers({ sourceId, sourceLayer, minzoom, guids }: BatchHighlight): LayerSpecification[] {
  // match 的取值表按哈希查找，几千个 guid 也不逐个比较
  const listed: ExpressionSpecification = ['match', ['get', 'guid'], [...guids], true, false];
  const common = { source: sourceId, 'source-layer': sourceLayer, ...(minzoom === undefined ? {} : { minzoom }) };
  return [
    {
      id: `${SELECTION_GROUP}-batch-fill`,
      type: 'fill',
      ...common,
      filter: ['all', POLYGONS, listed],
      paint: { 'fill-color': HIGHLIGHT_COLOR, 'fill-opacity': 0.12 }
    },
    {
      id: `${SELECTION_GROUP}-batch-line`,
      type: 'line',
      ...common,
      filter: ['all', OUTLINES, listed],
      layout: LINE_LAYOUT,
      paint: { 'line-color': HIGHLIGHT_COLOR, 'line-width': 2 }
    },
    {
      id: `${SELECTION_GROUP}-batch-circle`,
      type: 'circle',
      ...common,
      filter: ['all', POINTS, listed],
      paint: {
        'circle-color': HIGHLIGHT_COLOR,
        'circle-radius': 6,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2
      }
    }
  ];
}

/**
 * 推导 selection 分组：选中要素的完整几何（没选中、加载中、不能查详情时没有），框选结果的批量高亮画在它下面；
 * 都没有时是空分组
 */
export function selectionGroup(
  geometry: Geometry | null,
  flashing: boolean,
  batch: BatchHighlight | null = null
): StyleGroup {
  const batched = batch && batch.guids.length > 0 ? batchLayers(batch) : [];
  if (!geometry) {
    return { sources: {}, layers: batched };
  }
  // 几何直接引用查询结果，外面的要素每次换新对象（ADR 0022）
  const data: Feature = { type: 'Feature', properties: {}, geometry };
  const highlight = flashing ? FLASH_LAYERS : HIGHLIGHT_LAYERS;
  return { sources: { [SOURCE]: { type: 'geojson', data } }, layers: [...batched, ...highlight] };
}
