// @vitest-environment node
import type { StyleGroup } from '@yzt/map-core';
import type { MultiPolygon, Polygon } from 'geojson';
import { describe, expect, it } from 'vitest';
import type { RegionCover } from '@/shared/map/area/area-coverage';
import { boundarySwatch } from '@/shared/map/boundary/boundary-style';
import { box } from '../model/test-area';
import { areaGroup, areaShape, coverGroup, coverPieces, districtEdges } from './scope-style';
import { thumbnailPath } from './thumbnail';

const square: Polygon = { type: 'Polygon', coordinates: [box(118, 32, 119, 33)] };
const area: MultiPolygon = { type: 'MultiPolygon', coordinates: [square.coordinates] };
// 行政区边界的主题色：县界的颜色、省界的深色
const boundaryColor = boundarySwatch('county')[0]?.color.toLowerCase();
const themeColor = boundarySwatch('province').at(-1)?.color.toLowerCase();

// 一个线图层的颜色，统一成小写再比
const lineColor = (group: StyleGroup, id: string) => {
  const layer = group.layers.find(item => item.id === id);
  const color = layer?.type === 'line' ? layer.paint?.['line-color'] : undefined;
  return typeof color === 'string' ? color.toLowerCase() : color;
};
const cover = (code: string, relation: RegionCover['relation']): RegionCover => ({
  code,
  relation,
  area: 1,
  ratio: relation === 'full' ? 1 : 0.5,
  geometry: square
});

describe('范围弹窗的样式分组', () => {
  it('scope-cover：弹窗关着时为空；打开时有区县分界线，分析完成后多一层按覆盖方式着色的填充（只给面）', () => {
    expect(coverGroup(null, null).layers).toEqual([]);
    const edges = districtEdges([square]);
    expect(coverGroup(edges, null).layers.map(layer => layer.id)).toEqual(['scope-cover-edge']);
    const pieces = coverPieces([cover('320104', 'full'), cover('320115', 'partial')]);
    expect(pieces.features.map(feature => feature.properties.full)).toEqual([true, false]);
    const group = coverGroup(edges, pieces);
    expect(group.layers.map(layer => layer.id)).toEqual(['scope-cover-fill', 'scope-cover-edge']);
    expect(group.layers[0]).toMatchObject({
      type: 'fill',
      filter: ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false]
    });
  });

  it('scope-area：范围外面压暗，范围是白色衬底上的深色边线', () => {
    expect(areaGroup(null, null).layers).toEqual([]);
    const shape = areaShape(area);
    const group = areaGroup(shape, null);
    expect(group.layers.map(layer => layer.id)).toEqual(['scope-area-mask', 'scope-area-casing', 'scope-area-line']);
    expect(lineColor(group, 'scope-area-line')).toBe(themeColor);
    expect(group.sources['scope-area-mask']).toMatchObject({ data: shape.mask });
    expect(group.sources['scope-area-shape']).toMatchObject({ data: area });
    // 遮罩是整个世界挖掉范围：第一个面的外环是世界，范围的环是洞
    const [world] = shape.mask.coordinates;
    expect(world?.[0]?.[0]).toEqual([-180, -85.051129]);
    expect(world?.[1]).toHaveLength(area.coordinates[0]?.[0]?.length ?? 0);
  });

  it('悬停：填充和边线都用主题色、描在最上，只有悬停的部分', () => {
    const hovered = areaGroup(null, square);
    expect(hovered.layers.map(layer => layer.id)).toEqual([
      'scope-area-hover-fill',
      'scope-area-hover-casing',
      'scope-area-hover-line'
    ]);
    expect(Object.keys(hovered.sources)).toEqual(['scope-area-hover']);
    expect(hovered.sources['scope-area-hover']).toMatchObject({ data: square });
    expect(lineColor(hovered, 'scope-area-hover-line')).toBe(themeColor);
    const both = areaGroup(areaShape(area), square).layers.map(layer => layer.id);
    expect(both.indexOf('scope-area-hover-line')).toBeGreaterThan(both.indexOf('scope-area-line'));
  });

  it('区县的分界线用行政区边界的主题色', () => {
    expect(lineColor(coverGroup(districtEdges([square]), null), 'scope-cover-edge')).toBe(boundaryColor);
  });
});

describe('缩略图', () => {
  it('按外包框缩放到方框里，北在上，留一圈边；每个环一段', () => {
    const path = thumbnailPath(area, 100);
    // 纬度 32°～33°占满除去边的 76 像素，经度按中心纬度压缩
    expect(path.startsWith('M')).toBe(true);
    expect(path.endsWith('Z')).toBe(true);
    const ys = [...path.matchAll(/,(-?[\d.]+)/g)].map(match => Number(match[1]));
    expect(Math.min(...ys)).toBeCloseTo(12);
    expect(Math.max(...ys)).toBeCloseTo(88);

    const two: MultiPolygon = {
      type: 'MultiPolygon',
      coordinates: [[box(118, 32, 118.2, 32.2)], [box(119, 33, 119.2, 33.2)]]
    };
    expect(thumbnailPath(two, 44).match(/M/g)).toHaveLength(2);
    expect(thumbnailPath({ type: 'MultiPolygon', coordinates: [] }, 44)).toBe('');
  });
});
