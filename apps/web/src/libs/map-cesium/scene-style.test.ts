// @vitest-environment node
import type { LayerSpecification, SourceSpecification, StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';
import { planSceneStyle } from './scene-style';

function style(sources: Record<string, SourceSpecification>, layers: LayerSpecification[]): StyleSpecification {
  return { version: 8, sources, layers };
}

const raster = (tiles: string[], extra: Partial<Extract<SourceSpecification, { type: 'raster' }>> = {}) =>
  ({ type: 'raster', tiles, tileSize: 256, minzoom: 1, maxzoom: 18, ...extra }) as const;

describe('planSceneStyle', () => {
  it('raster 图层按样式里的顺序变成影像图层，带上透明度、显隐、瓦片尺寸和级别范围', () => {
    const plan = planSceneStyle(
      style(
        {
          base: raster(['https://t0.cn/{z}/{x}/{y}', 'https://t1.cn/{z}/{x}/{y}']),
          labels: raster(['https://labels.cn/{z}/{x}/{y}'], { tileSize: 512, minzoom: undefined, maxzoom: undefined })
        },
        [
          { id: 'base', type: 'raster', source: 'base', paint: { 'raster-opacity': 0.6 } },
          { id: 'labels', type: 'raster', source: 'labels', layout: { visibility: 'none' } }
        ]
      )
    );

    expect(plan.imagery).toStrictEqual([
      {
        id: 'base',
        sourceId: 'base',
        url: 'https://t{s}.cn/{z}/{x}/{y}',
        subdomains: ['0', '1'],
        tileSize: 256,
        minimumLevel: 1,
        maximumLevel: 18,
        opacity: 0.6,
        show: true
      },
      {
        id: 'labels',
        sourceId: 'labels',
        url: 'https://labels.cn/{z}/{x}/{y}',
        subdomains: [],
        tileSize: 512,
        minimumLevel: 0,
        maximumLevel: 22,
        opacity: 1,
        show: false
      }
    ]);
    expect(plan.unsupported).toStrictEqual([]);
  });

  it('background 图层的颜色是地球底色；隐藏时不算，后面的覆盖前面的', () => {
    const plan = planSceneStyle(
      style({}, [
        { id: 'a', type: 'background', paint: { 'background-color': '#f3f5f8' } },
        { id: 'b', type: 'background', layout: { visibility: 'none' }, paint: { 'background-color': '#000' } },
        { id: 'c', type: 'background', paint: { 'background-color': '#dfe7f2' } }
      ])
    );

    expect(plan.baseColor).toBe('#dfe7f2');
    expect(planSceneStyle(style({}, [])).baseColor).toBeNull();
  });

  it('矢量瓦片、GeoJSON 的图层和清单外的写法列为不支持并说明原因，不进入影像', () => {
    const plan = planSceneStyle(
      style(
        {
          tiles: { type: 'vector', tiles: ['https://mvt.cn/{z}/{x}/{y}'] },
          shapes: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
          tilejson: { type: 'raster', url: 'https://tiles.cn/tiles.json' },
          quadkey: raster(['https://tiles.cn/{quadkey}']),
          base: raster(['https://tiles.cn/{z}/{x}/{y}'])
        },
        [
          { id: 'landuse', type: 'fill', source: 'tiles', 'source-layer': 'dltb' },
          { id: 'boundary', type: 'line', source: 'shapes' },
          { id: 'from-tilejson', type: 'raster', source: 'tilejson' },
          { id: 'by-quadkey', type: 'raster', source: 'quadkey' },
          { id: 'zoomed', type: 'raster', source: 'base', minzoom: 10 },
          { id: 'expression', type: 'raster', source: 'base', paint: { 'raster-opacity': ['get', 'a'] } },
          { id: 'dynamic-color', type: 'background', paint: { 'background-color': ['rgb', 1, 2, 3] } }
        ]
      )
    );

    expect(plan.imagery).toStrictEqual([]);
    expect(plan.unsupported).toStrictEqual([
      { layerId: 'landuse', reason: '矢量瓦片（MVT）本阶段不在三维显示' },
      { layerId: 'boundary', reason: '三维暂不支持 line 图层' },
      { layerId: 'from-tilejson', reason: '三维只支持直接给出 tiles 的 xyz 瓦片' },
      { layerId: 'by-quadkey', reason: '瓦片地址里有三维不支持的占位符' },
      { layerId: 'zoomed', reason: '三维不支持图层的级别范围' },
      { layerId: 'expression', reason: 'raster-opacity 不是常量' },
      { layerId: 'dynamic-color', reason: 'background-color 不是常量' }
    ]);
  });
});
