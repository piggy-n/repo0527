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

// 默认时长：空间分析 8500 开始，评价分级 19500 完成，22100 推演完成
const SPATIAL_AT = 8500;
const EVALUATED_AT = 19_500;
const DONE_AT = 22_100;

type Move = { readonly kind: 'fit'; readonly bounds: ViewBounds; readonly maxZoom?: number } | { readonly kind: 'fly'; readonly center?: readonly number[] };

async function setup() {
  const calculator = createCalculator(await loadTestAtlas());
  const clock = new ManualClock();
  const moves: Move[] = [];
  // 记下镜头操作；视图总是就绪，回调立即执行
  const camera: CameraControl = {
    fitBounds: (bounds, options) => moves.push({ kind: 'fit', bounds, maxZoom: options?.maxZoom }),
    flyTo: target => moves.push({ kind: 'fly', center: target.center }),
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

describe('useSimulationMap', () => {
  it('镜头跟随推演：先看推演范围，空间分析时飞到样例区县', async () => {
    using ctx = await setup();
    const { run, map, calculator, clock, moves } = ctx;
    run.start(sampleComposition(), calculator);
    await settle();
    const bounds = required(map.data.value, '地图数据').bounds;
    expect(moves).toEqual([{ kind: 'fit', bounds, maxZoom: 10 }]);
    expect(map.labels.value).toEqual([]);

    await clock.advance(SPATIAL_AT);
    await settle();
    expect(moves.at(-1)).toEqual({ kind: 'fly', center: map.data.value?.sample?.center });
  });

  it('停止跟随后镜头不动；恢复跟随时回到当前该看的位置', async () => {
    using ctx = await setup();
    const { run, map, calculator, clock, moves } = ctx;
    run.start(sampleComposition(), calculator);
    await settle();
    map.stopFollowing();
    await clock.advance(SPATIAL_AT);
    expect(moves).toHaveLength(1);

    map.resumeFollowing();
    expect(map.following.value).toBe(true);
    expect(moves.at(-1)).toMatchObject({ kind: 'fly' });
  });

  it('评价分级后标出各市的值和达标；没开始时没有数据和分组', async () => {
    using ctx = await setup();
    const { run, map, calculator, clock } = ctx;
    expect(map.data.value).toBeNull();
    expect(map.deriveDistricts()).toEqual({ sources: {}, layers: [] });

    run.start(sampleComposition(), calculator);
    await clock.advance(EVALUATED_AT - 1);
    expect(map.labels.value).toEqual([]);
    await clock.advance(1);
    const cities = map.labels.value;
    expect(cities).toHaveLength(13);
    expect(cities.filter(label => label.state === 'pass')).toHaveLength(5);
    expect(cities[0]?.text).toBe('南京 47.7%');
  });

  it('结果阶段按选择着色：数值、达标，换指标时标注跟着换；干预预览的区县描虚线', async () => {
    using ctx = await setup();
    const { run, map, result, calculator, clock } = ctx;
    run.start(sampleComposition(), calculator);
    await clock.advance(DONE_AT);
    await settle();
    const fills = () => new Set(map.data.value?.districts.features.map(feature => feature.properties.fill));
    const previewed = () =>
      map.data.value?.districts.features.filter(feature => feature.properties.preview).map(feature => feature.properties.code);

    expect(map.frame.value).toEqual({ density: null, scan: 1, rain: 1, ring: 1, alert: null });
    expect([...fills()].every(color => (VALUE_COLORS as readonly string[]).includes(color))).toBe(true);
    result.select({ mode: 'pass' });
    expect([...fills()].every(color => Object.values<string>(PASS_COLORS).includes(color))).toBe(true);
    result.select({ indicatorId: 'A-39' });
    expect(map.labels.value[0]?.text).toBe('南京 12.26 m²');

    result.setPreview({ ...run.state.value.params, popChange: 20 });
    expect(result.preview.value.size).toBeGreaterThan(0);
    expect(map.frame.value?.alert).toEqual({ kind: 'preview', opacity: 1 });
    expect(previewed()).toEqual([...result.preview.value]);
    result.setPreview(null);
    expect(map.frame.value?.alert).toBeNull();
    expect(previewed()).toEqual([]);
  });
});
