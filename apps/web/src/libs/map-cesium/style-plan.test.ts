// @vitest-environment node
import {
  Color,
  type Feature,
  type GeoJSONSourceSpecification,
  type LayerSpecification,
  type SourceSpecification,
  type StyleSpecification
} from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';
import { compileStylePlan } from './style-plan';

const DATA: GeoJSONSourceSpecification = {
  type: 'geojson', data: { type: 'FeatureCollection', features: [] }
};
const FEATURE: Feature = { id: 1, type: 'Polygon', properties: { category: 'water', width: 3 } };

// 每个计划使用独立样式快照，数据源原引用用于验证替换行为
function style(layers: LayerSpecification[], source: SourceSpecification = DATA): StyleSpecification {
  return { version: 8, sources: { data: source }, layers };
}

describe('三维基础样式计划', () => {
  it('按会话顺序保留支持的图层、来源与图层对象身份', () => {
    const source: SourceSpecification = { type: 'raster', tiles: ['/tiles/{z}/{x}/{y}.png'] };
    const snapshot: StyleSpecification = {
      version: 8,
      sources: { data: DATA, image: source },
      layers: [
        { id: 'ground', type: 'background' },
        { id: 'image', type: 'raster', source: 'image' },
        { id: 'area', type: 'fill', source: 'data' },
        { id: 'edge', type: 'line', source: 'data' },
        { id: 'point', type: 'circle', source: 'data' }
      ]
    };
    const plan = compileStylePlan(snapshot);
    expect(plan.issues).toEqual([]);
    expect(plan.layers.map(layer => layer.id)).toEqual(['ground', 'image', 'area', 'edge', 'point']);
    expect(plan.layers[0].source).toBeUndefined();
    expect(plan.layers[1].source).toBe(source);
    expect(plan.layers[2].source).toBe(DATA);
    expect(plan.layers[2].sourceId).toBe('data');
    expect(plan.layers[2].specification).toBe(snapshot.layers[2]);
  });

  it('显隐保留小数级别并使用左闭右开边界', () => {
    const plan = compileStylePlan(style([
      { id: 'bounded', type: 'fill', source: 'data', minzoom: 4.5, maxzoom: 8.25 },
      { id: 'hidden', type: 'fill', source: 'data', layout: { visibility: 'none' } },
      { id: 'visible', type: 'fill', source: 'data' }
    ]));
    const [bounded, hidden, visible] = plan.layers;
    expect(bounded.zoomDependent).toBe(true);
    expect(bounded.visible(4.49)).toBe(false);
    expect(bounded.visible(4.5)).toBe(true);
    expect(bounded.visible(8.249)).toBe(true);
    expect(bounded.visible(8.25)).toBe(false);
    expect(hidden.visible(6)).toBe(false);
    expect(hidden.zoomDependent).toBe(false);
    expect(visible.visible(0)).toBe(true);
    expect(visible.visible(24)).toBe(true);
  });

  it('空级别区间始终隐藏，来源最高级别不限制图层继续显示', () => {
    const empty = compileStylePlan(style([
      { id: 'empty', type: 'fill', source: 'data', minzoom: 8, maxzoom: 8 }
    ])).layers[0];
    expect([7.9, 8, 8.1].map(zoom => empty.visible(zoom))).toEqual([false, false, false]);
    const raster = compileStylePlan(style([
      { id: 'image', type: 'raster', source: 'data' }
    ], { type: 'raster', tiles: ['/tiles/{z}/{x}/{y}.png'], maxzoom: 8 })).layers[0];
    expect(raster.visible(12)).toBe(true);
    expect(raster.zoomDependent).toBe(false);
  });

  it('默认样式、get、match、过滤条件和布局沿用同一规范库', () => {
    const { layers, issues } = compileStylePlan(style([
      {
        id: 'area', type: 'fill', source: 'data',
        paint: { 'fill-color': ['match', ['get', 'category'], 'water', 'blue', 'red'] },
        filter: ['==', ['id'], 1]
      },
      {
        id: 'edge', type: 'line', source: 'data',
        paint: { 'line-width': ['get', 'width'] },
        layout: { 'line-cap': 'round', 'line-join': 'bevel' }
      },
      {
        id: 'zoom', type: 'circle', source: 'data',
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 2, 8, 6] }
      }
    ]));
    expect(issues).toEqual([]);
    expect(layers[0].value('fill-color', 6, FEATURE)).toEqual(Color.parse('blue'));
    expect(layers[0].value('fill-opacity', 6, FEATURE)).toBe(1);
    expect(layers[0].value('fill-outline-color', 6, FEATURE)).toBeUndefined();
    expect(layers[0].value('fill-antialias', 6, FEATURE)).toBe(true);
    expect(layers[0].accepts(6, FEATURE)).toBe(true);
    expect(layers[0].accepts(6, { ...FEATURE, id: 2 })).toBe(false);
    expect(layers[0].zoomDependent).toBe(false);
    expect(layers[1].value('line-width', 6, FEATURE)).toBe(3);
    expect(layers[1].value('line-cap', 6, FEATURE)).toBe('round');
    expect(layers[1].value('line-join', 6, FEATURE)).toBe('bevel');
    expect(layers[1].value('line-miter-limit', 6, FEATURE)).toBe(2);
    expect(layers[2].value('circle-radius', 6, FEATURE)).toBe(4);
    expect(layers[2].zoomDependent).toBe(true);
  });

  it('替换数据源后使用新引用，旧计划保留旧快照', () => {
    const layer: LayerSpecification = { id: 'area', type: 'fill', source: 'data' };
    const replacement: GeoJSONSourceSpecification = {
      type: 'geojson', data: { type: 'Point', coordinates: [118, 32] }
    };
    const previous = compileStylePlan(style([layer]));
    const next = compileStylePlan(style([layer], replacement));
    expect(previous.layers[0].source).toBe(DATA);
    expect(next.layers[0].source).toBe(replacement);
    expect(next.layers[0].specification).toBe(previous.layers[0].specification);
  });

  it('无法表达的抗锯齿关闭和圆连接阈值不静默接受', () => {
    const plan = compileStylePlan(style([
      { id: 'smooth', type: 'fill', source: 'data', paint: { 'fill-antialias': true } },
      { id: 'hard', type: 'fill', source: 'data', paint: { 'fill-antialias': false } },
      { id: 'round-limit', type: 'line', source: 'data', layout: { 'line-round-limit': 1.5 } }
    ]));
    expect(plan.layers.map(layer => layer.id)).toEqual(['smooth']);
    expect(plan.issues.map(issue => issue.layerId)).toEqual(['hard', 'round-limit']);
  });

  it('不支持的类型、属性和编译失败逐层隔离，不改画成另一种样式', () => {
    const { layers, issues } = compileStylePlan(style([
      { id: 'valid-before', type: 'background' },
      { id: 'label', type: 'symbol', source: 'data' },
      { id: 'dash', type: 'line', source: 'data', paint: { 'line-dasharray': [2, 2] } },
      { id: 'pattern', type: 'fill', source: 'data', paint: { 'fill-pattern': 'stripe' } },
      { id: 'sort', type: 'fill', source: 'data', layout: { 'fill-sort-key': 1 } },
      {
        id: 'expression', type: 'fill', source: 'data', paint: { 'fill-opacity': ['+', 1, 'bad'] }
      } as unknown as LayerSpecification,
      { id: 'filter', type: 'fill', source: 'data', filter: ['==', ['global-state', 'year'], 2024] },
      { id: 'visible', type: 'fill', source: 'data', layout: { visibility: ['literal', 'visible'] } },
      { id: 'valid-after', type: 'line', source: 'data' }
    ]));
    expect(layers.map(layer => layer.id)).toEqual(['valid-before', 'valid-after']);
    expect(issues.map(issue => issue.layerId)).toEqual(['label', 'dash', 'pattern', 'sort', 'expression', 'filter', 'visible']);
    expect(issues.every(issue => issue.error instanceof Error)).toBe(true);
    expect(issues[1].error.message).toContain('line-dasharray');
    expect(issues[3].error.message).toContain('fill-sort-key');
  });

  it.each([
    ['cluster', { ...DATA, cluster: false }],
    ['promoteId', { ...DATA, promoteId: 'id' }],
    ['generateId', { ...DATA, generateId: true }],
    ['filter', { ...DATA, filter: ['has', 'name'] }],
    ['tolerance', { ...DATA, tolerance: 0 }],
    ['url', { type: 'raster', url: '/tiles.json' }],
    ['volatile', { type: 'raster', tiles: ['/tile.png'], volatile: true }]
  ])('未实现的来源选项 %s 明确报告', (option, source) => {
    const layer: LayerSpecification = {
      id: 'source-option', type: source.type === 'raster' ? 'raster' : 'fill', source: 'data'
    };
    const plan = compileStylePlan(style([layer], source as SourceSpecification));
    expect(plan.layers).toEqual([]);
    expect(plan.issues[0].error.message).toContain(option);
  });

  it('拒绝 URL GeoJSON、矢量瓦片、来源缺失、不匹配和 source-layer', () => {
    const snapshots: StyleSpecification[] = [
      style([{ id: 'url', type: 'fill', source: 'data' }], { type: 'geojson', data: '/data.json' }),
      style([{ id: 'vector', type: 'fill', source: 'data' }], { type: 'vector', tiles: ['/data.pbf'] }),
      style([{ id: 'missing', type: 'fill', source: 'absent' }]),
      style([{ id: 'mismatch', type: 'raster', source: 'data' }]),
      style([{ id: 'source-layer', type: 'fill', source: 'data', 'source-layer': 'land' }])
    ];
    expect(snapshots.map(snapshot => compileStylePlan(snapshot).layers.length)).toEqual([0, 0, 0, 0, 0]);
    expect(snapshots.map(snapshot => compileStylePlan(snapshot).issues[0].layerId))
      .toEqual(['url', 'vector', 'missing', 'mismatch', 'source-layer']);
  });

  it('只忽略合法且显式关闭动画的过渡属性', () => {
    const { layers, issues } = compileStylePlan(style([
      { id: 'off', type: 'fill', source: 'data', paint: { 'fill-opacity-transition': { duration: 0 } } },
      { id: 'both-off', type: 'fill', source: 'data', paint: { 'fill-color-transition': { duration: 0, delay: 0 } } },
      { id: 'duration', type: 'fill', source: 'data', paint: { 'fill-opacity-transition': { duration: 100 } } },
      { id: 'delay', type: 'fill', source: 'data', paint: { 'fill-opacity-transition': { duration: 0, delay: 100 } } },
      { id: 'default', type: 'fill', source: 'data', paint: { 'fill-opacity-transition': {} } },
      { id: 'unknown', type: 'fill', source: 'data', paint: { 'unknown-transition': { duration: 0 } } } as LayerSpecification
    ]));
    expect(layers.map(layer => layer.id)).toEqual(['off', 'both-off']);
    expect(issues.map(issue => issue.layerId)).toEqual(['duration', 'delay', 'default', 'unknown']);
  });

  it('过滤器依赖级别也触发重绘，非法范围独立报告', () => {
    const plan = compileStylePlan(style([
      { id: 'filter-zoom', type: 'fill', source: 'data', filter: ['>=', ['zoom'], 6] },
      { id: 'range', type: 'fill', source: 'data', minzoom: 10, maxzoom: 5 }
    ]));
    expect(plan.layers[0].zoomDependent).toBe(true);
    expect(plan.layers[0].accepts(5.9, FEATURE)).toBe(false);
    expect(plan.layers[0].accepts(6, FEATURE)).toBe(true);
    expect(plan.issues[0].layerId).toBe('range');
  });
});
