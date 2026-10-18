// @vitest-environment node
import type { GeoJSON } from 'geojson';
import { describe, expect, it } from 'vitest';
import { createGeoJsonProvider } from './geojson-provider';
import { compileStylePlan } from './style-plan';

// 验证几何和元数据不需要创建画布，实际像素另由浏览器测试覆盖
function provider(data: GeoJSON) {
  const plan = compileStylePlan({
    version: 8,
    sources: { data: { type: 'geojson', data, attribution: '本地测试数据' } },
    layers: [{ id: 'local', type: 'line', source: 'data' }]
  });
  return createGeoJsonProvider(plan.layers[0], 8);
}

describe('GeoJSON 影像准备', () => {
  it('跨经线、世界遮罩和极区数据明确失败，不静默变成局部图形', () => {
    expect(() => provider({ type: 'LineString', coordinates: [[179, 0], [-179, 0]] })).toThrow('跨 180°');
    expect(() => provider({
      type: 'Polygon', coordinates: [[[-180, -80], [180, -80], [180, 80], [-180, -80]]]
    })).toThrow('世界遮罩');
    expect(() => provider({ type: 'LineString', coordinates: [[0, 80], [0, 90]] })).toThrow('Web Mercator');
  });

  it('拒绝非有限坐标、短路径和未闭合的多边形', () => {
    expect(() => provider({ type: 'Point', coordinates: [NaN, 0] })).toThrow('有限经纬度');
    expect(() => provider({ type: 'LineString', coordinates: [[118, 32]] })).toThrow('坐标数量不足');
    expect(() => provider({
      type: 'Polygon', coordinates: [[[118, 32], [119, 32], [119, 33], [118, 33]]]
    })).toThrow('闭合环');
  });

  it('空要素和空几何集合可准备，提供者保留署名和透明瓦片契约', () => {
    // GeoJSON 允许 null geometry，当前包的 GeoJSON 联合类型未包含这一分支
    const imagery = provider({ type: 'FeatureCollection', features: [
      { type: 'Feature', properties: null, geometry: null },
      { type: 'Feature', properties: null, geometry: { type: 'GeometryCollection', geometries: [] } }
    ] } as unknown as GeoJSON);
    expect(imagery.credit.html).toBe('本地测试数据');
    expect(imagery.hasAlphaChannel).toBe(true);
    expect(imagery.tileWidth).toBe(512);
    expect(imagery.tileHeight).toBe(512);
    expect(imagery.tilingScheme.getNumberOfXTilesAtLevel(0)).toBe(1);
    expect(imagery.pickFeatures(0, 0, 0, 0, 0)).toBeUndefined();
  });
});
