// @vitest-environment node
import type { FeatureCollection } from 'geojson';
import { describe, expect, it } from 'vitest';
import { AI_RESULT_GROUP, aiResultGroup, resultBounds } from './ai-result-layer';

const collection: FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [118.4, 31.2],
            [119.2, 31.2],
            [119.2, 32.6],
            [118.4, 31.2]
          ]
        ]
      }
    },
    { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [120, 33] } }
  ]
};

describe('aiResultGroup', () => {
  it('没有 GeoJSON 时是空分组', () => {
    expect(aiResultGroup(null)).toEqual({ sources: {}, layers: [] });
  });

  it('数据源直接引用结果；图层以分组名为前缀，填充类图层不画（面只描边和外发光）', () => {
    const group = aiResultGroup(collection);

    expect(group.sources[AI_RESULT_GROUP]).toEqual({ type: 'geojson', data: collection });
    expect(group.layers.map(layer => [layer.id, layer.type])).toEqual([
      ['ai-result-glow', 'line'],
      ['ai-result-line', 'line'],
      ['ai-result-circle', 'circle']
    ]);
    expect(group.layers.every(layer => 'filter' in layer && layer.filter !== undefined)).toBe(true);
  });
});

describe('resultBounds', () => {
  it('取所有要素的范围', () => {
    expect(resultBounds(collection)).toEqual([118.4, 31.2, 120, 33]);
  });

  it('没有坐标时为 null', () => {
    expect(
      resultBounds({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: {}, geometry: { type: 'GeometryCollection', geometries: [] } }]
      })
    ).toBeNull();
  });
});
