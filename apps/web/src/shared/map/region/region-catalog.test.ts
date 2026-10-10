// @vitest-environment node
import { describe, expect, it } from 'vitest';
import cityFile from '../boundary/data/jiangsu-city.json?raw';
import countyFile from '../boundary/data/jiangsu-county.json?raw';
import {
  districtsOf,
  findRegion,
  JIANGSU_CITIES,
  type Region,
  regionPath,
  searchRegions,
  shortRegionName
} from './region-catalog';
import { boundaryCode } from './region-geometry';

// 边界数据里每个要素的 6 位代码和名称（连云港的两个要素合成一条）
function boundaryEntries(file: string): Map<string, string> {
  const { features } = JSON.parse(file) as { features: { properties: { code: string; name: string } }[] };
  return new Map(features.map(({ properties }) => [boundaryCode(properties.code), properties.name]));
}

const entries = (regions: readonly Region[]) => new Map(regions.map(({ code, name }) => [code, name]));

const names = (regions: readonly Region[]) => regions.map(({ name }) => name);

describe('区划目录', () => {
  it('与边界数据逐条对应：市对市界，区县对县界，代码和名称都相同', () => {
    const districts = JIANGSU_CITIES.flatMap(city => districtsOf(city.code));

    expect(entries(JIANGSU_CITIES)).toStrictEqual(boundaryEntries(cityFile));
    expect(entries(districts)).toStrictEqual(boundaryEntries(countyFile));
  });

  it('13 个市、95 个区县，区县记着所在的市；代码不重复', () => {
    const districts = JIANGSU_CITIES.flatMap(city => districtsOf(city.code));

    expect(JIANGSU_CITIES).toHaveLength(13);
    expect(districts).toHaveLength(95);
    expect(new Set([...JIANGSU_CITIES, ...districts].map(({ code }) => code)).size).toBe(108);
    expect(JIANGSU_CITIES.every(({ level, code, cityCode }) => level === 'city' && cityCode === code)).toBe(true);
    expect(
      JIANGSU_CITIES.every(city =>
        districtsOf(city.code).every(({ level, cityCode }) => level === 'district' && cityCode === city.code)
      )
    ).toBe(true);
  });

  it('旧项目代码写错的区县用现行代码：梁溪区 320213、新吴区 320214、涟水县 320826', () => {
    expect(findRegion('320213')?.name).toBe('梁溪区');
    expect(findRegion('320214')?.name).toBe('新吴区');
    expect(findRegion('320826')?.name).toBe('涟水县');
    expect(findRegion('320205')?.name).toBe('锡山区');
  });

  it('按代码查找、某个市的区县、路径和简称', () => {
    const nanjing = findRegion('320100');
    const xuanwu = findRegion('320102');
    if (!nanjing || !xuanwu) {
      throw new Error('目录里没有南京市或玄武区');
    }

    expect(names(districtsOf('320100')).slice(0, 3)).toStrictEqual(['玄武区', '秦淮区', '建邺区']);
    expect(districtsOf('320102')).toStrictEqual([]);
    expect(findRegion('320000')).toBeUndefined();
    expect(regionPath(nanjing)).toBe('南京市');
    expect(regionPath(xuanwu)).toBe('南京市 / 玄武区');
    expect(shortRegionName('南京市')).toBe('南京');
    expect(shortRegionName('江阴市')).toBe('江阴');
    expect(shortRegionName('玄武区')).toBe('玄武区');
    expect(shortRegionName('市中区')).toBe('市中区');
  });

  it('搜索：路径包含关键字的区划，按目录顺序；去掉首尾空白，空白时没有结果', () => {
    expect(names(searchRegions('南京'))).toStrictEqual(['南京市', ...names(districtsOf('320100'))]);
    expect(searchRegions(' 鼓楼区 ').map(({ cityCode }) => cityCode)).toStrictEqual(['320100', '320300']);
    expect(names(searchRegions('南京市 / 玄武区'))).toStrictEqual(['玄武区']);
    expect(names(searchRegions('山区'))).toStrictEqual(['锡山区', '惠山区', '泉山区', '铜山区']);
    expect(searchRegions('  ')).toStrictEqual([]);
    expect(searchRegions('北京')).toStrictEqual([]);
  });

  it('每个市后面跟着它的区县，最多 20 条', () => {
    const results = searchRegions('州');

    expect(results).toHaveLength(20);
    expect(names(results).slice(0, 2)).toStrictEqual(['徐州市', '鼓楼区']);
    expect(results[11]?.name).toBe('常州市');
  });
});
