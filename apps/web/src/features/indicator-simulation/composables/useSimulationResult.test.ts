// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { effectScope } from 'vue';
import { required } from '@/shared/testing/required';
import { sampleComposition } from '../compose/composition';
import { ManualClock } from '../engine/test-clock';
import { createCalculator } from '../model/calculator';
import { defaultParams } from '../model/params';
import { loadTestAtlas } from '../model/test-atlas';
import { useSimulationResult } from './useSimulationResult';
import { useSimulationRun } from './useSimulationRun';

// 各步的时长按推理的话多少给：推进这么久一定计算完；6100 时还在计算中
const DONE_AT = 120_000;
const QC_AT = 6100;

const composition = { ...sampleComposition(), conditions: { ...sampleComposition().conditions, years: [2025, 2026] } };
const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0));

async function setup() {
  const calculator = createCalculator(await loadTestAtlas());
  const clock = new ManualClock();
  const scope = effectScope();
  const owned = required(
    scope.run(() => {
      const run = useSimulationRun(clock);
      return { run, result: useSimulationResult(run) };
    }),
    '计算和结果'
  );
  const finish = async () => {
    await clock.advance(DONE_AT);
    await settle();
  };
  const runToDone = async () => {
    owned.run.start(composition, calculator);
    await finish();
  };
  return { ...owned, calculator, clock, finish, runToDone, [Symbol.dispose]: () => scope.stop() };
}

describe('useSimulationResult', () => {
  it('完成前没有结果；完成后看主指标、最新年度、数值着色、整个范围，列出每项指标和各市', async () => {
    using ctx = await setup();
    const { run, result, calculator, clock, runToDone } = ctx;
    run.start(composition, calculator);
    await clock.advance(QC_AT);
    await settle();
    expect(result.selection.value).toBeNull();
    expect([result.items.value, result.rank.value, result.coloring.value]).toEqual([[], null, null]);
    expect(() => result.select({ mode: 'pass' })).toThrow('还没有计算结果');
    run.stop();

    await runToDone();
    expect(result.selection.value).toEqual({ indicatorId: 'B-65', year: 2026, mode: 'value', cityCode: null });
    expect(result.items.value.map(item => item.id)).toEqual(composition.conditions.indicatorIds);
    expect(result.items.value.find(item => item.id === 'B-65')).toMatchObject({ verdict: '达标 5/13 市' });
    expect(result.rank.value?.rows).toHaveLength(13);
    expect(result.coloring.value?.legend.subtitle).toBe('2026 年 · 单位 %');
  });

  it('改指标、年度、着色、放大的市；不在条件里的抛错', async () => {
    using ctx = await setup();
    const { result, runToDone } = ctx;
    await runToDone();

    result.select({ indicatorId: 'A-39', year: 2025, mode: 'pass', cityCode: '320500' });
    expect(result.selection.value).toEqual({ indicatorId: 'A-39', year: 2025, mode: 'pass', cityCode: '320500' });
    expect(result.coloring.value?.legend.subtitle).toBe('2025 年 · 目标 ≥ 15 m²');

    expect(() => result.select({ indicatorId: 'B-99' })).toThrow('计算条件里没有指标 B-99');
    expect(() => result.select({ year: 2020 })).toThrow('2020 年');
    expect(() => result.select({ cityCode: '999999' })).toThrow('市 999999');
    expect(result.selection.value?.indicatorId).toBe('A-39');
  });

  it('改参数重新计算后看最新一版，选过的仍沿用；回到条件配置时清空', async () => {
    using ctx = await setup();
    const { run, result, calculator, finish, runToDone } = ctx;
    await runToDone();
    result.select({ indicatorId: 'A-39', mode: 'pass' });
    const before = result.items.value.find(item => item.id === 'B-65')?.value ?? 0;

    expect(run.apply({ ...defaultParams(), recognition: 'intersect' })).toBe('rerun');
    await finish();
    expect(result.version.value?.label).toBe('v2');
    expect(result.selection.value).toMatchObject({ indicatorId: 'A-39', mode: 'pass' });
    expect(result.items.value.find(item => item.id === 'B-65')?.value).toBeGreaterThan(before);

    result.setHoverCity('320100');
    run.stop();
    await settle();
    expect(result.hoverCity.value).toBeNull();
    run.start(composition, calculator);
    await finish();
    expect(result.selection.value).toMatchObject({ indicatorId: 'B-65', mode: 'value' });
  });
});
