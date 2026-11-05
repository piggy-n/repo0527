// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { emptyComposition, sampleComposition } from '../compose/composition';
import { defaultParams } from '../model/params';
import { areaScope, citiesScope } from '../model/scope';
import { NANJING_RINGS, testArea } from '../model/test-area';
import { loadTestAtlas } from '../model/test-atlas';
import { useComposition } from './useComposition';

describe('useComposition', () => {
  it('打开页面时是空的编排', () => {
    expect(useComposition().state.value).toEqual(emptyComposition());
  });

  it('拖入已有的条件返回 false，状态不替换', () => {
    const owner = useComposition(sampleComposition());
    const before = owner.state.value;
    expect(owner.addYear(2026)).toBe(false);
    expect(owner.addCity('320100')).toBe(false);
    expect(owner.addIndicator('B-65')).toBe(false);
    expect(owner.state.value).toBe(before);

    expect(owner.addYear(2024)).toBe(true);
    expect(owner.state.value.conditions.years).toEqual([2026, 2024]);
  });

  it('点选切换；去掉没有的条件不替换状态', () => {
    const owner = useComposition();
    owner.toggleCity('320200');
    owner.toggleIndicator('A-39');
    owner.toggleYear(2025);
    expect(owner.state.value.conditions).toEqual({
      years: [2025],
      scope: citiesScope(['320200']),
      indicatorIds: ['A-39']
    });

    const before = owner.state.value;
    owner.removeYear(2026);
    owner.removeCity('320100');
    owner.removeIndicator('B-65');
    owner.moveIndicator(0, 0);
    expect(owner.state.value).toBe(before);
  });

  it('移动指标、换参数、整体替换、重置条件', () => {
    const owner = useComposition(sampleComposition());
    owner.moveIndicator(0, 2);
    expect(owner.state.value.conditions.indicatorIds).toEqual(['A-31', 'A-39', 'B-65']);

    owner.setParams({ ...defaultParams(), rule: 'old' });
    expect(owner.state.value.params.rule).toBe('old');

    const next = { ...sampleComposition(), conditions: { ...sampleComposition().conditions, years: [2025] } };
    owner.replace(next);
    expect(owner.state.value).toBe(next);

    owner.reset();
    expect(owner.state.value).toEqual(emptyComposition());
  });
});

describe('useComposition 的监测范围（ADR 0121）', () => {
  it('换上、移除自定义范围；切换范围的种类时各自的选择还在', async () => {
    const area = await testArea(await loadTestAtlas(), NANJING_RINGS);
    const owner = useComposition();
    owner.toggleCity('320500');
    owner.setArea(area);
    expect(owner.state.value.conditions.scope).toEqual(areaScope(area));
    owner.setScopeKind('cities');
    expect(owner.state.value.conditions.scope).toEqual(citiesScope(['320500']));
    owner.setScopeKind('area');
    expect(owner.state.value.conditions.scope).toEqual(areaScope(area));
    owner.setArea(null);
    expect(owner.state.value.conditions.scope).toEqual(areaScope(null));
  });

  it('自定义范围下点选、拖入城市时切回行政区划', async () => {
    const area = await testArea(await loadTestAtlas(), NANJING_RINGS);
    const owner = useComposition();
    owner.setArea(area);
    expect(owner.addCity('320200')).toBe(true);
    expect(owner.state.value.conditions.scope).toEqual(citiesScope(['320200']));
    owner.setScopeKind('area');
    owner.toggleCity('320100');
    expect(owner.state.value.conditions.scope).toEqual(citiesScope(['320100', '320200']));
    owner.setScopeKind('area');
    owner.setAllCities(true);
    expect(owner.state.value.conditions.scope.kind).toBe('cities');
  });
});
