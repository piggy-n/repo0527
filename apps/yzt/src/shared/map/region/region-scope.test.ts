// @vitest-environment node
import { bbox } from '@turf/bbox';
import { intersect } from '@turf/intersect';
import type { LineString, MultiPolygon, Polygon, Position } from 'geojson';
import { describe, expect, it } from 'vitest';
import cityFile from '../boundary/data/jiangsu-city.json?raw';
import { clipToScope, intersectsScope, type RegionScope, scopeContains } from './region-scope';

function square(x: number, y: number, size: number): Position[] {
  return [
    [x, y],
    [x + size, y],
    [x + size, y + size],
    [x, y + size],
    [x, y]
  ];
}

const box = (x: number, y: number, size: number): Polygon => ({ type: 'Polygon', coordinates: [square(x, y, size)] });

// 10 × 10 的区划，中间有 2 × 2 的洞
const SCOPE: Polygon = { type: 'Polygon', coordinates: [square(0, 0, 10), square(4, 4, 2)] };

const TWO_PARTS: MultiPolygon = { type: 'MultiPolygon', coordinates: [[square(0, 0, 2)], [square(4, 0, 2)]] };

describe('区划范围', () => {
  it('点在区划里：边界上的算，洞里和外面的不算', () => {
    expect(scopeContains(SCOPE, [1, 1])).toBe(true);
    expect(scopeContains(SCOPE, [0, 5])).toBe(true);
    expect(scopeContains(SCOPE, [5, 5])).toBe(false);
    expect(scopeContains(SCOPE, [11, 5])).toBe(false);
  });

  it('框整个在区划里时求交结果就是框，跨过边界时只留区划里的部分', () => {
    const inside = clipToScope(box(1, 1, 2), SCOPE);
    expect(inside?.type).toBe('Polygon');
    expect(inside && bbox(inside)).toStrictEqual([1, 1, 3, 3]);

    const partial = clipToScope(box(8, 8, 4), SCOPE);
    expect(partial && bbox(partial)).toStrictEqual([8, 8, 10, 10]);
  });

  it('框盖住区划的洞时，洞仍在求交结果里挖掉；跨过两个部分时是 MultiPolygon', () => {
    const covering = clipToScope(box(3, 3, 4), SCOPE);
    expect(covering?.type).toBe('Polygon');
    expect(scopeContains(covering ?? box(0, 0, 0), [5, 5])).toBe(false);
    expect(scopeContains(covering ?? box(0, 0, 0), [3.5, 3.5])).toBe(true);

    expect(clipToScope(box(1, 1, 4), TWO_PARTS)?.type).toBe('MultiPolygon');
  });

  it('区划有一部分整个在框外时不出错，只留框里的部分', () => {
    expect(() => clipToScope(box(0.5, 0.5, 1), TWO_PARTS)).not.toThrow();
    const inside = clipToScope(box(0.5, 0.5, 1), TWO_PARTS);
    expect(inside && bbox(inside)).toStrictEqual([0.5, 0.5, 1.5, 1.5]);
  });

  it('不相交或只相接时没有交集', () => {
    expect(clipToScope(box(20, 20, 2), SCOPE)).toBeNull();
    expect(clipToScope(box(10, 0, 2), SCOPE)).toBeNull();
    expect(clipToScope(box(4.5, 4.5, 1), SCOPE)).toBeNull();
  });

  it('要素的几何和范围相交：穿过边界的线、盖住范围的面、边界上的点都算，范围外和洞里的不算', () => {
    const crossing: LineString = { type: 'LineString', coordinates: [[-5, 5], [1, 5]] };
    const outside: LineString = { type: 'LineString', coordinates: [[-5, 5], [-1, 5]] };

    expect(intersectsScope(crossing, SCOPE)).toBe(true);
    expect(intersectsScope(outside, SCOPE)).toBe(false);
    expect(intersectsScope(box(-5, -5, 30), SCOPE)).toBe(true);
    expect(intersectsScope({ type: 'Point', coordinates: [10, 3] }, SCOPE)).toBe(true);
    expect(intersectsScope({ type: 'Point', coordinates: [5, 5] }, SCOPE)).toBe(false);
  });
});

// 市界里某个市的几何
function cityGeometry(code: string): RegionScope {
  const { features } = JSON.parse(cityFile) as { features: { properties: { code: string }; geometry: RegionScope }[] };
  const feature = features.find(({ properties }) => properties.code.startsWith(code));
  if (!feature) {
    throw new Error(`市界里没有 ${code}`);
  }
  return feature.geometry;
}

// 坐标保留 9 位小数后排序，比较两个几何是否由同样的点组成
function pointsOf(geometry: RegionScope | null): string[] {
  const polygons = !geometry ? [] : geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons
    .flat(2)
    .map(([lng = 0, lat = 0]) => `${lng.toFixed(9)},${lat.toFixed(9)}`)
    .toSorted();
}

describe('区划范围：求交前先裁掉远处的边', () => {
  const nanjing = cityGeometry('320100');
  const direct = (area: Polygon) =>
    intersect({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: {}, geometry: area },
        { type: 'Feature', properties: {}, geometry: nanjing }
      ]
    })?.geometry ?? null;

  it.each([
    ['在南京里', box(118.7, 32.0, 0.05)],
    ['跨东界', box(119.0, 31.95, 0.3)],
    ['跨北界', box(118.7, 32.4, 0.25)],
    ['离得很远', box(120.5, 33.5, 0.2)]
  ])('结果和直接求交一样：%s', (_name, area) => {
    expect(pointsOf(clipToScope(area, nanjing))).toStrictEqual(pointsOf(direct(area)));
  });
});
