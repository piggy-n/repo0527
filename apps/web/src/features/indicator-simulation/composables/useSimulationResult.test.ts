// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { effectScope } from 'vue';
import { required } from '@/shared/testing/required';
import { sampleComposition } from '../compose/composition';
import { ManualClock } from '../engine/test-clock';
import { createCalculator } from '../model/calculator';
import { defaultParams } from '../model/params';
import { loadTestAtlas } from '../model/test-atlas';
import { previewChanges } from '../result/result-view';
import { useSimulationResult } from './useSimulationResult';
import { useSimulationRun } from './useSimulationRun';

// 各步的时长按推理的话多少给：推进这么久一定推演完；6100 时还在推演中
const DONE_AT = 120_000;
const QC_AT = 6100;
// 干预后重算到完成足够长的时间
const RERUN_ENOUGH = 120_000;

const composition = { ...sampleComposition(), conditions: { ...sampleComposition().conditions, years: [2025, 2026] } };
// 相交即算：公园绿地覆盖率上升
const intersect = { ...defaultParams(), recognition: 'intersect' as const };
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
    '推演和结果'
  );
  const runToDone = async () => {
    owned.run.start(composition, calculator);
    await clock.advance(DONE_AT);
    await settle();
  };
  return { ...owned, calculator, clock, runToDone, [Symbol.dispose]: () => scope.stop() };
}

describe('useSimulationResult', () => {
  it('完成前没有结果；第一版生成后看它：和标准口径比，主指标、最新年度、数值着色', async () => {
    using ctx = await setup();
    const { run, result, calculator, clock, runToDone } = ctx;
    run.start(composition, calculator);
    await clock.advance(QC_AT);
    await settle();
    expect(result.selection.value).toBeNull();
    expect([result.summary.value, result.coloring.value]).toEqual([null, null]);
    expect(() => result.select({ mode: 'pass' })).toThrow('还没有推演结果');
    run.stop();

    await runToDone();
    expect(result.selection.value).toEqual({ viewIndex: 0, compare: 'default', indicatorId: 'B-65', year: 2026, mode: 'value' });
    expect(result.version.value?.label).toBe('v1');
    expect(result.comparison.value?.label).toBe('标准口径');
    expect(result.summary.value?.kpis[0]?.value).toBe('66.6');
    expect(result.coloring.value?.legend.title).toBe('2026 年 · 公园绿地覆盖率（%）');
  });

  it('改指标、年度、着色；不合法的值抛错；对比的一方不能是正在看的一版', async () => {
    using ctx = await setup();
    const { result, runToDone } = ctx;
    await runToDone();

    result.select({ indicatorId: 'A-39', year: 2025, mode: 'pass' });
    expect(result.selection.value).toMatchObject({ indicatorId: 'A-39', year: 2025, mode: 'pass' });
    expect(result.summary.value?.kpis[0]?.label).toBe('2025 年全省');
    expect(result.coloring.value?.legend.title).toBe('对照目标 15 m²');

    expect(() => result.select({ indicatorId: 'B-99' })).toThrow('没有指标 B-99 或年度 2025');
    expect(() => result.select({ year: 2020 })).toThrow('没有指标 A-39 或年度 2020');
    expect(() => result.select({ compare: 3 })).toThrow('没有第 3 个版本');
    result.select({ compare: 0 });
    expect(result.selection.value?.compare).toBe('default');
  });

  it('按模拟情景再推演：新的一版生成后看它、和它所基于的比；换回旧版时和它所基于的比', async () => {
    using ctx = await setup();
    const { run, result, clock, runToDone } = ctx;
    await runToDone();
    const standard = Number(result.summary.value?.kpis[0]?.value);
    result.select({ mode: 'diff' });

    expect(run.apply(intersect, { baseIndex: 0 })).toBe('rerun');
    await clock.advance(RERUN_ENOUGH);
    await settle();
    expect(run.state.value.status).toBe('done');
    expect(result.selection.value).toEqual({ viewIndex: 1, compare: 0, indicatorId: 'B-65', year: 2026, mode: 'value' });
    expect(result.comparison.value?.label).toBe('v1');
    expect(Number(result.summary.value?.kpis[0]?.value)).toBeGreaterThan(standard);

    result.select({ compare: 'default' });
    result.viewVersion(0);
    expect(result.selection.value).toMatchObject({ viewIndex: 0, compare: 'default' });
    result.viewVersion(1);
    expect(result.selection.value).toMatchObject({ viewIndex: 1, compare: 0 });
    expect(() => result.viewVersion(2)).toThrow('没有第 2 个版本');
  });

  it('人工干预的预览：草稿列出达标状态会变的区县，关掉或生成新版本时清空', async () => {
    using ctx = await setup();
    const { run, result, calculator, clock, runToDone } = ctx;
    await runToDone();

    result.setPreview(intersect);
    const expected = previewChanges(calculator, composition.conditions, defaultParams(), intersect, 'B-65', 2026);
    expect(expected.size).toBeGreaterThan(0);
    expect(result.preview.value).toEqual(expected);
    result.setPreview(null);
    expect(result.preview.value.size).toBe(0);

    result.setPreview(intersect);
    run.apply(intersect, { baseIndex: 0 });
    await clock.advance(RERUN_ENOUGH);
    await settle();
    expect(result.selection.value?.viewIndex).toBe(1);
    expect(result.preview.value.size).toBe(0);
  });
});
