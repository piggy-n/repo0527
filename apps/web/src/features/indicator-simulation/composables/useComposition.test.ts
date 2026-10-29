// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { emptyComposition } from '../compose/composition';
import { defaultParams } from '../model/params';
import { useComposition } from './useComposition';

describe('useComposition', () => {
  it('拖入已有的条件返回 false，状态不替换', () => {
    const owner = useComposition();
    const before = owner.state.value;
    expect(owner.addYear(2026)).toBe(false);
    expect(owner.addCity('320100')).toBe(false);
    expect(owner.addIndicator('B-65')).toBe(false);
    expect(owner.state.value).toBe(before);

    expect(owner.addYear(2024)).toBe(true);
    expect(owner.state.value.conditions.years).toEqual([2026, 2024]);
  });

  it('点选切换；去掉没有的条件不替换状态', () => {
    const owner = useComposition(emptyComposition());
    owner.toggleCity('320200');
    owner.toggleIndicator('A-39');
    owner.toggleYear(2025);
    expect(owner.state.value.conditions).toEqual({ years: [2025], cityCodes: ['320200'], indicatorIds: ['A-39'] });

    const before = owner.state.value;
    owner.removeYear(2026);
    owner.removeCity('320100');
    owner.removeIndicator('B-65');
    owner.moveIndicator(0, 0);
    expect(owner.state.value).toBe(before);
  });

  it('移动指标、换参数、清空', () => {
    const owner = useComposition();
    owner.moveIndicator(0, 2);
    expect(owner.state.value.conditions.indicatorIds).toEqual(['A-31', 'A-39', 'B-65']);

    owner.setParams({ ...defaultParams(), newFacilities: 20, scenarioIds: ['B-65', 'A-31', 'A-39'] });
    expect(owner.state.value.params).toMatchObject({ newFacilities: 20, scenarioIds: null });

    owner.clear();
    expect(owner.state.value).toEqual(emptyComposition());
  });
});
