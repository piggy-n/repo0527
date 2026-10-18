// @vitest-environment node
import { Color, type Feature, type FilterSpecification } from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';
import { compileStyleFilter, compileStyleProperty } from './style-expression';

// 要素身份、几何类型和属性由镜像的 GeoJSON 转换层提供
const FEATURE: Feature = { id: 7, type: 'Polygon', properties: { category: 'water', size: 4 } };

describe('三维基础样式表达式', () => {
  it('常量、规范默认值和可选属性保持规范库结果', () => {
    const color = compileStyleProperty('fill', 'fill-color', '#ff000080');
    expect(color.zoomDependent).toBe(false);
    expect(color.evaluate(5)).toEqual(Color.parse('#ff000080'));
    expect(compileStyleProperty('line', 'line-width', undefined).evaluate(0)).toBe(1);
    expect(compileStyleProperty('fill', 'fill-outline-color', undefined).evaluate(0)).toBeUndefined();
    expect(compileStyleProperty('line', 'line-cap', undefined).evaluate(0)).toBe('butt');
    expect(compileStyleProperty('line', 'line-dasharray', [2, 3]).evaluate(0)).toEqual([2, 3]);
  });

  it('get、match 和 geometry-type 使用当前要素', () => {
    const width = compileStyleProperty('line', 'line-width', ['*', ['get', 'size'], 2]);
    const color = compileStyleProperty('fill', 'fill-color', [
      'match', ['get', 'category'], 'water', '#0066ff', '#ff0000'
    ]);
    const opacity = compileStyleProperty('fill', 'fill-opacity', [
      'case', ['==', ['geometry-type'], 'Polygon'], 0.5, 1
    ]);
    expect(width.zoomDependent).toBe(false);
    expect(width.evaluate(10, FEATURE)).toBe(8);
    expect(color.evaluate(10, FEATURE)).toEqual(Color.parse('#0066ff'));
    expect(color.evaluate(10, { ...FEATURE, properties: { category: 'road' } })).toEqual(Color.parse('#ff0000'));
    expect(opacity.evaluate(10, FEATURE)).toBe(0.5);
    expect(opacity.evaluate(10, { ...FEATURE, type: 'LineString' })).toBe(1);
  });

  it('zoom 插值、step 和混合属性按每次级别重新求值', () => {
    const interpolated = compileStyleProperty('line', 'line-width', [
      'interpolate', ['linear'], ['zoom'], 4, 2, 8, 6
    ]);
    const stepped = compileStyleProperty('circle', 'circle-radius', ['step', ['zoom'], 2, 10, 8]);
    const composite = compileStyleProperty('line', 'line-width', [
      'interpolate', ['linear'], ['zoom'], 4, ['get', 'size'], 8, ['*', ['get', 'size'], 2]
    ]);
    expect(interpolated.zoomDependent).toBe(true);
    expect(interpolated.evaluate(6)).toBe(4);
    expect(stepped.zoomDependent).toBe(true);
    expect(stepped.evaluate(9)).toBe(2);
    expect(stepped.evaluate(10)).toBe(8);
    expect(composite.zoomDependent).toBe(true);
    expect(composite.evaluate(6, FEATURE)).toBe(6);
  });

  it('literal 内容和 match 标签不是上下文表达式', () => {
    const literal = compileStyleProperty('line', 'line-width', ['length', ['literal', ['zoom', 'image']]]);
    const match = compileStyleProperty('line', 'line-width', [
      'match', ['get', 'category'], ['image', 'feature-state'], 2, 1
    ]);
    expect(literal.zoomDependent).toBe(false);
    expect(literal.evaluate(10)).toBe(2);
    expect(match.evaluate(10, { ...FEATURE, properties: { category: 'image' } })).toBe(2);
  });

  it('拒绝未知属性、编译错误和不符合属性规范的表达式', () => {
    expect(() => compileStyleProperty('fill', 'line-width', 2)).toThrow('未知样式属性');
    expect(() => compileStyleProperty('line', 'line-width', ['+', 1, 'bad'])).toThrow('line.line-width');
    expect(() => compileStyleProperty('line', 'line-width', 'bad')).toThrow('Expected number');
    expect(() => compileStyleProperty('raster', 'raster-opacity', ['get', 'size'])).toThrow('data expressions');
    expect(() => compileStyleProperty('line', 'line-width', ['+', ['zoom'], 1])).toThrow('top-level');
  });

  it.each(['feature-state', 'global-state', 'image', 'line-progress', 'heatmap-density', 'elevation', 'accumulated'])(
    '明确拒绝缺少输入的 %s 表达式',
    operator => {
      expect(() => compileStyleProperty('fill', 'fill-opacity', ['coalesce', [operator, 'value'], 1]))
        .toThrow(`暂不支持 ${operator} 表达式`);
    }
  );

  it('拒绝需要瓦片几何的属性表达式', () => {
    expect(() => compileStyleProperty('line', 'line-width', [
      'distance', { type: 'Point', coordinates: [118, 32] }
    ])).toThrow('需要瓦片几何');
  });

  it('semiliteral 中的首个表达式也检查缺失上下文', () => {
    expect(() => compileStyleProperty('line', 'line-dasharray', [
      'semiliteral', [['global-state', 'dash'], 2]
    ])).toThrow('global-state');
    expect(compileStyleProperty('line', 'line-width', [
      'length', ['semiliteral', ['global-state', 'image']]
    ]).evaluate(0)).toBe(2);
  });
});

describe('三维基础样式过滤', () => {
  it('默认不过滤，表达式同时按属性、几何类型和身份过滤', () => {
    const filter = compileStyleFilter([
      'all',
      ['==', ['get', 'category'], 'water'],
      ['==', ['geometry-type'], 'Polygon'],
      ['==', ['id'], 7]
    ], 'water');
    expect(compileStyleFilter(undefined, 'all').test(10, FEATURE)).toBe(true);
    expect(filter.zoomDependent).toBe(false);
    expect(filter.test(10, FEATURE)).toBe(true);
    expect(filter.test(10, { ...FEATURE, id: 8 })).toBe(false);
    expect(filter.test(10, { ...FEATURE, type: 'LineString' })).toBe(false);
    expect(filter.test(10, { ...FEATURE, properties: { category: 'road' } })).toBe(false);
  });

  it('兼容旧式身份过滤，并区分级别条件和 literal 数据', () => {
    const legacy = compileStyleFilter(['==', '$id', 7], 'legacy');
    const zoom = compileStyleFilter(['>=', ['zoom'], 8], 'zoom');
    const literal = compileStyleFilter(['in', ['get', 'category'], ['literal', ['zoom', 'image']]], 'literal');
    expect(legacy.test(0, FEATURE)).toBe(true);
    expect(legacy.test(0, { ...FEATURE, id: 9 })).toBe(false);
    expect(zoom.zoomDependent).toBe(true);
    expect(zoom.test(7, FEATURE)).toBe(false);
    expect(zoom.test(8, FEATURE)).toBe(true);
    expect(literal.zoomDependent).toBe(false);
    expect(literal.test(0, { ...FEATURE, properties: { category: 'zoom' } })).toBe(true);
  });

  it('错误过滤器和未提供上下文不会变成静默的不匹配', () => {
    expect(() => compileStyleFilter(['==', ['get', 'x']] as unknown as FilterSpecification, 'broken'))
      .toThrow('Expected two or three arguments');
    expect(() => compileStyleFilter(['==', ['feature-state', 'selected'], true], 'selection'))
      .toThrow('selection.filter');
    expect(() => compileStyleFilter(['==', ['global-state', 'year'], 2024], 'year'))
      .toThrow('global-state');
    expect(() => compileStyleFilter(['within', {
      type: 'Polygon', coordinates: [[[118, 32], [119, 32], [119, 33], [118, 32]]]
    }], 'region')).toThrow('需要瓦片几何');
  });
});
