// @vitest-environment node
import type { Position } from 'geojson';
import { describe, expect, it } from 'vitest';
import province from './boundary/data/jiangsu-province.json';
import { JIANGSU_BOUNDS } from './jiangsu';

function positions(value: unknown): Position[] {
  if (Array.isArray(value) && typeof value[0] === 'number') {
    return [value as Position];
  }
  return Array.isArray(value) ? value.flatMap(positions) : [];
}

describe('江苏的范围', () => {
  it('包含省界数据的全部范围，四边多出的不超过 0.05°', () => {
    const points = province.features.flatMap(feature => positions(feature.geometry.coordinates));
    const lngs = points.map(([lng]) => lng ?? Number.NaN);
    const lats = points.map(([, lat]) => lat ?? Number.NaN);
    const [west, south, east, north] = JIANGSU_BOUNDS;
    const margins = [
      Math.min(...lngs) - west,
      Math.min(...lats) - south,
      east - Math.max(...lngs),
      north - Math.max(...lats)
    ];

    for (const margin of margins) {
      expect(margin).toBeGreaterThanOrEqual(0);
      expect(margin).toBeLessThan(0.05);
    }
  });
});
