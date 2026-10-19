// @vitest-environment node
import type { GeoJSON } from 'geojson';
import { WebMercatorProjection } from 'cesium';
import { describe, expect, it, vi } from 'vitest';
import { createGeoJsonProvider, GeoJsonGeometryCache } from './geojson-provider';
import { compileStylePlan } from './style-plan';

// 验证几何和元数据不需要创建画布，实际像素另由浏览器测试覆盖
function provider(data: GeoJSON, zoom = 8, cache?: GeoJsonGeometryCache) {
  const plan = compileStylePlan({
    version: 8,
    sources: { data: { type: 'geojson', data, attribution: '本地测试数据' } },
    layers: [{ id: 'local', type: 'line', source: 'data' }]
  });
  return createGeoJsonProvider(plan.layers[0], zoom, cache);
}

describe('GeoJSON 影像准备', () => {
  it('同一不可变数据跨图层和相机级别共享投影，换数据对象后重新准备', () => {
    const data: GeoJSON = { type: 'LineString', coordinates: [[118, 32], [119, 32]] };
    using cache = new GeoJsonGeometryCache();
    const project = vi.spyOn(WebMercatorProjection.prototype, 'project');
    try {
      provider(data, 8, cache);
      provider(data, 9, cache);
      expect(project).toHaveBeenCalledTimes(2);
      provider({ type: 'LineString', coordinates: [[120, 33], [121, 33]] }, 8, cache);
      expect(project).toHaveBeenCalledTimes(4);
    } finally {
      project.mockRestore();
    }
  });

  it('投影缓存随视图释放，新视图重新准备仍被会话持有的数据', () => {
    const data: GeoJSON = { type: 'LineString', coordinates: [[118, 32], [119, 32]] };
    const previous = new GeoJsonGeometryCache();
    const shapes = previous.prepare(data);
    previous[Symbol.dispose]();
    expect(() => previous.prepare(data)).toThrow('投影缓存已释放');
    using next = new GeoJsonGeometryCache();
    expect(next.prepare(data)).not.toBe(shapes);
  });

  it('不相交的长路径不进入逐顶点绘制，不同空瓦片共享透明像素', async () => {
    const stroke = vi.fn<() => void>();
    // 只记录线绘制是否发生，真实画布的边缘像素另由浏览器测试覆盖
    const context = {
      canvas: { width: 512, height: 512 },
      save: vi.fn<() => void>(), restore: vi.fn<() => void>(), beginPath: vi.fn<() => void>(),
      setLineDash: vi.fn<(segments: number[]) => void>(), stroke
    };
    const createElement = vi.fn<() => { width: number; height: number; getContext: () => typeof context }>(
      () => ({ width: 0, height: 0, getContext: () => context })
    );
    vi.stubGlobal('document', { createElement });
    try {
      const imagery = provider({ type: 'LineString', coordinates: Array.from({ length: 1000 }, (_, index) => [
        118 + index / 10000, -32
      ]) });
      expect(imagery.maximumLevel).toBe(22);
      const first = await imagery.requestImage(0, 0, 1);
      const second = await imagery.requestImage(0, 1, 1);
      expect(stroke).not.toHaveBeenCalled();
      expect(first).toMatchObject({ width: 1, height: 1 });
      expect(second).toBe(first);
      expect(createElement).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('纯色背景只提供根级影像，不同位置与级别请求只分配和填充一个像素', async () => {
    const context = {
      fillStyle: '', globalAlpha: 1, save: vi.fn<() => void>(), restore: vi.fn<() => void>(),
      fillRect: vi.fn<(x: number, y: number, width: number, height: number) => void>()
    };
    const createElement = vi.fn<() => { width: number; height: number; getContext: () => typeof context }>(
      () => ({ width: 0, height: 0, getContext: () => context })
    );
    vi.stubGlobal('document', { createElement });
    try {
      const plan = compileStylePlan({ version: 8, sources: {}, layers: [{
        id: 'background', type: 'background',
        paint: { 'background-color': 'rgba(255,0,0,0.5)', 'background-opacity': 0.5 }
      }] });
      const imagery = createGeoJsonProvider(plan.layers[0], 8);
      expect(imagery.maximumLevel).toBe(0);
      expect(imagery.tileWidth).toBe(512);
      const first = await imagery.requestImage(0, 0, 0);
      const second = await imagery.requestImage(1, 0, 0);
      const descendant = await imagery.requestImage(2, 1, 1);
      expect(first).toMatchObject({ width: 1, height: 1 });
      expect(createElement).toHaveBeenCalledOnce();
      expect(context.fillRect).toHaveBeenCalledOnce();
      expect(second).toBe(first);
      expect(descendant).toBe(first);
      expect(context.globalAlpha).toBe(0.5);
    } finally {
      vi.unstubAllGlobals();
    }
  });

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
    expect(imagery.maximumLevel).toBe(0);
    expect(imagery.tilingScheme.getNumberOfXTilesAtLevel(0)).toBe(1);
    expect(imagery.pickFeatures(0, 0, 0, 0, 0)).toBeUndefined();
  });
});
