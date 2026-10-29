// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { JIANGSU_CITIES } from '@/shared/map/region/region-catalog';
import { defaultParams } from '../model/params';
import {
  affectedIndicators,
  type Composition,
  defaultComposition,
  emptyComposition,
  missingConditions,
  normalizedParams,
  paramValueText,
  searchIndicators,
  withAllCities,
  withCity,
  withIndicator,
  withIndicatorMoved,
  withParams,
  withYear
} from './composition';

const composition = (indicatorIds: readonly string[], scenarioIds: readonly string[] | null = null): Composition => ({
  conditions: { years: [2026], cityCodes: ['320100'], indicatorIds },
  params: { ...defaultParams(), scenarioIds }
});

describe('条件', () => {
  it('打开页面时是最新年度、全省和三项指标；清空后没有条件', () => {
    expect(defaultComposition().conditions).toEqual({
      years: [2026],
      cityCodes: JIANGSU_CITIES.map(city => city.code),
      indicatorIds: ['B-65', 'A-31', 'A-39']
    });
    expect(missingConditions(emptyComposition().conditions)).toEqual(['years', 'region', 'indicators']);
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
    expect(next.conditions.cityCodes).toEqual(['320100', '321300']);
    expect(withAllCities(next, true).conditions.cityCodes).toHaveLength(13);
    expect(withAllCities(next, false).conditions.cityCodes).toEqual([]);
    expect(() => withCity(next, '110000', true)).toThrow('没有城市');
  });

  it('指标加在最后；已经有的不变；移动按位置', () => {
    const next = withIndicator(composition(['B-65', 'A-31']), 'A-39', true);
    expect(next.conditions.indicatorIds).toEqual(['B-65', 'A-31', 'A-39']);
    expect(withIndicator(next, 'A-39', true)).toBe(next);
    expect(withIndicatorMoved(next, 2, 0).conditions.indicatorIds).toEqual(['A-39', 'B-65', 'A-31']);
    expect(() => withIndicatorMoved(next, 0, 3)).toThrow('超出范围');
    expect(() => withIndicator(next, 'G01-6', true)).toThrow('推演不支持指标 G01-6');
  });

  it('作用范围跟着已选指标：去掉指标时一起去掉，加上的不进已限定的范围，覆盖全部时记为全部', () => {
    const scoped = composition(['B-65', 'A-31', 'A-39'], ['B-65', 'A-39']);
    expect(withIndicator(scoped, 'A-39', false).params.scenarioIds).toEqual(['B-65']);
    expect(withIndicator(scoped, 'A-32', true).params.scenarioIds).toEqual(['B-65', 'A-39']);
    // 去掉范围外的唯一一项，剩下的都在范围里
    expect(withIndicator(scoped, 'A-31', false).params.scenarioIds).toBeNull();
    const all = withParams(scoped, { ...scoped.params, scenarioIds: ['A-39', 'A-31', 'B-65'] });
    expect(all.params.scenarioIds).toBeNull();
  });

  it('作用范围按已选指标的顺序整理，没变时返回原来的参数', () => {
    const params = { ...defaultParams(), scenarioIds: ['A-39', 'B-65'] };
    expect(normalizedParams(params, ['B-65', 'A-31', 'A-39']).scenarioIds).toEqual(['B-65', 'A-39']);
    const same = { ...defaultParams(), scenarioIds: ['B-65'] };
    expect(normalizedParams(same, ['B-65', 'A-31'])).toBe(same);
  });
});

describe('参数与指标的关系', () => {
  it('步行速度只影响步行类覆盖率；规划新增按作用范围；其余影响全部指标', () => {
    const { conditions, params } = composition(['B-65', 'A-15', 'A-39'], ['A-39']);
    expect(affectedIndicators('walkSpeed', conditions, params)).toEqual(['B-65']);
    expect(affectedIndicators('newFacilities', conditions, params)).toEqual(['A-39']);
    expect(affectedIndicators('popCaliber', conditions, params)).toEqual(['B-65', 'A-15', 'A-39']);
  });

  it('所选指标用不到步行速度时注明', () => {
    const { conditions, params } = composition(['A-15', 'A-39']);
    expect(paramValueText('walkSpeed', conditions, params)).toBe('60 米/分钟（未用到）');
    expect(paramValueText('walkSpeed', composition(['B-65']).conditions, params)).toBe('60 米/分钟');
  });

  it('搜索按名称或简称', () => {
    expect(searchIndicators('公园').map(item => item.id)).toEqual(['B-65', 'A-39']);
    expect(searchIndicators('小学覆盖').map(item => item.id)).toEqual(['A-32']);
    expect(searchIndicators('  ')).toHaveLength(22);
  });
});
