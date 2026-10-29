// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createCalculator } from '../model/calculator';
import { defaultParams } from '../model/params';
import { loadTestAtlas } from '../model/test-atlas';
import { mapData } from './map-data';
import { alertsGroup, districtsGroup, facilitiesGroup, type MapFrame, maskGroup } from './map-frame';

describe('分组', () => {
  const frame: MapFrame = { density: 0.5, scan: 0.3, rain: 0.2, ring: 1, alert: { kind: 'fail', opacity: 1 } };

  it('数据不变时动画只改图层里的阈值，数据源是同一个对象', async () => {
    const calculator = createCalculator(await loadTestAtlas());
    const data = mapData(calculator, { years: [2026], cityCodes: ['320100', '320200'], indicatorIds: ['B-65'] }, defaultParams(), 'B-65');
    const a = districtsGroup(data, frame);
    const b = districtsGroup(data, { ...frame, scan: 0.6 });
    expect(a.sources['simulation-districts']).toEqual(b.sources['simulation-districts']);
    expect(a.layers.map(layer => layer.id)).toEqual([
      'simulation-districts-density',
      'simulation-districts-pending',
      'simulation-districts-value',
      'simulation-districts-line'
    ]);
    expect(JSON.stringify(b.layers[2])).toContain('0.6');
    expect(facilitiesGroup(data, frame).layers.map(layer => layer.id)).toEqual(['simulation-facilities-ring', 'simulation-facilities-point']);
    expect(facilitiesGroup(data, { ...frame, ring: 0 }).layers.map(layer => layer.id)).toEqual(['simulation-facilities-point']);
    expect(alertsGroup(data, frame).layers[0]).toMatchObject({ filter: ['==', ['get', 'fail'], true] });
    expect(maskGroup(data).layers).toHaveLength(1);
  });

  it('没有数据或不显示时是空分组', () => {
    const empty = { sources: {}, layers: [] };
    const hidden: MapFrame = { density: null, scan: null, rain: null, ring: 0, alert: null };
    expect(districtsGroup(null, frame)).toEqual(empty);
    expect(facilitiesGroup(null, frame)).toEqual(empty);
    expect(alertsGroup(null, hidden)).toEqual(empty);
  });
});
