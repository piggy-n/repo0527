// @vitest-environment node
import type { ViewBounds } from '@yzt/map-core';
import type { CameraControl } from '@yzt/map-vue';
import { describe, expect, it } from 'vitest';
import { effectScope } from 'vue';
import { required } from '@/shared/testing/required';
import { sampleComposition } from '../compose/composition';
import { ManualClock } from '../engine/test-clock';
import { VALUE_COLORS } from '../map/colors';
import { createCalculator } from '../model/calculator';
import { loadTestAtlas } from '../model/test-atlas';
import { useSimulationMap } from './useSimulationMap';
import { useSimulationResult } from './useSimulationResult';
import { useSimulationRun } from './useSimulationRun';

// 各步的时长按推理的话多少给：推进这么久一定计算完
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
    '计算和地图'
  );
  return { ...owned, calculator, clock, moves, [Symbol.dispose]: () => scope.stop() };
}

const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0));
const empty = { sources: {}, layers: [] };

describe('useSimulationMap', () => {
  it('计算中没有地图数据和分组，镜头不动；有了结果时镜头移到计算范围，各市标出值', async () => {
    using ctx = await setup();
    const { run, map, calculator, clock, moves } = ctx;
    run.start(sampleComposition(), calculator);
    await clock.advance(10_000);
    await settle();
    expect(map.data.value).toBeNull();
    expect([map.deriveDistricts(), map.deriveFacilities(), map.deriveHighlight()]).toEqual([empty, empty, empty]);
    expect(moves).toEqual([]);

    await clock.advance(ENOUGH);
    await settle();
    const bounds = required(map.data.value, '地图数据').bounds;
    expect(moves).toEqual([{ kind: 'fit', bounds, maxZoom: 10 }]);
    const cities = map.labels.value;
    expect(cities).toHaveLength(13);
    expect(cities[0]).toStrictEqual({ cityCode: '320100', lngLat: cities[0]?.lngLat, name: '南京', value: '47.7%' });
    expect(map.deriveDistricts().layers.length).toBeGreaterThan(0);
  });

  it('按数值着色，换指标时标注跟着换；悬停的市描边；鼠标下的区县提示值、不写达标', async () => {
    using ctx = await setup();
    const { run, map, result, calculator, clock } = ctx;
    run.start(sampleComposition(), calculator);
    await clock.advance(ENOUGH);
    await settle();
    const fills = () => new Set(map.data.value?.districts.features.map(feature => feature.properties.fill));

    expect([...fills()].every(color => (VALUE_COLORS as readonly string[]).includes(color))).toBe(true);
    result.select({ indicatorId: 'A-39' });
    expect([...fills()].every(color => (VALUE_COLORS as readonly string[]).includes(color))).toBe(true);
    expect(map.labels.value[0]?.value).toBe('12.26 m²');

    expect(map.deriveHighlight().layers[0]).toMatchObject({ filter: ['==', ['get', 'cityCode'], ''] });
    result.setHoverCity('320500');
    expect(map.deriveHighlight().layers[0]).toMatchObject({ filter: ['==', ['get', 'cityCode'], '320500'] });

    const district = required(map.data.value?.districts.features[0], '第一个区县').properties.code;
    expect(map.describeDistrict(district)?.text).toMatch(/^\d+\.\d{2} m²$/);
    expect(map.describeDistrict('000000')).toBeNull();
  });

  it('放大到一个市时镜头移到这个市、画出设施和服务圈，回到整个范围时移回来；换指标不动镜头', async () => {
    using ctx = await setup();
    const { run, map, result, calculator, clock, moves } = ctx;
    run.start(sampleComposition(), calculator);
    await clock.advance(ENOUGH);
    await settle();
    const data = required(map.data.value, '地图数据');
    const suzhou = required(
      data.cities.find(city => city.code === '320500'),
      '苏州市'
    );
    expect(map.deriveFacilities()).toEqual(empty);

    result.select({ cityCode: '320500' });
    await settle();
    expect(map.deriveFacilities().layers.map(layer => layer.id)).toEqual(['simulation-facilities-ring', 'simulation-facilities-point']);
    result.select({ indicatorId: 'A-39' });
    await settle();
    result.select({ cityCode: null });
    await settle();
    expect(moves.slice(1)).toEqual([
      { kind: 'fit', bounds: suzhou.bounds, maxZoom: 11 },
      { kind: 'fit', bounds: data.bounds, maxZoom: 10 }
    ]);
  });

  it('换条件重新计算：完成后镜头再移到新的范围；范围只有一个市时直接画设施', async () => {
    using ctx = await setup();
    const { run, map, calculator, clock, moves } = ctx;
    run.start(sampleComposition(), calculator);
    await clock.advance(ENOUGH);
    await settle();
    run.restart({ ...sampleComposition(), conditions: { ...sampleComposition().conditions, cityCodes: ['320100'] } });
    await clock.advance(ENOUGH);
    await settle();
    expect(moves).toHaveLength(2);
    expect(map.deriveFacilities().layers.length).toBeGreaterThan(0);
  });
});
