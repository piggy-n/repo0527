// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { areaLabel, areaScope, citiesScope, scopeCityCodes, scopeDistricts } from './scope';
import { loadTestAtlas } from './test-atlas';
import { NANJING_RINGS, NINGZHEN_RINGS, testArea } from './test-area';

describe('监测范围', () => {
  it('涉及的市：行政区划是所选的市，自定义范围是范围涉及的市（按区划目录），还没有范围时为空', async () => {
    const atlas = await loadTestAtlas();
    const area = await testArea(atlas, NINGZHEN_RINGS, '宁镇交界');
    expect(scopeCityCodes(citiesScope(['320500', '320100']))).toEqual(['320500', '320100']);
    expect(scopeCityCodes(areaScope(area))).toEqual(['320100', '321100']);
    expect(scopeCityCodes(areaScope(null))).toEqual([]);
    expect(areaLabel(area)).toBe('自定义范围「宁镇交界」');
  });

  it('行政区划：所选市的全部区县，按整个区县算', async () => {
    const atlas = await loadTestAtlas();
    const list = scopeDistricts(atlas, citiesScope(['320100']));
    expect(list).toHaveLength(atlas.inCities(['320100']).length);
    expect(list.every(item => item.share === 1 && item.relation === 'full')).toBe(true);
    expect(list[0]?.geometry).toBe(list[0]?.district.geometry);
  });

  it('自定义范围：覆盖的区县按区划目录，部分覆盖的取范围内的部分和面积占比，全部覆盖的按整个区县', async () => {
    const atlas = await loadTestAtlas();
    const area = await testArea(atlas, NANJING_RINGS);
    const list = scopeDistricts(atlas, areaScope(area));
    const order = atlas.all.map(district => district.code);
    expect(list.map(item => order.indexOf(item.district.code))).toEqual(
      list.map(item => order.indexOf(item.district.code)).toSorted((a, b) => a - b)
    );
    const qinhuai = list.find(item => item.district.name === '秦淮区');
    expect(qinhuai).toMatchObject({ share: 1, relation: 'full' });
    expect(qinhuai?.geometry).toBe(qinhuai?.district.geometry);
    const jiangning = list.find(item => item.district.name === '江宁区');
    expect(jiangning?.relation).toBe('partial');
    expect(jiangning?.share).toBeGreaterThan(0);
    expect(jiangning?.share).toBeLessThan(0.2);
    expect(jiangning?.geometry).not.toBe(jiangning?.district.geometry);
    // 同一个范围只建一次
    expect(scopeDistricts(atlas, areaScope(area))).toBe(list);
  });

  it('范围是空的时抛错', async () => {
    const atlas = await loadTestAtlas();
    expect(() => scopeDistricts(atlas, citiesScope([]))).toThrow('计算条件里没有城市');
    expect(() => scopeDistricts(atlas, areaScope(null))).toThrow('计算条件里没有自定义范围');
  });
});
