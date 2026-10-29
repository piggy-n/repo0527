// @vitest-environment node
import type { ViewBounds } from '@yzt/map-core';
import type { CameraControl } from '@yzt/map-vue';
import { describe, expect, it } from 'vitest';
import { effectScope } from 'vue';
import { required } from '@/shared/testing/required';
import { sampleComposition } from '../compose/composition';
import { ManualClock } from '../engine/test-clock';
import { PASS_COLORS, VALUE_COLORS } from '../map/colors';
import { createCalculator } from '../model/calculator';
import { loadTestAtlas } from '../model/test-atlas';
import { useSimulationMap } from './useSimulationMap';
import { useSimulationResult } from './useSimulationResult';
import { useSimulationRun } from './useSimulationRun';

// 各步的时长按推理的话多少给：推进这么久一定推演完
const ENOUGH = 120_000;

type Move = { readonly kind: 'fit'; readonly bounds: ViewBounds; readonly maxZoom?: number } | { readonly kind: 'fly' };

async function setup() {
  const calculator = createCalculator(await loadTestAtlas());
  const clock = new ManualClock();
  const moves: Move[] = [];
  // 记下镜头操作；视图总是就绪，回调立即执行
  const camera: CameraControl = {
    fitBounds: (bounds, options) => moves.push({ kind: 'fit', bounds, maxZoom: options?.maxZoom }),
    flyTo: () => moves.push({ kind: 'fly' }),
    reveal: () => undefined
  };
  const scope = effectScope();
  const owned = required(
    scope.run(() => {
      const run = useSimulationRun(clock);
      const result = useSimulationResult(run);
      return { run, result, map: useSimulationMap(run, { runCameraOperation: action => action(camera) }, result) };
    }),
    '推演和地图'
  );
  return { ...owned, calculator, clock, moves, [Symbol.dispose]: () => scope.stop() };
}

const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const empty = { sources: {}, layers: [] };

describe('useSimulationMap', () => {
  it('推演中没有地图数据和分组，镜头不动；有了结果时镜头移到推演范围，各市标出值和达标', async () => {
    using ctx = await setup();
    const { run, map, calculator, clock, moves } = ctx;
    run.start(sampleComposition(), calculator);
    await clock.advance(10_000);
    await settle();
    expect(map.data.value).toBeNull();
    expect([map.deriveDistricts(), map.deriveFacilities(), map.deriveAlerts()]).toEqual([empty, empty, empty]);
    expect(moves).toEqual([]);

    await clock.advance(ENOUGH);
    await settle();
    const bounds = required(map.data.value, '地图数据').bounds;
    expect(moves).toEqual([{ kind: 'fit', bounds, maxZoom: 10 }]);
    const cities = map.labels.value;
    expect(cities).toHaveLength(13);
    expect(cities[0]?.text).toBe('南京 47.7%');
    expect(map.deriveDistricts().layers.length).toBeGreaterThan(0);
  });

  it('结果阶段按选择着色：数值、达标，换指标时标注跟着换；干预预览的区县描虚线', async () => {
    using ctx = await setup();
    const { run, map, result, calculator, clock } = ctx;
    run.start(sampleComposition(), calculator);
    await clock.advance(ENOUGH);
    await settle();
    const fills = () => new Set(map.data.value?.districts.features.map(feature => feature.properties.fill));
    const previewed = () =>
      map.data.value?.districts.features.filter(feature => feature.properties.preview).map(feature => feature.properties.code);

    expect([...fills()].every(color => (VALUE_COLORS as readonly string[]).includes(color))).toBe(true);
    result.select({ mode: 'pass' });
    expect([...fills()].every(color => Object.values<string>(PASS_COLORS).includes(color))).toBe(true);
    result.select({ indicatorId: 'A-39' });
    expect(map.labels.value[0]?.text).toBe('南京 12.26 m²');

    expect(map.deriveAlerts()).toEqual(empty);
    result.setPreview({ ...run.state.value.params, popChange: 20 });
    expect(result.preview.value.size).toBeGreaterThan(0);
    expect(map.deriveAlerts().layers).toHaveLength(1);
    expect(previewed()).toEqual([...result.preview.value]);
    result.setPreview(null);
    expect(map.deriveAlerts()).toEqual(empty);
    expect(previewed()).toEqual([]);
  });

  it('换条件重新推演：完成后镜头再移到新的范围', async () => {
    using ctx = await setup();
    const { run, calculator, clock, moves } = ctx;
    run.start(sampleComposition(), calculator);
    await clock.advance(ENOUGH);
    await settle();
    run.restart({ ...sampleComposition(), conditions: { ...sampleComposition().conditions, cityCodes: ['320100'] } });
    await clock.advance(ENOUGH);
    await settle();
    expect(moves).toHaveLength(2);
  });
});
