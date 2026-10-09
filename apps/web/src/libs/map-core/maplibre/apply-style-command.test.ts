import type { LayerSpecification, StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { FeatureCollection } from 'geojson';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { diffStyle, type StyleCommand } from '../style/diff-style';
import { applyStyleCommand, type StyleTarget } from './apply-style-command';

const line: LayerSpecification = { id: 'dltb-line', type: 'line', source: 'dltb', paint: { 'line-color': '#336699' } };
const emptyData: FeatureCollection = { type: 'FeatureCollection', features: [] };

function fakeMap() {
  const calls: unknown[][] = [];
  const sources = new Map<string, unknown>();
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
    };
  const map: StyleTarget = {
    addSource: record('addSource'),
    removeSource: record('removeSource'),
    getSource: id => sources.get(id),
    addLayer: record('addLayer'),
    removeLayer: record('removeLayer'),
    setPaintProperty: record('setPaintProperty'),
    setLayoutProperty: record('setLayoutProperty'),
    setFilter: record('setFilter'),
    setLayerZoomRange: record('setLayerZoomRange')
  };
  return { map, calls, sources };
}

function geoJsonSource(setData: (data: unknown) => Promise<void> = () => Promise.resolve()) {
  return { type: 'geojson', setData: vi.fn<(data: unknown) => Promise<void>>(setData) };
}

const failOnAsyncError = (error: unknown) => {
  throw error;
};

describe('applyStyleCommand', () => {
  it('is implemented by the MapLibre map', () => {
    expectTypeOf<MapLibreMap>().toExtend<StyleTarget>();
  });

  it.for<StyleCommand>([
    { command: 'addSource', args: ['dltb', { type: 'geojson', data: emptyData }] },
    { command: 'removeSource', args: ['dltb'] },
    { command: 'addLayer', args: [line, 'boundary-line'] },
    { command: 'removeLayer', args: ['dltb-line'] },
    { command: 'setPaintProperty', args: ['dltb-line', 'line-color', '#993366'] },
    { command: 'setLayoutProperty', args: ['dltb-line', 'visibility', 'none'] },
    { command: 'setFilter', args: ['dltb-line', ['==', ['get', 'dlbm'], '0101']] },
    { command: 'setLayerZoomRange', args: ['dltb-line', 10, 18] }
  ])('calls the map method for $command', command => {
    const { map, calls } = fakeMap();

    expect(applyStyleCommand(map, command, failOnAsyncError)).toBe(true);
    expect(calls).toEqual([[command.command, ...command.args]]);
  });

  it('updates the data of a GeoJSON source', () => {
    const { map, sources } = fakeMap();
    const source = geoJsonSource();
    sources.set('measure', source);
    const data: FeatureCollection = { type: 'FeatureCollection', features: [] };

    expect(applyStyleCommand(map, { command: 'setGeoJSONSourceData', args: ['measure', data] }, failOnAsyncError)).toBe(
      true
    );
    expect(source.setData).toHaveBeenCalledWith(data);
  });

  it('reports a failed asynchronous data update', async () => {
    const { map, sources } = fakeMap();
    const failure = new Error('worker failed');
    sources.set('measure', geoJsonSource(() => Promise.reject(failure)));
    const onAsyncError = vi.fn<(error: unknown) => void>();

    applyStyleCommand(map, { command: 'setGeoJSONSourceData', args: ['measure', emptyData] }, onAsyncError);
    await vi.waitFor(() => expect(onAsyncError).toHaveBeenCalledWith(failure));
  });

  it.each([
    ['missing', undefined],
    ['not GeoJSON', { type: 'vector' }]
  ])('throws when the source to update is %s', (_, source) => {
    const { map, sources } = fakeMap();
    sources.set('measure', source);

    expect(() =>
      applyStyleCommand(map, { command: 'setGeoJSONSourceData', args: ['measure', emptyData] }, failOnAsyncError)
    ).toThrow('数据源 "measure" 不存在或不是 GeoJSON 数据源');
  });

  it.for<StyleCommand>([
    { command: 'setStyle', args: [{ version: 8, sources: {}, layers: [] }] },
    { command: 'setLayerProperty', args: ['dltb-line', 'metadata', {}] },
    { command: 'setGlyphs', args: ['/fonts/{fontstack}/{range}.pbf'] },
    { command: 'setCenter', args: [[118.8, 32.05]] }
  ])('leaves $command to a rebuild without touching the map', command => {
    const { map, calls } = fakeMap();

    expect(applyStyleCommand(map, command, failOnAsyncError)).toBe(false);
    expect(calls).toEqual([]);
  });

  it('applies what diffStyle produces, including adding and dropping a zoom limit', () => {
    const { map, calls } = fakeMap();
    const label: LayerSpecification = {
      id: 'dltb-label',
      type: 'symbol',
      source: 'dltb',
      layout: { 'text-field': ['get', 'dlmc'] }
    };
    const empty: StyleSpecification = { version: 8, sources: {}, layers: [] };
    const added: StyleSpecification = {
      version: 8,
      sources: { dltb: { type: 'geojson', data: emptyData } },
      layers: [line, label]
    };
    const limited: StyleSpecification = { ...added, layers: [{ ...line, minzoom: 10 }, label] };

    const commands = [...diffStyle(empty, added), ...diffStyle(added, limited), ...diffStyle(limited, added)];
    const results = commands.map(command => applyStyleCommand(map, command, failOnAsyncError));

    expect(results.every(Boolean)).toBe(true);
    expect(calls).toEqual([
      ['addSource', 'dltb', { type: 'geojson', data: emptyData }],
      ['addLayer', label, undefined],
      ['addLayer', line, 'dltb-label'],
      // 只加了 minzoom，maxzoom 的 undefined 表示保持不设
      ['setLayerZoomRange', 'dltb-line', 10, undefined],
      ['removeLayer', 'dltb-line'],
      ['addLayer', line, 'dltb-label']
    ]);
  });
});
