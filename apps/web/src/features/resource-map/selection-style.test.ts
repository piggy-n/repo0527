// @vitest-environment node
import { featureFilter } from '@maplibre/maplibre-gl-style-spec';
import type { Geometry } from 'geojson';
import { type StyleGroup, StyleModel } from '@yzt/map-core';
import { describe, expect, it } from 'vitest';
import { type BatchHighlight, selectionGroup } from './selection-style';

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

const BATCH: BatchHighlight = {
  sourceId: 'resources-bgdc_dltb',
  sourceLayer: 'bgdc_dltb_2022',
  minzoom: undefined,
  guids: ['a'.repeat(32), 'b'.repeat(32)]
};

// 按 MapLibre 的语义求值：这个要素会被哪些图层画出
function drawnFeature(group: StyleGroup, type: 'Polygon' | 'LineString' | 'Point', guid: string) {
  const feature = { type, properties: { guid } };
  return group.layers
    .filter(item => 'filter' in item && featureFilter(item.filter, item.id).filter({ zoom: 12 }, feature))
    .map(({ id }) => id);
}

// 图层引用的数据源和瓦片图层
function sourcesOf(group: StyleGroup) {
  return group.layers.map(layer => {
    const sourceLayer = 'source-layer' in layer && layer['source-layer'];
    return [layer.id, 'source' in layer && layer.source, sourceLayer];
  });
}

const GUID_A = 'a'.repeat(32);

describe('selectionGroup：框选的批量高亮', () => {
  it('画在资源的瓦片上：引用资源的数据源和瓦片图层，不加数据源；列表里的 guid 才画，按几何类型分层', () => {
    const group = selectionGroup(null, false, BATCH);

    expect(group.sources).toStrictEqual({});
    expect(sourcesOf(group)).toStrictEqual([
      ['selection-batch-fill', 'resources-bgdc_dltb', 'bgdc_dltb_2022'],
      ['selection-batch-line', 'resources-bgdc_dltb', 'bgdc_dltb_2022'],
      ['selection-batch-circle', 'resources-bgdc_dltb', 'bgdc_dltb_2022']
    ]);
    expect(drawnFeature(group, 'Polygon', GUID_A)).toStrictEqual(['selection-batch-fill', 'selection-batch-line']);
    expect(drawnFeature(group, 'LineString', 'b'.repeat(32))).toStrictEqual(['selection-batch-line']);
    expect(drawnFeature(group, 'Point', GUID_A)).toStrictEqual(['selection-batch-circle']);
    expect(drawnFeature(group, 'Polygon', 'c'.repeat(32))).toStrictEqual([]);
  });

  it('比选中的那个淡：面填充 0.12、描边和线 2 像素、点半径 6；最小显示级别同资源', () => {
    const group = selectionGroup(null, false, { ...BATCH, minzoom: 9 });

    expect(group.layers.map(layer => layer.paint)).toMatchObject([
      { 'fill-color': '#f5222d', 'fill-opacity': 0.12 },
      { 'line-color': '#f5222d', 'line-width': 2 },
      { 'circle-color': '#f5222d', 'circle-radius': 6, 'circle-stroke-color': '#ffffff' }
    ]);
    expect(group.layers.map(layer => layer.minzoom)).toStrictEqual([9, 9, 9]);
    expect(selectionGroup(null, false, BATCH).layers.every(layer => !('minzoom' in layer))).toBe(true);
  });

  it('没有 guid 时不出图层；和选中的那个同时有时画在它下面', () => {
    expect(selectionGroup(null, false, { ...BATCH, guids: [] })).toStrictEqual({ sources: {}, layers: [] });
    expect(selectionGroup(SQUARE, false, BATCH).layers.map(({ id }) => id)).toStrictEqual([
      'selection-batch-fill',
      'selection-batch-line',
      'selection-batch-circle',
      'selection-fill',
      'selection-line',
      'selection-circle'
    ]);
  });

  it('和资源分组一起组合时通过校验；资源分组里没有这个数据源时组合失败，所以推导方要和资源的显示状态一致', () => {
    const resources: StyleGroup = {
      sources: { 'resources-bgdc_dltb': { type: 'vector', tiles: ['http://localhost/{z}/{x}/{y}'] } },
      layers: []
    };
    const model = new StyleModel({ groups: ['resources', 'selection', 'basemap-labels'] });

    expect(() => model.setGroups({ resources, selection: selectionGroup(null, false, BATCH) })).not.toThrow();
    expect(() => model.setGroups({ resources: { sources: {}, layers: [] } })).toThrow('引用的数据源');
  });
});
