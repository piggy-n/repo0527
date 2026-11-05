// @vitest-environment node
import { featureFilter } from '@maplibre/maplibre-gl-style-spec';
import type { FeatureCollection } from 'geojson';
import { diffStyle, type LngLat, type MeasureState, type StyleGroup, StyleModel } from '@yzt/map-core';
import { describe, expect, it } from 'vitest';
import { measureGroup } from './measure-style';

const A: LngLat = [118, 32];
const B: LngLat = [118.1, 32];
const C: LngLat = [118.1, 32.1];

const EMPTY: MeasureState = { measurements: [], draft: null };

function features(group: StyleGroup): FeatureCollection['features'] {
  const source = group.sources.measure;
  if (source?.type !== 'geojson' || typeof source.data === 'string') {
    throw new Error('measure 分组没有 GeoJSON 数据');
  }
  return (source.data as FeatureCollection).features;
}

// 每个要素简化成"状态:几何类型"，便于对比
function summary(group: StyleGroup): string[] {
  return features(group).map(({ properties, geometry }) => `${String(properties?.status)}:${geometry.type}`);
}

// 按 MapLibre 的语义求值 filter（带上几何类型），列出每种要素会被哪些图层画出
function drawnBy(group: StyleGroup): [string, string[]][] {
  return features(group).map(({ properties, geometry }) => {
    if (geometry.type === 'GeometryCollection') {
      throw new Error('测量不产生 GeometryCollection');
    }
    const feature = { type: geometry.type, properties: properties ?? {} };
    const layers = group.layers
      .filter(layer => 'filter' in layer && featureFilter(layer.filter, layer.id).filter({ zoom: 0 }, feature))
      .map(({ id }) => id);
    return [`${String(properties?.status)}:${geometry.type}`, layers];
  });
}

function compose(group: StyleGroup) {
  const model = new StyleModel({ groups: ['measure'] });
  model.setGroups({ measure: group });
  return model.current;
}

describe('测量的样式推导', () => {
  it('没有测量时是空分组', () => {
    expect(measureGroup(EMPTY)).toStrictEqual({ sources: {}, layers: [] });
  });

  it('完成的测距是实线，测面是闭合的面；每个点都有节点', () => {
    const group = measureGroup({
      measurements: [
        { id: 'distance-1', kind: 'distance', points: [A, B], method: 'geodesic', value: 1 },
        { id: 'area-2', kind: 'area', points: [A, B, C], method: 'geodesic', value: 2 }
      ],
      draft: null
    });

    expect(summary(group)).toStrictEqual([
      'completed:LineString',
      'vertex:Point',
      'vertex:Point',
      'completed:Polygon',
      'vertex:Point',
      'vertex:Point',
      'vertex:Point'
    ]);
    expect(features(group)[3]?.geometry).toStrictEqual({ type: 'Polygon', coordinates: [[A, B, C, A]] });
  });

  it('正在画：预览点接在线后面，不画节点；测面不到三个点时退化成线，只有一个点时只有节点', () => {
    const drawingLine = measureGroup({ measurements: [], draft: { kind: 'distance', points: [A], preview: B } });
    const drawingArea = measureGroup({ measurements: [], draft: { kind: 'area', points: [A, B], preview: C } });
    const oneAreaPoint = measureGroup({ measurements: [], draft: { kind: 'area', points: [A], preview: null } });

    expect(summary(drawingLine)).toStrictEqual(['drawing:LineString', 'vertex:Point']);
    expect(features(drawingLine)[0]?.geometry).toStrictEqual({ type: 'LineString', coordinates: [A, B] });
    expect(summary(drawingArea)).toStrictEqual(['drawing:Polygon', 'vertex:Point', 'vertex:Point']);
    expect(summary(oneAreaPoint)).toStrictEqual(['vertex:Point']);
  });

  it('图层从下到上是填充、完成的线、虚线、节点；ID 以分组名为前缀，组合后通过校验', () => {
    const group = measureGroup({ measurements: [], draft: { kind: 'distance', points: [A], preview: B } });

    expect(group.layers.map(({ id }) => id)).toStrictEqual([
      'measure-fill-completed',
      'measure-fill-drawing',
      'measure-line-completed',
      'measure-line-drawing',
      'measure-vertex'
    ]);
    expect(Object.keys(group.sources)).toStrictEqual(['measure']);
    expect(() => compose(group)).not.toThrow();
  });

  it('每种要素由对应的图层画出：线只描线、不填充，面填充并描边，节点是圆点', () => {
    const completedAndDrawingLine = measureGroup({
      measurements: [
        { id: 'distance-1', kind: 'distance', points: [A, B, C], method: 'geodesic', value: 1 },
        { id: 'area-2', kind: 'area', points: [A, B, C], method: 'geodesic', value: 2 }
      ],
      draft: { kind: 'distance', points: [A, B], preview: C }
    });
    const drawingArea = measureGroup({ measurements: [], draft: { kind: 'area', points: [A, B], preview: C } });

    expect(Object.fromEntries([...drawnBy(completedAndDrawingLine), ...drawnBy(drawingArea)])).toStrictEqual({
      'completed:LineString': ['measure-line-completed'],
      'completed:Polygon': ['measure-fill-completed', 'measure-line-completed'],
      'drawing:LineString': ['measure-line-drawing'],
      'drawing:Polygon': ['measure-fill-drawing', 'measure-line-drawing'],
      'vertex:Point': ['measure-vertex']
    });
  });

  it('预览点移动时只更新 GeoJSON 数据，不增删图层', () => {
    const before = compose(measureGroup({ measurements: [], draft: { kind: 'distance', points: [A], preview: B } }));
    const after = compose(measureGroup({ measurements: [], draft: { kind: 'distance', points: [A], preview: C } }));

    expect(diffStyle(before, after).map(({ command }) => command)).toStrictEqual(['setGeoJSONSourceData']);
  });
});
