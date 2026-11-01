// @vitest-environment node
import type { MultiPolygon, Polygon } from 'geojson';
import { describe, expect, it } from 'vitest';
import type { RegionCover } from '@/shared/map/area/area-coverage';
import { box } from '../model/test-area';
import { areaGroup, coverGroup, coverPieces, districtEdges } from './scope-style';
import { thumbnailPath } from './thumbnail';

const square: Polygon = { type: 'Polygon', coordinates: [box(118, 32, 119, 33)] };
const area: MultiPolygon = { type: 'MultiPolygon', coordinates: [square.coordinates] };
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

  it('scope-area：范围是浅填充、白色衬底上的主色边线；悬停的区县描在最上', () => {
    expect(areaGroup(null, null).layers).toEqual([]);
    expect(areaGroup(area, null).layers.map(layer => layer.id)).toEqual([
      'scope-area-fill',
      'scope-area-casing',
      'scope-area-line'
    ]);
    const hovered = areaGroup(null, square);
    expect(hovered.layers.map(layer => layer.id)).toEqual(['scope-area-hover']);
    expect(Object.keys(hovered.sources)).toEqual(['scope-area-hover']);
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
