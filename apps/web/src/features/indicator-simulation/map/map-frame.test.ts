// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { type EngineState, idleEngineState, type StepStatus } from '../engine/engine';
import type { StepId } from '../engine/steps';
import { createCalculator } from '../model/calculator';
import { defaultParams } from '../model/params';
import { loadTestAtlas } from '../model/test-atlas';
import { mapData } from './map-data';
import { alertsGroup, districtsGroup, facilitiesGroup, type MapFrame, mapFrame, maskGroup } from './map-frame';

function stateWith(statuses: Partial<Record<StepId, StepStatus>>, patch: Partial<EngineState> = {}): EngineState {
  const idle = idleEngineState();
  const steps = { ...idle.steps };
  for (const [id, status] of Object.entries(statuses) as [StepId, StepStatus][]) {
    steps[id] = { status, human: false };
  }
  return { ...idle, status: 'running', steps, ...patch };
}

const at = (values: Partial<Record<StepId, number>>) => (step: StepId) => values[step] ?? 0;
const DONE_TO_POI: Partial<Record<StepId, StepStatus>> = { parse: 'done', pop: 'done', poi: 'done', land: 'done' };

describe('mapFrame', () => {
  it('人口按市点亮，数据核查完成后退掉；设施点随设施数据落下，开始计算后隐藏', () => {
    const prep = mapFrame(stateWith({ parse: 'done', pop: 'running', poi: 'running' }), at({ pop: 0.4, poi: 0.375 }));
    expect(prep.density).toBeCloseTo(0.5, 6);
    expect(prep.rain).toBeCloseTo(0.25, 6);
    const afterQc = mapFrame(stateWith({ ...DONE_TO_POI, qc: 'done', spatial: 'running' }), at({ spatial: 0.275 }));
    expect(afterQc.density).toBeNull();
    expect(afterQc.ring).toBeCloseTo(0.75, 6);
    expect(mapFrame(stateWith({ ...DONE_TO_POI, qc: 'done', spatial: 'done', compute: 'running' }), at({})).rain).toBeNull();
  });

  it('数据核查停下来问时描出缺失的区县，决定后不再描', () => {
    const asking = stateWith({ ...DONE_TO_POI, qc: 'checkpoint' });
    expect(mapFrame(asking, at({ qc: 0.5 })).alert).toEqual({ kind: 'missing', opacity: 1 });
    const decided = stateWith({ ...DONE_TO_POI, qc: 'running' }, { decided: { qc: true, spatial: false } });
    expect(mapFrame(decided, at({ qc: 0.6 })).alert).toBeNull();
  });

  it('计算时扫描，完成后全部显示数值；评价分级时未达标的闪烁', () => {
    const before = { ...DONE_TO_POI, qc: 'done', spatial: 'done' } as const;
    expect(mapFrame(stateWith({ ...before, compute: 'running' }), at({ compute: 0.425 })).scan).toBeCloseTo(0.5, 6);
    const evaluating = mapFrame(stateWith({ ...before, compute: 'done', evaluate: 'running' }), at({ evaluate: 0.225 }));
    expect(evaluating.scan).toBe(1);
    expect(evaluating.alert?.kind).toBe('fail');
    expect(evaluating.alert?.opacity).toBeCloseTo(1, 6);
    expect(mapFrame(stateWith({ ...before, compute: 'done', evaluate: 'running' }), at({ evaluate: 0.9 })).alert).toBeNull();
  });

  it('减少动画：每一段开始就是终态，未达标的描边不闪', () => {
    const prep = mapFrame(stateWith({ parse: 'done', pop: 'running', poi: 'running' }), at({ pop: 0.1, poi: 0.1 }), true);
    expect([prep.density, prep.rain]).toEqual([1, 1]);
    const spatial = mapFrame(stateWith({ ...DONE_TO_POI, qc: 'done', spatial: 'running' }), at({ spatial: 0.05 }), true);
    expect(spatial.ring).toBe(1);
    const before = { ...DONE_TO_POI, qc: 'done', spatial: 'done' } as const;
    expect(mapFrame(stateWith({ ...before, compute: 'running' }), at({ compute: 0.1 }), true).scan).toBe(1);
    const flashes = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7].map(
      evaluate => mapFrame(stateWith({ ...before, compute: 'done', evaluate: 'running' }), at({ evaluate }), true).alert
    );
    expect(flashes).toEqual(Array.from({ length: 6 }, () => ({ kind: 'fail', opacity: 1 })));
  });

  it('没开始时什么都不显示', () => {
    expect(mapFrame(idleEngineState(), at({}))).toEqual({ density: null, scan: null, rain: null, ring: 0, alert: null });
  });
});

describe('分组', () => {
  const frame: MapFrame = { density: 0.5, scan: 0.3, rain: 0.2, ring: 1, alert: { kind: 'missing', opacity: 1 } };

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
    expect(alertsGroup(data, frame).layers[0]).toMatchObject({ filter: ['==', ['get', 'missing'], true] });
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
