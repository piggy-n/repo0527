// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { JIANGSU_CITIES } from '@/shared/map/region/region-catalog';
import { defaultParams } from '../model/params';
import { areaScope, citiesScope, scopeCityCodes } from '../model/scope';
import { NANJING_RINGS, testArea } from '../model/test-area';
import { loadTestAtlas } from '../model/test-atlas';
import {
  affectedIndicators,
  type Composition,
  emptyComposition,
  missingConditions,
  sampleComposition,
  searchIndicators,
  rememberedScopes,
  withAllCities,
  withArea,
  withCity,
  withIndicator,
  withIndicatorMoved,
  withScopeKind,
  withYear
} from './composition';

const composition = (indicatorIds: readonly string[]): Composition => ({
  conditions: { years: [2026], scope: citiesScope(['320100']), indicatorIds },
  params: defaultParams()
});

describe('条件', () => {
  it('空的编排没有条件、参数是标准口径；演示用的编排是最新年度、全省和三项指标', () => {
    expect(missingConditions(emptyComposition().conditions)).toEqual(['years', 'region', 'indicators']);
    expect(emptyComposition().params).toBe(defaultParams());
    expect(sampleComposition().conditions).toEqual({
      years: [2026],
      scope: citiesScope(JIANGSU_CITIES.map(city => city.code)),
      indicatorIds: ['B-65', 'A-31', 'A-39']
    });
  });

  it('年度新的在前、不重复；不在可选范围里的抛错', () => {
    let next = withYear(emptyComposition(), 2023, true);
    next = withYear(next, 2026, true);
    next = withYear(next, 2023, true);
    expect(next.conditions.years).toEqual([2026, 2023]);
    expect(withYear(next, 2026, false).conditions.years).toEqual([2023]);
    expect(() => withYear(next, 2019, true)).toThrow('没有可选的年度 2019');
  });

  it('市按区划目录的顺序；全省全选或清空', () => {
    let next = withCity(emptyComposition(), '321300', true);
    next = withCity(next, '320100', true);
    expect(next.conditions.scope).toEqual(citiesScope(['320100', '321300']));
    expect(scopeCityCodes(withAllCities(next, true).conditions.scope)).toHaveLength(13);
    expect(withAllCities(next, false).conditions.scope).toEqual(citiesScope([]));
    expect(() => withCity(next, '110000', true)).toThrow('没有城市');
  });

  it('指标加在最后；已经有的不变；去掉；移动按位置', () => {
    const next = withIndicator(composition(['B-65', 'A-31']), 'A-39', true);
    expect(next.conditions.indicatorIds).toEqual(['B-65', 'A-31', 'A-39']);
    expect(withIndicator(next, 'A-39', true)).toBe(next);
    expect(withIndicator(next, 'A-31', false).conditions.indicatorIds).toEqual(['B-65', 'A-39']);
    expect(withIndicatorMoved(next, 2, 0).conditions.indicatorIds).toEqual(['A-39', 'B-65', 'A-31']);
    expect(() => withIndicatorMoved(next, 0, 3)).toThrow('超出范围');
    expect(() => withIndicator(next, 'G01-6', true)).toThrow('计算不支持指标 G01-6');
  });
});

describe('参数与指标的关系', () => {
  it('计算规程只影响社区卫生，覆盖认定只影响住宅用地覆盖率，人口只影响人均类', () => {
    const { conditions } = composition(['B-65', 'A-31', 'A-15', 'A-39']);
    expect(affectedIndicators('rule', conditions)).toEqual(['A-31']);
    expect(affectedIndicators('recognition', conditions)).toEqual(['B-65', 'A-31']);
    expect(affectedIndicators('popChange', conditions)).toEqual(['A-39']);
  });

  it('搜索按名称、简称或编码（编码不分大小写）', () => {
    expect(searchIndicators('公园').map(item => item.id)).toEqual(['B-65', 'A-39']);
    expect(searchIndicators('小学覆盖').map(item => item.id)).toEqual(['A-32']);
    expect(searchIndicators('a-31').map(item => item.id)).toEqual(['A-31']);
    expect(searchIndicators('  ')).toHaveLength(22);
  });
});

describe('两种监测范围（ADR 0121）', () => {
  it('切换范围的种类时恢复这种范围上一次的选择，另一种记着', async () => {
    const area = await testArea(await loadTestAtlas(), NANJING_RINGS);
    const cities = withCity(composition(['A-31']), '320500', true);
    const custom = withArea(cities, area);
    expect(custom.conditions.scope).toEqual(areaScope(area));
    expect(rememberedScopes(custom)).toEqual({ cityCodes: ['320100', '320500'], area });

    const back = withScopeKind(custom, 'cities');
    expect(back.conditions.scope).toEqual(citiesScope(['320100', '320500']));
    expect(withScopeKind(back, 'area').conditions.scope).toEqual(areaScope(area));
    expect(withScopeKind(back, 'cities')).toBe(back);
  });

  it('还没有自定义范围时算缺监测范围；移除范围后仍是自定义范围、等着重新上传或绘制', async () => {
    const area = await testArea(await loadTestAtlas(), NANJING_RINGS);
    const empty = withScopeKind(composition(['A-31']), 'area');
    expect(empty.conditions.scope).toEqual(areaScope(null));
    expect(missingConditions(empty.conditions)).toEqual(['region']);
    const removed = withArea(withArea(empty, area), null);
    expect(removed.conditions.scope).toEqual(areaScope(null));
    expect(rememberedScopes(removed).area).toBeNull();
  });

  it('自定义范围下不能按市增减', async () => {
    const area = await testArea(await loadTestAtlas(), NANJING_RINGS);
    const custom = withArea(composition(['A-31']), area);
    expect(() => withCity(custom, '320500', true)).toThrow('自定义范围不能按市增减');
    expect(() => withAllCities(custom, true)).toThrow('自定义范围不能按市增减');
  });
});
