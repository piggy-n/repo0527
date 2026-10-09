import type {
  GeoJSONSourceSpecification,
  LayerSpecification,
  SourceSpecification,
  StyleSpecification
} from '@maplibre/maplibre-gl-style-spec';
import { describe, expect, it } from 'vitest';
import { diffStyle } from './diff-style';

type GeoJsonData = GeoJSONSourceSpecification['data'];

function featureCollection(lng: number): GeoJsonData {
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lng, 32] } }]
  };
}

function style(sources: Record<string, SourceSpecification>, layers: LayerSpecification[] = []): StyleSpecification {
  return { version: 8, sources, layers };
}

const fillLayer: LayerSpecification = {
  id: 'region-fill',
  type: 'fill',
  source: 'region',
  paint: { 'fill-color': '#336699', 'fill-opacity': 0.6 }
};

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

describe('diffStyle', () => {
  it('returns no commands for the same snapshot content', () => {
    const data = featureCollection(118);
    const before = style({ region: { type: 'geojson', data } }, [fillLayer]);
    const after = style({ region: { type: 'geojson', data } }, [{ ...fillLayer }]);

    expect(diffStyle(before, after)).toEqual([]);
  });

  it('delegates property changes to style-spec', () => {
    const data = featureCollection(118);
    const before = style({ region: { type: 'geojson', data } }, [fillLayer]);
    const after = style({ region: { type: 'geojson', data } }, [
      { ...fillLayer, paint: { ...fillLayer.paint, 'fill-opacity': 0.3 } }
    ]);

    expect(diffStyle(before, after)).toEqual([
      { command: 'setPaintProperty', args: ['region-fill', 'fill-opacity', 0.3] }
    ]);
  });

  it('updates GeoJSON data when the data object is replaced', () => {
    const next = featureCollection(119);
    const before = style({ region: { type: 'geojson', data: featureCollection(118) } });
    const after = style({ region: { type: 'geojson', data: next } });

    const commands = diffStyle(before, after);

    expect(commands).toEqual([{ command: 'setGeoJSONSourceData', args: ['region', next] }]);
    expect(commands[0]?.args[1]).toBe(next);
  });

  it('compares GeoJSON data by reference, so an equal but new object is still an update', () => {
    const before = style({ region: { type: 'geojson', data: featureCollection(118) } });
    const after = style({ region: { type: 'geojson', data: featureCollection(118) } });

    expect(diffStyle(before, after)).toHaveLength(1);
  });

  it('does not traverse GeoJSON data whose reference is unchanged', () => {
    let reads = 0;
    const data = {
      type: 'FeatureCollection',
      get features() {
        reads++;
        return [];
      }
    } as GeoJsonData;
    const before = style({ region: { type: 'geojson', data } }, [fillLayer]);
    const after = style({ region: { type: 'geojson', data } }, [
      { ...fillLayer, paint: { ...fillLayer.paint, 'fill-color': '#993366' } }
    ]);

    diffStyle(before, after);

    expect(reads).toBe(0);
  });

  it('adds a new GeoJSON source with its real data', () => {
    const data = featureCollection(118);
    const after = style({ region: { type: 'geojson', data } }, [fillLayer]);

    const commands = diffStyle(style({}), after);

    expect(commands).toEqual([
      { command: 'addSource', args: ['region', { type: 'geojson', data }] },
      { command: 'addLayer', args: [fillLayer, undefined] }
    ]);
    expect(commands[0]?.args[1]).toBe(after.sources.region);
  });

  it('rebuilds a source whose options changed and carries the new data in addSource only', () => {
    const next = featureCollection(119);
    const before = style({ region: { type: 'geojson', data: featureCollection(118) } }, [fillLayer]);
    const after = style({ region: { type: 'geojson', data: next, cluster: true } }, [fillLayer]);

    expect(diffStyle(before, after)).toEqual([
      { command: 'removeLayer', args: ['region-fill'] },
      { command: 'removeSource', args: ['region'] },
      { command: 'addSource', args: ['region', { type: 'geojson', data: next, cluster: true }] },
      { command: 'addLayer', args: [fillLayer, undefined] }
    ]);
  });

  it('removes a GeoJSON source without updating its data', () => {
    const before = style({ region: { type: 'geojson', data: featureCollection(118) } });

    expect(diffStyle(before, style({}))).toEqual([{ command: 'removeSource', args: ['region'] }]);
  });

  it('falls back to setStyle with the real snapshot', () => {
    const data = featureCollection(118);
    const after = style({ region: { type: 'geojson', data } });
    const before = { ...style({}), version: 7 } as unknown as StyleSpecification;

    const commands = diffStyle(before, after);

    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ command: 'setStyle' });
    expect(commands[0]?.args[0]).toBe(after);
  });

  it('does not modify the snapshots it compares', () => {
    const before = deepFreeze(
      style({ region: { type: 'geojson', data: featureCollection(118) } }, [structuredClone(fillLayer)])
    );
    const after = deepFreeze(
      style({ region: { type: 'geojson', data: featureCollection(119), cluster: true } }, [
        { ...structuredClone(fillLayer), paint: { 'fill-color': '#993366' } }
      ])
    );

    expect(() => diffStyle(before, after)).not.toThrow();
  });
});
