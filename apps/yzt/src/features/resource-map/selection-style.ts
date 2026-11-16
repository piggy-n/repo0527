import type { ExpressionSpecification, LayerSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Feature } from 'geojson';
import type { StyleGroup } from '@mx/map-core';
import type { ResourceLayerStyle } from './symbols';

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

type SymbolStyle = Extract<ResourceLayerStyle, { type: 'symbol' }>;

/**
 * 点按资源的形状高亮（ADR 0159）：给出这个高亮色下的样式，同资源点图层的形状、大小，描边换成高亮色、加宽；
 * 推导方用 resourceHighlightStyle 得出，样式图片是资源分组里的，资源不在地图上时推导方给 null，点退回红色圆点
 */
export type PointHighlightOf = (color: string) => SymbolStyle | null;

// 点：按资源的形状画；没有资源的样式时是红色圆点
function pointLayer(
  id: string,
  color: string,
  point: PointHighlightOf | null,
  common: Pick<LayerSpecification & { type: 'circle' }, 'source' | 'source-layer' | 'minzoom' | 'filter'>,
  radius: number
): LayerSpecification {
  const style = point?.(color);
  if (style) {
    return { id: `${id}-point`, type: 'symbol', ...common, layout: style.layout, paint: style.paint };
  }
  return {
    id: `${id}-circle`,
    type: 'circle',
    ...common,
    paint: {
      'circle-color': color,
      'circle-radius': radius,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2
    }
  };
}

function detailLayers(color: string, point: PointHighlightOf | null): LayerSpecification[] {
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
    pointLayer(SELECTION_GROUP, color, point, { source: SOURCE, filter: POINTS }, 8)
  ];
}

/** 框选结果的批量高亮：画在资源的瓦片上，按 guid 过滤（ADR 0049 第 3 节） */
export interface BatchHighlight {
  /** 资源分组里的数据源；推导方要保证它此刻在资源分组里 */
  readonly sourceId: string;
  readonly sourceLayer: string;
  /** 同资源的最小显示级别 */
  readonly minzoom: number | undefined;
  /** 不重复 */
  readonly guids: readonly string[];
  /** 点资源按它的形状高亮（ADR 0159） */
  readonly point: PointHighlightOf | null;
}

function batchLayers({ sourceId, sourceLayer, minzoom, guids, point }: BatchHighlight): LayerSpecification[] {
  // match 的取值表按哈希查找，几千个 guid 也不逐个比较
  const listed: ExpressionSpecification = ['match', ['get', 'guid'], [...guids], true, false];
  const common = { source: sourceId, 'source-layer': sourceLayer, ...(minzoom === undefined ? {} : { minzoom }) };
  const id = `${SELECTION_GROUP}-batch`;
  return [
    {
      id: `${id}-fill`,
      type: 'fill',
      ...common,
      filter: ['all', POLYGONS, listed],
      paint: { 'fill-color': HIGHLIGHT_COLOR, 'fill-opacity': 0.12 }
    },
    {
      id: `${id}-line`,
      type: 'line',
      ...common,
      filter: ['all', OUTLINES, listed],
      layout: LINE_LAYOUT,
      paint: { 'line-color': HIGHLIGHT_COLOR, 'line-width': 2 }
    },
    pointLayer(id, HIGHLIGHT_COLOR, point, { ...common, filter: ['all', POINTS, listed] }, 6)
  ];
}

/** 详情里选中的要素 */
export interface SelectedHighlight {
  /**
   * 完整几何和要素的属性（点选时取自瓦片：点按资源的分类取形状、大小，和资源的点图层用同一套表达式），原样交给数据源；
   * 调用方只在选中的要素、详情变化时换新对象，拖透明度、预览颜色时数据源不重发（ADR 0022）
   */
  readonly feature: Feature;
  /** 点资源按它的形状高亮（ADR 0159） */
  readonly point: PointHighlightOf | null;
}

/**
 * 推导 selection 分组：选中要素的完整几何（没选中、加载中、不能查详情时没有），框选结果的批量高亮画在它下面；
 * 都没有时是空分组
 */
export function selectionGroup(
  selected: SelectedHighlight | null,
  flashing: boolean,
  batch: BatchHighlight | null = null
): StyleGroup {
  const batched = batch && batch.guids.length > 0 ? batchLayers(batch) : [];
  if (!selected) {
    return { sources: {}, layers: batched };
  }
  const highlight = detailLayers(flashing ? FLASH_COLOR : HIGHLIGHT_COLOR, selected.point);
  return { sources: { [SOURCE]: { type: 'geojson', data: selected.feature } }, layers: [...batched, ...highlight] };
}
