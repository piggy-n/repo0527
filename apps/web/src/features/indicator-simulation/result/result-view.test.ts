// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { JIANGSU_CITIES } from '@/shared/map/region/region-catalog';
import { idleEngineState, type SimulationVersion } from '../engine/engine';
import { PASS_COLORS, VALUE_COLORS } from '../map/colors';
import { indicatorResult, passState } from '../model/analysis';
import { createCalculator } from '../model/calculator';
import { defaultParams, type SimulationConditions, type SimulationParams } from '../model/params';
import { loadTestAtlas } from '../model/test-atlas';
import { mapColoring, rankOf, resolveSelection, resultItems } from './result-view';

const conditions: SimulationConditions = {
  years: [2025, 2026],
  cityCodes: JIANGSU_CITIES.map(city => city.code),
  indicatorIds: ['A-39', 'B-65']
};
// 模拟情景：相交即算
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
    expect(resolveSelection(done, {})).toEqual({ indicatorId: 'B-65', year: 2026, mode: 'value', cityCode: null });
  });

  it('选过的还在条件里就沿用，不在了换回默认；只有一个市时不放大', async () => {
    const { version } = await setup();
    const done = { ...idleEngineState(), conditions, versions: [version] };

    expect(resolveSelection(done, { indicatorId: 'A-39', year: 2025, mode: 'pass', cityCode: '320500' })).toEqual({
      indicatorId: 'A-39',
      year: 2025,
      mode: 'pass',
      cityCode: '320500'
    });
    expect(resolveSelection(done, { indicatorId: 'A-31', year: 2021 })).toMatchObject({ indicatorId: 'B-65', year: 2026 });
    const single = { ...done, conditions: { ...conditions, cityCodes: ['320500'] } };
    expect(resolveSelection(single, { cityCode: '320500' })?.cityCode).toBeNull();
  });
});

describe('resultItems', () => {
  it('每项指标一条，顺序同条件：多个市时写达标几市，全部、部分、都没有对应三态；模拟情景标出来', async () => {
    const { version } = await setup(conditions, intersect);
    const items = resultItems(version, conditions, 2026);
    const b65 = indicatorResult(version.result[2026]?.indicators ?? {}, 'B-65');

    expect(items.map(item => item.id)).toEqual(['A-39', 'B-65']);
    expect(items[1]).toMatchObject({
      short: '公园绿地覆盖率',
      value: b65.value,
      target: 70,
      verdict: `达标 ${b65.passCount}/13 市`,
      state: 'near',
      scenario: true
    });
    expect(items[0]?.scenario).toBe(false);
  });

  it('只有一个市时写这个市的达标', async () => {
    const single = { ...conditions, cityCodes: ['320500'] };
    const { version } = await setup(single);
    const [park] = resultItems(version, single, 2026);
    const value = indicatorResult(version.result[2026]?.indicators ?? {}, 'A-39').value;

    expect(park?.state).toBe(passState(value, 15));
    expect(park?.verdict).toBe({ pass: '达标', near: '接近达标', fail: '未达标' }[passState(value, 15)]);
  });
});

describe('rankOf', () => {
  it('多个市时列各市，从高到低、去掉"市"、可以点；满格比目标和最大值都大', async () => {
    const { version } = await setup();
    const rank = rankOf(version, conditions, 'B-65', 2026);
    const values = rank.rows.map(row => row.value);

    expect(rank.level).toBe('city');
    expect(rank.rows).toHaveLength(13);
    expect(values).toEqual(values.toSorted((a, b) => b - a));
    expect(rank.rows.every(row => row.cityCode === row.key && !row.name.endsWith('市'))).toBe(true);
    expect(rank.rows.map(row => row.state)).toEqual(values.map(value => passState(value, 70)));
    expect(rank.max).toBeGreaterThan(Math.max(rank.target, ...values));
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
    const selection = { indicatorId: 'B-65', year: 2026, mode: 'value', cityCode: null } as const;
    const { fill, legend } = mapColoring(calculator, conditions, selection, version);

    expect([legend.title, legend.subtitle]).toEqual(['公园绿地覆盖率', '2026 年 · 单位 %']);
    expect(legend.entries.map(entry => entry.text)).toEqual(['≥ 82', '72 – 82', '61 – 72', '44 – 61', '< 44']);
    expect(legend.entries.map(entry => entry.color)).toEqual(VALUE_COLORS.toReversed());
    const rows = indicatorResult(version.result[2026]?.indicators ?? {}, 'B-65').rows;
    const top = rows.find(row => row.value >= 82);
    const bottom = rows.find(row => row.value < 44);
    expect([top && fill(top), bottom && fill(bottom)]).toEqual([VALUE_COLORS[4], VALUE_COLORS[0]]);
  });

  it('达标三态：按目标值，图例写目标', async () => {
    const { calculator, version } = await setup();
    const selection = { indicatorId: 'A-39', year: 2025, mode: 'pass', cityCode: null } as const;
    const { fill, legend } = mapColoring(calculator, conditions, selection, version);

    expect([legend.title, legend.subtitle]).toEqual(['人均公园绿地', '2025 年 · 目标 ≥ 15 m²']);
    expect(legend.entries.map(entry => entry.text)).toEqual(['达标', '接近（差 5% 以内）', '未达标']);
    for (const row of indicatorResult(version.result[2025]?.indicators ?? {}, 'A-39').rows) {
      expect(fill(row)).toBe(PASS_COLORS[passState(row.value, 15)]);
    }
  });
});
