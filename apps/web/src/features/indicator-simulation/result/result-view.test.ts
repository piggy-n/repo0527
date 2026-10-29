// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { JIANGSU_CITIES } from '@/shared/map/region/region-catalog';
import { idleEngineState, type SimulationVersion } from '../engine/engine';
import { DIFF_COLORS, EXCLUDED_COLOR, PASS_COLORS, VALUE_COLORS } from '../map/colors';
import { indicatorResult, passState } from '../model/analysis';
import { type Calculator, createCalculator } from '../model/calculator';
import { defaultParams, type ParamKey, type SimulationConditions, type SimulationParams } from '../model/params';
import { loadTestAtlas } from '../model/test-atlas';
import type { Rich } from '../run/narrative';
import { comparisonOf, initialSelection, mapColoring, previewChanges, resultSummary, versionText } from './result-view';

const conditions: SimulationConditions = {
  years: [2025, 2026],
  cityCodes: JIANGSU_CITIES.map(city => city.code),
  indicatorIds: ['A-39', 'B-65']
};
const withPatch = (patch: Partial<SimulationParams>): SimulationParams => ({ ...defaultParams(), ...patch });
// 建议情景：公园绿地新增 20%，作用于同一种设施的两项指标
const suggested = withPatch({ newFacilities: 20, scenarioIds: ['B-65', 'A-39'] });

async function setup() {
  const calculator = createCalculator(await loadTestAtlas());
  const versionOf = (
    index: number,
    params: SimulationParams,
    base: { index: number | null; params: SimulationParams; changes: readonly ParamKey[] }
  ): SimulationVersion => ({
    index,
    label: `v${index + 1}`,
    params,
    result: calculator.compute(conditions, params),
    baseIndex: base.index,
    baseParams: base.params,
    changes: base.changes
  });
  const v1 = versionOf(0, defaultParams(), { index: null, params: defaultParams(), changes: [] });
  const v2 = versionOf(1, suggested, { index: 0, params: defaultParams(), changes: ['newFacilities'] });
  return { calculator, versionOf, v1, v2, versions: [v1, v2] };
}

const text = (paragraph: Rich | undefined) =>
  (paragraph ?? []).map(part => (typeof part === 'string' ? part : `[${part.em}]`)).join('');

const rowsOf = (calculator: Calculator, params: SimulationParams, id = 'B-65') =>
  indicatorResult(calculator.computeYear(conditions, params, 2026).indicators, id).rows;

describe('initialSelection', () => {
  it('还没有版本时没有选择；有版本时看最新一版，和它所基于的版本比，主指标、最新年度、数值着色', async () => {
    const { v1, v2 } = await setup();

    expect(initialSelection(idleEngineState())).toBeNull();
    expect(initialSelection({ ...idleEngineState(), conditions, versions: [v1] })).toEqual({
      viewIndex: 0,
      compare: 'default',
      indicatorId: 'B-65',
      year: 2026,
      mode: 'value'
    });
    expect(initialSelection({ ...idleEngineState(), conditions, versions: [v1, v2] })).toMatchObject({ viewIndex: 1, compare: 0 });
  });
});

describe('comparisonOf', () => {
  it('默认参数按同样的条件算一遍；版本直接用它的参数和结果；没有的版本按默认参数', async () => {
    const { calculator, versions, v2 } = await setup();

    const fallback = comparisonOf(calculator, conditions, versions, 'default');
    expect(fallback).toEqual({ label: '默认参数', params: defaultParams(), result: calculator.compute(conditions, defaultParams()) });
    expect(comparisonOf(calculator, conditions, versions, 1)).toEqual({ label: 'v2', params: v2.params, result: v2.result });
    expect(comparisonOf(calculator, conditions, versions, 5).label).toBe('默认参数');
  });
});

describe('versionText', () => {
  it('没有改动时是编排时的参数，否则列出改了什么', async () => {
    const { v1, v2 } = await setup();

    expect(versionText(v1, conditions)).toBe('编排时的参数');
    expect(versionText(v2, conditions)).toContain('20%');
  });
});

describe('resultSummary', () => {
  it('第一版和默认参数比：64.6%、5/13 市达标、较上一年度；建议新增 20% 公园绿地达到 70.3%、7 市', async () => {
    const { calculator, versions, v1 } = await setup();
    const summary = resultSummary(calculator, conditions, v1, comparisonOf(calculator, conditions, versions, 'default'), 'B-65', 2026);

    expect(summary.kpis).toEqual([
      { label: '2026 年全省', value: '64.6', unit: '%', delta: '持平', tone: 'flat' },
      { label: '达标城市', value: '5', unit: '/ 13', delta: '持平', tone: 'flat' },
      { label: '较 2025 年', value: '+1.5', unit: '点', delta: '年度变化', tone: 'up' }
    ]);
    expect(summary.previousYear).toBe(2025);
    expect(summary.attribution).toEqual([]);
    expect(text(summary.insight[0])).toBe(
      '2026 年公园绿地覆盖率全省 [64.6%]，[5/13] 市达到演示目标 70%，短板在 [苏州市、南京市]。较 2025 年 [+1.5 个百分点]。'
    );
    expect(text(summary.insight[1])).toBe('建议情景：规划新增 [20%] 公园绿地，预计 [64.6% → 70.3%]，达标 [5 → 7] 市。');
    expect(summary.idea).toMatchObject({ add: 20, reached: true, scenarioIds: ['A-39', 'B-65'] });
  });

  it('第二版和第一版比：数字的变化、主要的归因，版本名两边留空格', async () => {
    const { calculator, versions, v2 } = await setup();
    const summary = resultSummary(calculator, conditions, v2, comparisonOf(calculator, conditions, versions, 0), 'B-65', 2026);

    expect(summary.kpis.slice(0, 2)).toEqual([
      { label: '2026 年全省', value: '70.3', unit: '%', delta: '+5.7 点', tone: 'up' },
      { label: '达标城市', value: '7', unit: '/ 13', delta: '+2 市', tone: 'up' }
    ]);
    expect(summary.attribution.map(item => [item.key, item.passDelta])).toEqual([['newFacilities', 2]]);
    expect(text(summary.insight[0])).toContain('较 v1 [+5.7 个百分点]，主要来自规划新增设施（0% → 20%（公园绿地覆盖率、人均公园绿地））。');
  });

  it('只有一个年度时第三个数字是最低城市；人均类的单位前空一格', async () => {
    const { calculator, v1 } = await setup();
    const single = { ...conditions, years: [2026] };
    const summary = resultSummary(calculator, single, v1, comparisonOf(calculator, single, [v1], 'default'), 'A-39', 2026);

    expect(summary.previousYear).toBeNull();
    expect(summary.kpis[2]).toEqual({ label: '最低城市', value: '南京市', unit: '', delta: '12.25 m²', tone: 'flat' });
    expect(text(summary.insight[0])).toContain('达到演示目标 15 m²');
    expect(text(summary.insight[0])).not.toContain('较');
  });
});

describe('mapColoring', () => {
  it('数值五档：图例从高到低，区县按默认参数的分位数着色', async () => {
    const { calculator, versions, v2 } = await setup();
    const selection = { viewIndex: 1, compare: 0, indicatorId: 'B-65', year: 2026, mode: 'value' } as const;
    const { fill, legend } = mapColoring(calculator, conditions, selection, v2, comparisonOf(calculator, conditions, versions, 0));

    expect(legend.title).toBe('2026 年 · 公园绿地覆盖率（%）');
    expect(legend.entries.map(entry => entry.text)).toEqual(['≥ 83', '72 – 83', '61 – 72', '45 – 61', '< 45']);
    expect(legend.entries.map(entry => entry.color)).toEqual(VALUE_COLORS.toReversed());
    const rows = rowsOf(calculator, suggested);
    const top = rows.find(row => row.value >= 83);
    const bottom = rows.find(row => row.value < 45);
    expect([top && fill(top), bottom && fill(bottom)]).toEqual([VALUE_COLORS[4], VALUE_COLORS[0]]);
  });

  it('达标三态：按演示目标', async () => {
    const { calculator, versions, v2 } = await setup();
    const selection = { viewIndex: 1, compare: 0, indicatorId: 'B-65', year: 2026, mode: 'pass' } as const;
    const { fill, legend } = mapColoring(calculator, conditions, selection, v2, comparisonOf(calculator, conditions, versions, 0));

    expect(legend.title).toBe('对照演示目标 70%');
    expect(legend.entries.map(entry => entry.text)).toEqual(['达标', '接近（差 5% 以内）', '未达标']);
    for (const row of rowsOf(calculator, suggested)) {
      expect(fill(row)).toBe(PASS_COLORS[passState(row.value, 70)]);
    }
  });

  it('差值：和对比的一方逐个区县比，上升为绿、下降为红；值都相同时说明原因', async () => {
    const { calculator, versions, v2 } = await setup();
    const selection = { viewIndex: 1, compare: 0, indicatorId: 'B-65', year: 2026, mode: 'diff' } as const;
    const { fill, legend } = mapColoring(calculator, conditions, selection, v2, comparisonOf(calculator, conditions, versions, 0));

    expect(legend.title).toBe('较 v1 变化（百分点）');
    expect(legend.entries.map(entry => entry.color)).toEqual(DIFF_COLORS.toReversed());
    expect(legend.note).toBeNull();
    const before = new Map(rowsOf(calculator, defaultParams()).map(row => [row.code, row.value]));
    const rows = rowsOf(calculator, suggested);
    const most = rows.toSorted((a, b) => b.value - (before.get(b.code) ?? 0) - (a.value - (before.get(a.code) ?? 0)))[0];
    expect(most && fill(most)).toBe(DIFF_COLORS[4]);
    expect(new Set(rows.map(fill)).has(DIFF_COLORS[0])).toBe(false);

    const same = mapColoring(calculator, conditions, { ...selection, compare: 1 }, v2, comparisonOf(calculator, conditions, versions, 1));
    expect(same.legend.note).toBe('区县值与对比版本相同（变化只在汇总权重上）');
    expect(same.legend.entries[2]?.text).toBe('基本不变');
    expect(new Set(rows.map(same.fill))).toEqual(new Set([DIFF_COLORS[2]]));
  });

  it('剔除了缺失人口的区县时，它们是灰色，图例多一行', async () => {
    const { calculator, versionOf } = await setup();
    const excluding = withPatch({ missing: { kind: 'exclude' } });
    const version = versionOf(0, excluding, { index: null, params: excluding, changes: [] });
    const selection = { viewIndex: 0, compare: 'default', indicatorId: 'B-65', year: 2026, mode: 'pass' } as const;
    const { fill, legend } = mapColoring(calculator, conditions, selection, version, comparisonOf(calculator, conditions, [version], 'default'));

    expect(legend.entries.at(-1)).toEqual({ color: EXCLUDED_COLOR, text: '已剔除（人口缺失）', shape: 'block' });
    const rows = rowsOf(calculator, excluding);
    const excluded = rows.filter(row => row.excluded);
    expect(excluded.length).toBeGreaterThan(0);
    expect(new Set(excluded.map(fill))).toEqual(new Set([EXCLUDED_COLOR]));
  });
});

describe('previewChanges', () => {
  it('参数没变时没有区县；新增设施后列出达标状态会变的区县', async () => {
    const { calculator } = await setup();

    expect(previewChanges(calculator, conditions, defaultParams(), defaultParams(), 'B-65', 2026).size).toBe(0);
    const changed = previewChanges(calculator, conditions, defaultParams(), suggested, 'B-65', 2026);
    const after = new Map(rowsOf(calculator, suggested).map(row => [row.code, row.pass]));
    const flipped = rowsOf(calculator, defaultParams())
      .filter(row => after.get(row.code) !== row.pass)
      .map(row => row.code);
    expect(flipped.length).toBeGreaterThan(0);
    expect([...changed]).toEqual(flipped);
  });
});
