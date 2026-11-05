// @vitest-environment node
import { type StyleGroup, StyleModel } from '@yzt/map-core';
import { describe, expect, it } from 'vitest';
import type { RegionBoundary } from './region-geometry';
import { regionGroup } from './region-style';

const BOUNDARY: RegionBoundary = {
  code: '320213',
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [120.24, 31.52],
        [120.35, 31.52],
        [120.35, 31.63],
        [120.24, 31.52]
      ]
    ]
  },
  bounds: [120.24, 31.52, 120.35, 31.63]
};

function compose(group: StyleGroup) {
  const model = new StyleModel({ groups: ['boundaries', 'region', 'measure'] });
  model.setGroups({ region: group });
  return model.current;
}

describe('区划高亮的样式推导', () => {
  it('没有边界时是空分组', () => {
    expect(regionGroup(null)).toStrictEqual({ sources: {}, layers: [] });
  });

  it('选中区划的边界放进 region 数据源，红色光晕在下、实线在上', () => {
    const group = regionGroup(BOUNDARY);

    expect(group.sources).toStrictEqual({
      region: {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [{ type: 'Feature', properties: { code: '320213' }, geometry: BOUNDARY.geometry }]
        }
      }
    });
    expect(group.layers).toStrictEqual([
      {
        id: 'region-glow',
        type: 'line',
        source: 'region',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#FF0000', 'line-width': 8, 'line-blur': 5, 'line-opacity': 0.8 }
      },
      {
        id: 'region-line',
        type: 'line',
        source: 'region',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#FF0000', 'line-width': 2, 'line-opacity': 0.9 }
      }
    ]);
  });

  it('ID 以分组名为前缀，组合后通过校验；每次推导的数据都是新对象', () => {
    const first = regionGroup(BOUNDARY);
    const second = regionGroup(BOUNDARY);

    expect(() => compose(first)).not.toThrow();
    expect(first.sources.region).not.toBe(second.sources.region);
  });
});
