// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { INITIAL_SAMPLE_STYLE_STATE, sampleStyleGroup } from './sample-style';
import { sampleOverlayGroups } from './sample-overlays';
import { StyleModel } from '@yzt/map-core';

describe('三维开发页共享样例样式', () => {
  it('使用内嵌栅格和内联点线面，面保留孔洞与分类属性', () => {
    const group = sampleStyleGroup(INITIAL_SAMPLE_STYLE_STATE);
    const raster = group.sources['sample-raster'];
    expect(raster.type).toBe('raster');
    if (raster.type !== 'raster') {
      throw new Error('样例缺少栅格源');
    }
    expect(raster.tiles).toEqual([expect.stringMatching(/^data:image\/png;base64,/)]);
    expect(raster.bounds).toEqual([118.74, 32.01, 118.86, 32.09]);
    const geometry = group.sources['sample-geometry'];
    expect(geometry.type).toBe('geojson');
    if (geometry.type !== 'geojson') {
      throw new Error('样例缺少 GeoJSON 源');
    }
    expect(geometry.data).toMatchObject({
      type: 'FeatureCollection',
      features: [
        { id: 'primary-area', properties: { category: 'primary' }, geometry: { type: 'Polygon' } },
        { id: 'secondary-area', properties: { category: 'secondary' }, geometry: { type: 'Polygon' } },
        { geometry: { type: 'LineString' } }, { geometry: { type: 'Point' } }, { geometry: { type: 'Point' } }
      ]
    });
    if (typeof geometry.data !== 'object' || geometry.data.type !== 'FeatureCollection') {
      throw new Error('样例没有内联要素集合');
    }
    const first = geometry.data.features[0].geometry;
    expect(first?.type).toBe('Polygon');
    if (first?.type !== 'Polygon') {
      throw new Error('样例没有面要素');
    }
    expect(first.coordinates).toHaveLength(2);
    expect(first.coordinates[1][0]).toEqual([118.77, 32.03]);
    expect(first.coordinates[1].at(-1)).toEqual(first.coordinates[1][0]);
  });

  it('调整叠放只把覆盖栅格移到面下面，线与点仍然在上层', () => {
    const before = sampleStyleGroup(INITIAL_SAMPLE_STYLE_STATE);
    const after = sampleStyleGroup({ ...INITIAL_SAMPLE_STYLE_STATE, rasterAbove: false });
    expect(before.layers.map(layer => layer.id)).toEqual([
      'sample-background', 'sample-raster-below', 'sample-mvt-fill', 'sample-fill', 'sample-raster-overlay',
      'sample-mvt-pattern', 'sample-pattern', 'sample-outline',
      'sample-mvt-line', 'sample-line', 'sample-mvt-points', 'sample-points'
    ]);
    expect(after.layers.map(layer => layer.id)).toEqual([
      'sample-background', 'sample-raster-below', 'sample-raster-overlay', 'sample-mvt-fill', 'sample-fill',
      'sample-mvt-pattern', 'sample-pattern', 'sample-outline',
      'sample-mvt-line', 'sample-line', 'sample-mvt-points', 'sample-points'
    ]);
    expect(after.sources).toBe(before.sources);
  });

  it('变色修改面和点的分类配色，保持数据与原样式不变', () => {
    const before = sampleStyleGroup(INITIAL_SAMPLE_STYLE_STATE);
    const after = sampleStyleGroup({ ...INITIAL_SAMPLE_STYLE_STATE, alternateColors: true });
    expect(after.sources).toBe(before.sources);
    for (const [id, property] of [
      ['sample-fill', 'fill-color'], ['sample-points', 'circle-color'],
      ['sample-mvt-fill', 'fill-color'], ['sample-mvt-points', 'circle-color']
    ]) {
      expect(before.layers.find(layer => layer.id === id)?.paint).toMatchObject({
        [property]: ['match', ['get', 'category'], 'primary', '#597ef7', '#fa8c16']
      });
      expect(after.layers.find(layer => layer.id === id)?.paint).toMatchObject({
        [property]: ['match', ['get', 'category'], 'primary', '#13c2c2', '#eb2f96']
      });
    }
  });

  it('隐藏后只保留背景，重新显示仍按保存的颜色与层序推导', () => {
    const saved = { ...INITIAL_SAMPLE_STYLE_STATE, alternateColors: true, rasterAbove: false };
    const hidden = sampleStyleGroup({ ...saved, visible: false });
    expect(hidden.sources).toEqual({});
    expect(hidden.layers.map(layer => layer.id)).toEqual(['sample-background']);
    expect(sampleStyleGroup(saved).layers.find(layer => layer.id === 'sample-fill')).toMatchObject({ paint: {
      'fill-color': ['match', ['get', 'category'], 'primary', '#13c2c2', '#eb2f96']
    } });
  });

  it('本地 MVT 限定南京一张原生瓦片，保留来源层、孔洞、不同 extent 和提升身份', async () => {
    const group = sampleStyleGroup(INITIAL_SAMPLE_STYLE_STATE);
    const source = group.sources['sample-mvt'];
    expect(source).toMatchObject({
      type: 'vector', minzoom: 10, maxzoom: 10,
      bounds: [118.4765625, 31.952162238024968, 118.828125, 32.249974455863295],
      promoteId: { landuse: 'bsm', detail: 'guid' }
    });
    if (source.type !== 'vector' || !source.tiles?.[0]) {
      throw new Error('样例缺少本地 MVT 源');
    }
    expect(source.tiles[0]).toMatch(/^data:application\/vnd.mapbox-vector-tile;base64,/);
    const response = await fetch(source.tiles[0]);
    const tile = new VectorTile(new PbfReader(await response.arrayBuffer()));
    expect(Object.keys(tile.layers)).toEqual(['landuse', 'detail']);
    expect(tile.layers.landuse.extent).toBe(4096);
    expect(tile.layers.detail.extent).toBe(8192);
    expect(tile.layers.landuse.feature(0)).toMatchObject({ id: 11, properties: { bsm: 'area-primary' } });
    expect(tile.layers.landuse.feature(0).loadGeometry()).toHaveLength(2);
    expect(tile.layers.detail.feature(1)).toMatchObject({ id: 22, type: 1, properties: { guid: 'points-secondary' } });
    expect(group.layers.find(layer => layer.id === 'sample-mvt-fill')).toMatchObject({
      source: 'sample-mvt', 'source-layer': 'landuse', minzoom: 10,
      filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['in', ['id'], ['literal', ['area-primary', 'area-secondary']]]]
    });
  });

  it('花纹共享业务距离场并按级别和分类取图，描边与线型保持实际业务单位', () => {
    const group = sampleStyleGroup(INITIAL_SAMPLE_STYLE_STATE);
    expect(Object.keys(group.images ?? {})).toEqual([
      'sample-pattern-low', 'sample-pattern-medium', 'sample-pattern-high', 'sample-pattern-none'
    ]);
    expect(group.images?.['sample-pattern-medium']).toMatchObject({ width: 32, pixelRatio: 2, sdf: true });
    expect(group.layers.find(layer => layer.id === 'sample-pattern')).toMatchObject({ paint: {
      'fill-antialias': false,
      'fill-pattern': ['step', ['zoom'], ['match', ['get', 'category'], 'primary', 'sample-pattern-low', 'sample-pattern-none'],
        10, ['match', ['get', 'category'], 'primary', 'sample-pattern-medium', 'sample-pattern-none'],
        14, ['match', ['get', 'category'], 'primary', 'sample-pattern-high', 'sample-pattern-none']]
    } });
    expect(group.layers.find(layer => layer.id === 'sample-outline')).toMatchObject({ paint: {
      'line-width': 4, 'line-offset': 2, 'line-dasharray': [3, 2]
    } });
    expect(group.layers.find(layer => layer.id === 'sample-line')).toMatchObject({ paint: {
      'line-dasharray': [4, 2, 1, 2]
    } });
  });

  it('高亮、遮罩、边界和测量按实际业务分组提交，隐藏时跨分组引用一起移除', () => {
    using model = new StyleModel({ groups: ['sample', 'selection', 'region-clip', 'region', 'measure'] });
    const overlays = sampleOverlayGroups(INITIAL_SAMPLE_STYLE_STATE);
    model.setGroups({ sample: sampleStyleGroup(INITIAL_SAMPLE_STYLE_STATE), ...overlays });
    const ids = model.current.layers.map(layer => layer.id);
    expect(ids.indexOf('selection-batch-circle')).toBeLessThan(ids.indexOf('selection-fill'));
    expect(ids.indexOf('selection-circle')).toBeLessThan(ids.indexOf('region-clip-mask'));
    expect(ids.indexOf('region-clip-mask')).toBeLessThan(ids.indexOf('region-glow'));
    expect(ids.indexOf('region-line')).toBeLessThan(ids.indexOf('measure-line-drawing'));
    expect(overlays.selection.layers[2]).toMatchObject({ source: 'sample-mvt', 'source-layer': 'detail',
      filter: ['all', expect.any(Array), ['match', ['get', 'guid'], ['points-secondary'], true, false]] });
    expect(overlays['region-clip'].sources['region-clip']).toMatchObject({ data: {
      geometry: { type: 'MultiPolygon', coordinates: [expect.any(Array), expect.any(Array)] }
    } });
    const changed = sampleOverlayGroups({ ...INITIAL_SAMPLE_STYLE_STATE, alternateColors: true });
    expect(changed.selection.layers.find(layer => layer.id === 'selection-line')).toMatchObject({ paint: {
      'line-color': '#ff7875'
    } });
    const hidden = { ...INITIAL_SAMPLE_STYLE_STATE, visible: false };
    model.setGroups({ sample: sampleStyleGroup(hidden), ...sampleOverlayGroups(hidden) });
    expect(model.current.sources).toEqual({});
    expect(model.images).toEqual({});
    expect(model.current.layers.map(layer => layer.id)).toEqual(['sample-background']);
  });
});
