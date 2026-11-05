import { simplify } from '@turf/simplify';
import type { MultiPolygon, Polygon } from 'geojson';
import { isValidPolygonal, QUERY_VERTEX_LIMIT, queryGeometry, roundPolygonal, vertexCount } from '@mx/map-tools';
import { describe, expect, it } from 'vitest';
import cityFile from './boundary/data/jiangsu-city.json?raw';
import { clipToScope } from './region/region-scope';

// 其余用例在 @mx/map-tools；这一条要用江苏的市界和区划求交，留在应用

const box = (west: number, south: number, east: number, north: number): Polygon => ({
  type: 'Polygon',
  coordinates: [
    [
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south]
    ]
  ]
});

function nantong(): Polygon | MultiPolygon {
  const { features } = JSON.parse(cityFile) as {
    features: { properties: { code: string }; geometry: Polygon | MultiPolygon }[];
  };
  const feature = features.find(({ properties }) => properties.code.startsWith('320600'));
  if (!feature) {
    throw new Error('市界里没有南通');
  }
  return feature.geometry;
}

describe('发给后端的几何：简化', () => {
  it('某次简化的结果自相交时不用它：南通市界和框求交后，前三档容差的结果都无效，用第四档的', () => {
    const area = clipToScope(box(120.2, 32.2, 120.7, 32.6), nantong());
    if (!area) {
      throw new Error('框和南通应当相交');
    }
    // 评审复现的情况：求交结果本身有效，按 0.006 度简化后不到 120 个坐标，但外环自相交
    const first = roundPolygonal(simplify(area, { tolerance: 0.006 * 0.25, highQuality: true }));
    expect(first && vertexCount(first)).toBeLessThanOrEqual(QUERY_VERTEX_LIMIT);
    expect(first && isValidPolygonal(first)).toBe(false);

    const result = queryGeometry(area, 0.006);
    expect(result && isValidPolygonal(result)).toBe(true);
    expect(result).toStrictEqual(roundPolygonal(simplify(area, { tolerance: 0.006 * 2, highQuality: true })));
  });
});
