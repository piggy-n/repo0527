// @vitest-environment node
import { featureFilter } from '@maplibre/maplibre-gl-style-spec';
import type { Geometry } from 'geojson';
import { type StyleGroup, StyleModel } from '@yzt/map-core';
import { describe, expect, it } from 'vitest';
import { selectionGroup } from './selection-style';

const SQUARE: Geometry = {
  type: 'Polygon',
  coordinates: [
    [
      [119, 33],
      [119.1, 33],
      [119.1, 33.1],
      [119, 33]
    ]
  ]
};

// 按 MapLibre 的语义求值过滤条件：这种几何类型的要素会被哪些图层画出
function drawnBy(group: StyleGroup, type: 'Polygon' | 'MultiPolygon' | 'LineString' | 'MultiLineString' | 'Point') {
  return group.layers
    .filter(item => {
      return 'filter' in item && featureFilter(item.filter, item.id).filter({ zoom: 12 }, { type, properties: {} });
    })
    .map(({ id }) => id);
}

// 交给数据源的要素
function dataOf(group: StyleGroup) {
  const source = group.sources.selection;
  return source?.type === 'geojson' && typeof source.data === 'object' ? source.data : undefined;
}

const paints = (flashing: boolean) => selectionGroup(SQUARE, flashing).layers.map(layer => layer.paint);

describe('selectionGroup', () => {
  it('没有几何时是空分组', () => {
    expect(selectionGroup(null, false)).toStrictEqual({ sources: {}, layers: [] });
    expect(selectionGroup(null, true)).toStrictEqual({ sources: {}, layers: [] });
  });

  it('几何放进 selection 数据源，直接引用；外面的要素每次换新对象', () => {
    const first = selectionGroup(SQUARE, false);
    const second = selectionGroup(SQUARE, false);

    expect(first.sources).toStrictEqual({
      selection: { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: SQUARE } }
    });
    const data = dataOf(first);
    expect(data).not.toBe(dataOf(second));
    expect(data?.type === 'Feature' && data.geometry).toBe(SQUARE);
  });

  it('面画填充和描边，线只画线，点画圆；多部件的同样处理', () => {
    const group = selectionGroup(SQUARE, false);

    expect(drawnBy(group, 'Polygon')).toStrictEqual(['selection-fill', 'selection-line']);
    expect(drawnBy(group, 'MultiPolygon')).toStrictEqual(['selection-fill', 'selection-line']);
    expect(drawnBy(group, 'LineString')).toStrictEqual(['selection-line']);
    expect(drawnBy(group, 'MultiLineString')).toStrictEqual(['selection-line']);
    expect(drawnBy(group, 'Point')).toStrictEqual(['selection-circle']);
  });

  it('红色高亮，闪烁时换成浅红；面的填充 0.12、描边和线 3 像素、点半径 8 加白色描边', () => {
    expect(paints(false)).toMatchObject([
      { 'fill-color': '#f5222d', 'fill-opacity': 0.12 },
      { 'line-color': '#f5222d', 'line-width': 3 },
      { 'circle-color': '#f5222d', 'circle-radius': 8, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 }
    ]);
    expect(paints(true)).toMatchObject([
      { 'fill-color': '#ff7875' },
      { 'line-color': '#ff7875' },
      { 'circle-color': '#ff7875', 'circle-stroke-color': '#ffffff' }
    ]);
  });

  it('ID 以分组名为前缀，和资源、注记一起组合后通过校验', () => {
    const model = new StyleModel({ groups: ['resources', 'selection', 'basemap-labels'] });

    expect(() => model.setGroups({ selection: selectionGroup(SQUARE, true) })).not.toThrow();
    expect(model.current.layers.map(({ id }) => id)).toStrictEqual([
      'selection-fill',
      'selection-line',
      'selection-circle'
    ]);
  });
});
