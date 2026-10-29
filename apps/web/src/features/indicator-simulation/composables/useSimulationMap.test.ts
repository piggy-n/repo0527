// @vitest-environment node
import type { ViewBounds } from '@yzt/map-core';
import type { CameraControl } from '@yzt/map-vue';
import { describe, expect, it } from 'vitest';
import { effectScope } from 'vue';
import { required } from '@/shared/testing/required';
import { defaultComposition } from '../compose/composition';
import { ManualClock } from '../engine/test-clock';
import { createCalculator } from '../model/calculator';
import { loadTestAtlas } from '../model/test-atlas';
import { useSimulationMap } from './useSimulationMap';
import { useSimulationRun } from './useSimulationRun';

// 默认时长：数据核查在 7300 处停下，确认后 1200 到空间分析
const QC_CHECKPOINT_AT = 7300;

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
      return { run, map: useSimulationMap(run, { runCameraOperation: action => action(camera) }) };
    }),
    '推演和地图'
  );
  return { ...owned, calculator, clock, moves, [Symbol.dispose]: () => scope.stop() };
}

const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe('useSimulationMap', () => {
  it('镜头跟随推演：范围 → 缺失的区县 → 范围 → 样例区县', async () => {
    using ctx = await setup();
    const { run, map, calculator, clock, moves } = ctx;
    run.start(defaultComposition(), calculator);
    await settle();
    const bounds = required(map.data.value, '地图数据').bounds;
    expect(moves).toEqual([{ kind: 'fit', bounds, maxZoom: 10 }]);
    expect(map.labels.value).toEqual([]);

    await clock.advance(QC_CHECKPOINT_AT);
    expect(moves.at(-1)).toMatchObject({ kind: 'fit', maxZoom: 9 });
    expect(map.labels.value.map(label => label.text)).toEqual(
      calculator.missingDistricts(2026, defaultComposition().conditions.cityCodes).map(district => `${district.name} · 人口缺失`)
    );

    run.resolveCheckpoint({ step: 'qc', missing: { kind: 'impute' } });
    await settle();
    expect(moves.at(-1)).toEqual({ kind: 'fit', bounds, maxZoom: 10 });
    await clock.advance(1200);
    run.resolveCheckpoint({ step: 'spatial' });
    await settle();
    expect(moves.at(-1)).toEqual({ kind: 'fly', center: map.data.value?.sample?.center });
  });

  it('停止跟随后镜头不动；恢复跟随时回到当前该看的位置', async () => {
    using ctx = await setup();
    const { run, map, calculator, clock, moves } = ctx;
    run.start(defaultComposition(), calculator);
    await settle();
    map.stopFollowing();
    await clock.advance(QC_CHECKPOINT_AT);
    expect(moves).toHaveLength(1);

    map.resumeFollowing();
    expect(map.following.value).toBe(true);
    expect(moves.at(-1)).toMatchObject({ kind: 'fit', maxZoom: 9 });
  });

  it('评价分级后标出各市的值和达标；没开始时没有数据和分组', async () => {
    using ctx = await setup();
    const { run, map, calculator, clock } = ctx;
    expect(map.data.value).toBeNull();
    expect(map.deriveDistricts()).toEqual({ sources: {}, layers: [] });

    run.start(defaultComposition(), calculator);
    await clock.advance(QC_CHECKPOINT_AT);
    run.resolveCheckpoint({ step: 'qc', missing: { kind: 'impute' } });
    await clock.advance(1200);
    run.resolveCheckpoint({ step: 'spatial' });
    await clock.advance(5200 + 3400 + 2400);
    const cities = map.labels.value;
    expect(cities).toHaveLength(13);
    expect(cities.filter(label => label.pass)).toHaveLength(5);
    expect(cities[0]?.text).toBe('南京 47.7%');
  });
});
