// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { AreaCoverage } from '@/shared/map/area/area-coverage';
import { loadTestAtlas } from '../model/test-atlas';
import { box, NANJING_RINGS, NINGZHEN_RINGS, testArea } from '../model/test-area';
import {
  areaBrief,
  areaSummary,
  coverageNotices,
  coverageTree,
  expandAllByDefault,
  filterTree,
  formatKm2,
  formatRatio
} from './area-tree';

// 苏中一大片：跨 11 个市、56 个区县，西边有一部分在安徽
const WIDE_RINGS = [box(118.6, 31.6, 120.6, 33.4)];

async function treeOf(rings: Parameters<typeof testArea>[1]) {
  const atlas = await loadTestAtlas();
  const area = await testArea(atlas, rings);
  return { atlas, area, coverage: area.coverage, tree: coverageTree(area.coverage, atlas) };
}

describe('覆盖分析的分级列表', () => {
  it('按省、市、县整理：市按区划目录，区县按范围内的面积从大到小，个数和面积汇总', async () => {
    const { tree, coverage } = await treeOf(NINGZHEN_RINGS);
    expect(tree.cities.map(city => city.name)).toEqual(['南京市', '镇江市']);
    for (const city of tree.cities) {
      const areas = city.districts.map(district => district.area);
      expect(areas).toEqual(areas.toSorted((a, b) => b - a));
      expect(city.area).toBeCloseTo(areas.reduce((sum, value) => sum + value, 0));
      expect(city.full + city.partial).toBe(city.districts.length);
      expect(city.relation).toBe('partial');
      expect(city.ratio).toBeGreaterThan(0);
      expect(city.ratio).toBeLessThan(1);
    }
    expect(tree.full + tree.partial).toBe(coverage.covers.length);
    expect(tree.province.relation).toBe('partial');
    expect(tree.province.area).toBe(coverage.coveredArea);
  });

  it('市的区县都全部覆盖时市也是全部覆盖；全省都在范围里时省是全部覆盖', async () => {
    const { tree } = await treeOf([box(116, 30.5, 122.5, 35.5)]);
    expect(tree.cities).toHaveLength(13);
    // 求交量出的面积差一点点不到整个市、区县，比例仍写 1，不显示成 99%
    expect(tree.cities.every(city => city.relation === 'full' && city.ratio === 1)).toBe(true);
    expect(tree.cities.flatMap(city => city.districts).every(district => district.ratio === 1)).toBe(true);
    expect(tree.province.relation).toBe('full');
    expect(tree.partial).toBe(0);
  });

  it('筛选覆盖方式；关键字是市名时列它的区县，否则只列名称含关键字的区县；没有符合的区县的市不列', async () => {
    const { tree } = await treeOf(WIDE_RINGS);
    const full = filterTree(tree, 'full', '');
    expect(full.flatMap(city => city.districts).every(district => district.relation === 'full')).toBe(true);
    expect(full.flatMap(city => city.districts)).toHaveLength(tree.full);
    expect(full.length).toBeLessThan(tree.cities.length);

    const zhenjiang = filterTree(tree, 'all', '镇江');
    expect(zhenjiang.find(city => city.name === '镇江市')?.districts).toHaveLength(6);
    const jiang = filterTree(tree, 'all', ' 江 ');
    expect(jiang.find(city => city.name === '南京市')?.districts.map(district => district.name)).toEqual(['江宁区']);
    expect(filterTree(tree, 'full', '江宁')).toEqual([]);
    expect(filterTree(tree, 'all', '徐州')).toEqual([]);
  });

  it('市和区县都不多时一开始全部展开，多时只列各市', async () => {
    expect(expandAllByDefault((await treeOf(NINGZHEN_RINGS)).tree)).toBe(true);
    expect(expandAllByDefault((await treeOf(WIDE_RINGS)).tree)).toBe(false);
  });
});

describe('面积和比例的写法', () => {
  it('面积：不到 1 两位小数，不到 100 一位，再大取整加千分位', () => {
    expect(formatKm2(0.0123)).toBe('0.01');
    expect(formatKm2(57.94)).toBe('57.9');
    expect(formatKm2(37_517.4)).toBe('37,517');
  });

  it('比例：不到 1% 写"<1%"，不到 10% 一位小数，不满 100% 的不进位成 100%', () => {
    expect(formatRatio(0)).toBe('0%');
    expect(formatRatio(0.004)).toBe('<1%');
    expect(formatRatio(0.058)).toBe('5.8%');
    expect(formatRatio(0.34)).toBe('34%');
    expect(formatRatio(0.998)).toBe('99%');
    expect(formatRatio(1)).toBe('100%');
  });
});

describe('摘要、提示和卡片说明', () => {
  it('区县少时写出名称；有部分覆盖时说明计算按面积折算', async () => {
    const { tree, coverage } = await treeOf(NINGZHEN_RINGS);
    const summary = areaSummary(tree, coverage);
    expect(summary).toMatch(/^范围跨南京市、镇江市 2 个市，面积 [\d,.]+ 平方千米，涉及 \d 个区县：/);
    for (const district of tree.cities.flatMap(city => city.districts)) {
      expect(summary).toContain(district.name);
    }
    expect(summary).toContain('部分覆盖的区县按范围内的面积占比折算人口和用地');
    expect(coverageNotices(tree, coverage)).toEqual([]);
  });

  it('区县多时只写个数；范围有一部分在省外时摘要写出省内的面积，提示写出省外的面积', async () => {
    const { tree, coverage } = await treeOf(WIDE_RINGS);
    const summary = areaSummary(tree, coverage);
    expect(summary).toContain(`跨南京市等 ${tree.cities.length} 个市`);
    expect(summary).toContain(`（省内 ${formatKm2(coverage.coveredArea)}）`);
    expect(summary).toContain(`其余 ${tree.partial} 个部分覆盖`);
    expect(coverage.outsideArea).toBeGreaterThan(0);
    expect(coverageNotices(tree, coverage)).toEqual([
      `范围有 ${formatKm2(coverage.outsideArea)} 平方千米在江苏省外，不参与计算`
    ]);
  });

  it('大部分在省外、只沿边界相交的区县都写进提示', async () => {
    const { atlas, tree, coverage } = await treeOf(NANJING_RINGS);
    const touched = tree.cities[0]?.districts[0];
    if (!touched) {
      throw new Error('南京的范围至少涉及一个区县');
    }
    const outside: AreaCoverage = {
      ...coverage,
      outsideArea: coverage.area * 2,
      touches: [{ code: touched.code, area: 0.001 }]
    };
    const notices = coverageNotices(coverageTree(outside, atlas), outside);
    expect(notices[0]).toMatch(/，范围的大部分在省外$/);
    expect(notices[1]).toBe(`${touched.name}只与范围的边界相交（细条或不足 1 公顷），不算覆盖`);
  });

  it('卡片：市名用简称，多于 3 个市只写前两个和个数；有部分覆盖时写出个数', async () => {
    const { area } = await treeOf(NINGZHEN_RINGS);
    const partial = area.coverage.covers.filter(cover => cover.relation === 'partial').length;
    expect(areaBrief(area)).toEqual({
      where: `南京、镇江 · ${area.coverage.covers.length} 个区县（部分 ${partial}）`,
      size: `${formatKm2(area.coverage.area)} km²`
    });
    const wide = await treeOf(WIDE_RINGS);
    expect(areaBrief(wide.area).where).toMatch(/^南京、无锡等 11 个市 · 56 个区县（部分 \d+）$/);
  });
});
