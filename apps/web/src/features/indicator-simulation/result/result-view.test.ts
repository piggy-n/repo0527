// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { JIANGSU_CITIES } from '@/shared/map/region/region-catalog';
import { idleEngineState, type SimulationVersion } from '../engine/engine';
import { VALUE_COLORS } from '../map/colors';
import { indicatorResult } from '../model/analysis';
import { createCalculator } from '../model/calculator';
import { defaultParams, type SimulationConditions, type SimulationParams } from '../model/params';
import { loadTestAtlas } from '../model/test-atlas';
import { mapColoring, rankOf, resolveSelection, resultItems } from './result-view';

const conditions: SimulationConditions = {
  years: [2025, 2026],
  cityCodes: JIANGSU_CITIES.map(city => city.code),
  indicatorIds: ['A-39', 'B-65']
};
// 自定义口径：相交即算
const intersect: SimulationParams = { ...defaultParams(), recognition: 'intersect' };

async function setup(scope: SimulationConditions = conditions, params = defaultParams()) {
  const calculator = createCalculator(await loadTestAtlas());
  const version: SimulationVersion = {
    index: 0,
    label: 'v1',
    params,
    result: calculator.compute(scope, params),
    baseIndex: null,
    baseParams: defaultParams(),
    changes: []
  };
  return { calculator, version };
}

describe('resolveSelection', () => {
  it('还没有结果时为 null；默认看主指标、最新年度、数值着色、整个范围', async () => {
    const { version } = await setup();
    const done = { ...idleEngineState(), conditions, versions: [version] };

    expect(resolveSelection(idleEngineState(), {})).toBeNull();
    expect(resolveSelection(done, {})).toEqual({ indicatorId: 'B-65', year: 2026, cityCode: null });
  });

  it('选过的还在条件里就沿用，不在了换回默认；只有一个市时不放大', async () => {
    const { version } = await setup();
    const done = { ...idleEngineState(), conditions, versions: [version] };

    expect(resolveSelection(done, { indicatorId: 'A-39', year: 2025, cityCode: '320500' })).toEqual({
      indicatorId: 'A-39',
      year: 2025,
      cityCode: '320500'
    });
    expect(resolveSelection(done, { indicatorId: 'A-31', year: 2021 })).toMatchObject({ indicatorId: 'B-65', year: 2026 });
    const single = { ...done, conditions: { ...conditions, cityCodes: ['320500'] } };
    expect(resolveSelection(single, { cityCode: '320500' })?.cityCode).toBeNull();
  });
});

describe('resultItems', () => {
  it('每项指标一条，顺序同条件：名称、结果和是不是自定义口径，不写目标和达标（2026-10-30）', async () => {
    const { version } = await setup(conditions, intersect);
    const items = resultItems(version, conditions, 2026);
    const b65 = indicatorResult(version.result[2026]?.indicators ?? {}, 'B-65');

    expect(items.map(item => item.id)).toEqual(['A-39', 'B-65']);
    expect(items[1]).toStrictEqual({
      id: 'B-65',
      short: '公园绿地覆盖率',
      name: items[1]?.name,
      value: b65.value,
      scenario: true
    });
    expect(items[0]?.scenario).toBe(false);
  });
});

describe('rankOf', () => {
  it('多个市时列各市，从高到低、去掉"市"、可以点；满格比最大值大', async () => {
    const { version } = await setup();
    const rank = rankOf(version, conditions, 'B-65', 2026);
    const values = rank.rows.map(row => row.value);

    expect(rank.level).toBe('city');
    expect(rank.rows).toHaveLength(13);
    expect(values).toEqual(values.toSorted((a, b) => b - a));
    expect(rank.rows.every(row => row.cityCode === row.key && !row.name.endsWith('市'))).toBe(true);
    expect(rank.max).toBeGreaterThan(Math.max(...values));
    expect(Object.keys(rank).toSorted()).toEqual(['level', 'max', 'rows']);
  });

  it('只有一个市时列它的区县，不能点', async () => {
    const single = { ...conditions, cityCodes: ['320500'] };
    const { calculator, version } = await setup(single);
    const rank = rankOf(version, single, 'B-65', 2026);

    expect(rank.level).toBe('district');
    expect(rank.rows.map(row => row.key).toSorted()).toEqual(calculator.atlas.inCities(['320500']).map(district => district.code).toSorted());
    expect(rank.rows.every(row => row.cityCode === null)).toBe(true);
  });
});

describe('mapColoring', () => {
  it('数值五档：图例从高到低，区县按标准口径的分位数着色', async () => {
    const { calculator, version } = await setup(conditions, intersect);
    const selection = { indicatorId: 'B-65', year: 2026, cityCode: null } as const;
    const { fill, legend } = mapColoring(calculator, conditions, selection);

    expect([legend.title, legend.subtitle]).toEqual(['公园绿地覆盖率', '2026 年 · 单位 %']);
    expect(legend.entries.map(entry => entry.text)).toEqual(['≥ 82', '72 – 82', '61 – 72', '44 – 61', '< 44']);
    expect(legend.entries.map(entry => entry.color)).toEqual(VALUE_COLORS.toReversed());
    const rows = indicatorResult(version.result[2026]?.indicators ?? {}, 'B-65').rows;
    const top = rows.find(row => row.value >= 82);
    const bottom = rows.find(row => row.value < 44);
    expect([top && fill(top), bottom && fill(bottom)]).toEqual([VALUE_COLORS[4], VALUE_COLORS[0]]);
  });
});
