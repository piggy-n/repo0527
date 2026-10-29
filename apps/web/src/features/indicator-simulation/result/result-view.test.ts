// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { JIANGSU_CITIES } from '@/shared/map/region/region-catalog';
import { idleEngineState, type SimulationVersion } from '../engine/engine';
import { DIFF_COLORS, PASS_COLORS, VALUE_COLORS } from '../map/colors';
import { indicatorResult, passState } from '../model/analysis';
import { type Calculator, createCalculator } from '../model/calculator';
import { defaultParams, type ParamKey, type SimulationConditions, type SimulationParams } from '../model/params';
import { loadTestAtlas } from '../model/test-atlas';
import type { Rich } from '../run/narrative';
import { comparisonOf, initialSelection, mapColoring, previewChanges, resultSummary, sensitivityNote, versionText } from './result-view';

const conditions: SimulationConditions = {
  years: [2025, 2026],
  cityCodes: JIANGSU_CITIES.map(city => city.code),
  indicatorIds: ['A-39', 'B-65']
};
const withPatch = (patch: Partial<SimulationParams>): SimulationParams => ({ ...defaultParams(), ...patch });
// 模拟情景：相交即算
const intersect = withPatch({ recognition: 'intersect' });

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
  const v2 = versionOf(1, intersect, { index: 0, params: defaultParams(), changes: ['recognition'] });
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
  it('标准口径按同样的条件算一遍；版本直接用它的参数和结果；没有的版本按标准口径', async () => {
    const { calculator, versions, v2 } = await setup();

    const fallback = comparisonOf(calculator, conditions, versions, 'default');
    expect(fallback).toEqual({ label: '标准口径', params: defaultParams(), result: calculator.compute(conditions, defaultParams()) });
    expect(comparisonOf(calculator, conditions, versions, 1)).toEqual({ label: 'v2', params: v2.params, result: v2.result });
    expect(comparisonOf(calculator, conditions, versions, 5).label).toBe('标准口径');
  });
});

describe('versionText', () => {
  it('没有改动时是编排时的参数，否则列出改了什么', async () => {
    const { v1, v2 } = await setup();

    expect(versionText(v1, conditions)).toBe('编排时的参数');
    expect(versionText(v2, conditions)).toBe('覆盖认定 覆盖 ≥ 50% → 相交即算');
  });
});

describe('resultSummary', () => {
  it('第一版和标准口径比：66.6%、5/13 市达标、较上一年度；结论只有一段', async () => {
    const { calculator, versions, v1 } = await setup();
    const summary = resultSummary(calculator, conditions, v1, comparisonOf(calculator, conditions, versions, 'default'), 'B-65', 2026);

    expect(summary.kpis.slice(0, 2)).toEqual([
      { label: '2026 年全省', value: '66.6', unit: '%', delta: '持平', tone: 'flat' },
      { label: '达标城市', value: '5', unit: '/ 13', delta: '持平', tone: 'flat' }
    ]);
    expect(summary.kpis[2]).toMatchObject({ label: '较 2025 年', unit: '点', delta: '年度变化' });
    expect(summary.previousYear).toBe(2025);
    expect(summary.attribution).toEqual([]);
    expect(summary.insight).toHaveLength(1);
    expect(text(summary.insight[0])).toMatch(/^2026 年公园绿地覆盖率全省 \[66\.6%\]，\[5\/13\] 市达到目标 70%，短板在 \[苏州市、/);
  });

  it('第二版和第一版比：数字的变化、主要的归因，版本名两边留空格', async () => {
    const { calculator, versions, v2 } = await setup();
    const summary = resultSummary(calculator, conditions, v2, comparisonOf(calculator, conditions, versions, 0), 'B-65', 2026);

    expect(summary.kpis[0]).toMatchObject({ label: '2026 年全省', unit: '%', tone: 'up' });
    expect(summary.attribution.map(item => item.key)).toEqual(['recognition']);
    expect(text(summary.insight[0])).toContain('，主要来自覆盖认定（覆盖 ≥ 50% → 相交即算）。');
    expect(text(summary.insight[0])).toContain('较 v1 [+');
  });

  it('只有一个年度时第三个数字是最低城市；人均类的单位前空一格', async () => {
    const { calculator, v1 } = await setup();
    const single = { ...conditions, years: [2026] };
    const summary = resultSummary(calculator, single, v1, comparisonOf(calculator, single, [v1], 'default'), 'A-39', 2026);

    expect(summary.previousYear).toBeNull();
    expect(summary.kpis[2]).toMatchObject({ label: '最低城市', unit: '', tone: 'flat' });
    expect(text(summary.insight[0])).toContain('达到目标 15 m²');
    expect(text(summary.insight[0])).not.toContain('较');
  });

  it('参数敏感性的说明：覆盖率写出取不同值的参数，人均类是人口曲线', async () => {
    const { calculator, versions, v1 } = await setup();
    const compare = comparisonOf(calculator, conditions, versions, 'default');

    const noteOf = (id: string) => {
      const value = resultSummary(calculator, conditions, v1, compare, id, 2026).sensitivity;
      return value && sensitivityNote(value);
    };

    expect(noteOf('B-65')).toBe('覆盖认定的两种取法');
    expect(noteOf('A-39')).toBe('随常住人口变化');
    expect(sensitivityNote({ kind: 'options', keys: ['rule', 'recognition'], options: [] })).toBe('计算规程、覆盖认定的组合');
  });
});

describe('mapColoring', () => {
  it('数值五档：图例从高到低，区县按标准口径的分位数着色', async () => {
    const { calculator, versions, v2 } = await setup();
    const selection = { viewIndex: 1, compare: 0, indicatorId: 'B-65', year: 2026, mode: 'value' } as const;
    const { fill, legend } = mapColoring(calculator, conditions, selection, v2, comparisonOf(calculator, conditions, versions, 0));

    expect(legend.title).toBe('2026 年 · 公园绿地覆盖率（%）');
    expect(legend.entries.map(entry => entry.text)).toEqual(['≥ 82', '72 – 82', '61 – 72', '44 – 61', '< 44']);
    expect(legend.entries.map(entry => entry.color)).toEqual(VALUE_COLORS.toReversed());
    const rows = rowsOf(calculator, intersect);
    const top = rows.find(row => row.value >= 82);
    const bottom = rows.find(row => row.value < 44);
    expect([top && fill(top), bottom && fill(bottom)]).toEqual([VALUE_COLORS[4], VALUE_COLORS[0]]);
  });

  it('达标三态：按目标值', async () => {
    const { calculator, versions, v2 } = await setup();
    const selection = { viewIndex: 1, compare: 0, indicatorId: 'B-65', year: 2026, mode: 'pass' } as const;
    const { fill, legend } = mapColoring(calculator, conditions, selection, v2, comparisonOf(calculator, conditions, versions, 0));

    expect(legend.title).toBe('对照目标 70%');
    expect(legend.entries.map(entry => entry.text)).toEqual(['达标', '接近（差 5% 以内）', '未达标']);
    for (const row of rowsOf(calculator, intersect)) {
      expect(fill(row)).toBe(PASS_COLORS[passState(row.value, 70)]);
    }
  });

  it('差值：和对比的一方逐个区县比，上升为红、下降为绿；值都相同时说明原因', async () => {
    const { calculator, versions, v2 } = await setup();
    const selection = { viewIndex: 1, compare: 0, indicatorId: 'B-65', year: 2026, mode: 'diff' } as const;
    const { fill, legend } = mapColoring(calculator, conditions, selection, v2, comparisonOf(calculator, conditions, versions, 0));

    expect(legend.title).toBe('较 v1 变化（百分点）');
    expect(legend.entries.map(entry => entry.color)).toEqual(DIFF_COLORS.toReversed());
    // 明显上升是红色、明显下降是绿色
    expect([legend.entries[0], legend.entries[4]]).toEqual([
      { color: '#d9574e', text: '明显上升', shape: 'block' },
      { color: '#2f9e74', text: '明显下降', shape: 'block' }
    ]);
    expect(legend.note).toBeNull();
    const before = new Map(rowsOf(calculator, defaultParams()).map(row => [row.code, row.value]));
    const rows = rowsOf(calculator, intersect);
    const most = rows.toSorted((a, b) => b.value - (before.get(b.code) ?? 0) - (a.value - (before.get(a.code) ?? 0)))[0];
    expect(most && fill(most)).toBe(DIFF_COLORS[4]);
    expect(new Set(rows.map(fill)).has(DIFF_COLORS[0])).toBe(false);

    const same = mapColoring(calculator, conditions, { ...selection, compare: 1 }, v2, comparisonOf(calculator, conditions, versions, 1));
    expect(same.legend.note).toBe('区县值与对比的一方相同');
    expect(same.legend.entries[2]?.text).toBe('基本不变');
    expect(new Set(rows.map(same.fill))).toEqual(new Set([DIFF_COLORS[2]]));
  });
});

describe('previewChanges', () => {
  it('参数没变时没有区县；放宽认定后列出达标状态会变的区县', async () => {
    const { calculator } = await setup();

    expect(previewChanges(calculator, conditions, defaultParams(), defaultParams(), 'B-65', 2026).size).toBe(0);
    const changed = previewChanges(calculator, conditions, defaultParams(), intersect, 'B-65', 2026);
    const after = new Map(rowsOf(calculator, intersect).map(row => [row.code, row.pass]));
    const flipped = rowsOf(calculator, defaultParams())
      .filter(row => after.get(row.code) !== row.pass)
      .map(row => row.code);
    expect(flipped.length).toBeGreaterThan(0);
    expect([...changed]).toEqual(flipped);
  });
});
