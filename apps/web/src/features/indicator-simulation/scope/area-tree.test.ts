// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { AreaCoverage } from '@/shared/map/area/area-coverage';
import type { AreaProblemCode } from '@/shared/map/area/area-geometry';
import { required } from '@/shared/testing/required';
import { loadTestAtlas } from '../model/test-atlas';
import { box, NANJING_RINGS, NINGZHEN_RINGS, testArea } from '../model/test-area';
import {
  areaBrief,
  areaSummary,
  coverageNotices,
  coverageTree,
  coverCounts,
  coverDetail,
  expandAllByDefault,
  filterTree,
  formatKm2,
  formatRatio,
  problemText
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

  it('带上行政区自己的面积：区县按区县，市合计它的全部区县，省合计全省', async () => {
    const { tree, atlas } = await treeOf(NINGZHEN_RINGS);
    const nanjing = required(tree.cities[0], '南京市');
    const district = required(nanjing.districts[0], '南京的区县');
    expect(district.total).toBe(atlas.get(district.code).area);
    expect(nanjing.total).toBeCloseTo(atlas.inCities([nanjing.code]).reduce((sum, item) => sum + item.area, 0));
    expect(nanjing.ratio).toBeCloseTo(nanjing.area / nanjing.total);
    expect(tree.province.total).toBeCloseTo(atlas.all.reduce((sum, item) => sum + item.area, 0));
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

describe('一行的标签', () => {
  it('上级按覆盖方式计数，只写有的一种，都有时合在一起', () => {
    expect(coverCounts({ full: 0, partial: 5 })).toBe('部分 5');
    expect(coverCounts({ full: 3, partial: 0 })).toBe('完整 3');
    expect(coverCounts({ full: 1, partial: 2 })).toBe('完整 1 · 部分 2');
  });

  it('悬浮提示写范围内的面积、行政区的面积和占比', () => {
    expect(coverDetail({ area: 50, total: 100, ratio: 0.5 })).toBe('50 km² / 100 km²（50%）');
    expect(coverDetail({ area: 2.4, total: 1129, ratio: 0.002 })).toBe('2.4 km² / 1,129 km²（<1%）');
  });
});

describe('摘要、提示和卡片说明', () => {
  it('摘要只有一句：区县少时写出名称，不重复面积，也不讲计算方式', async () => {
    const { tree, coverage } = await treeOf(NINGZHEN_RINGS);
    const summary = areaSummary(tree);
    expect(summary).toMatch(/^范围跨南京市、镇江市，/);
    for (const district of tree.cities.flatMap(city => city.districts)) {
      expect(summary).toContain(district.name);
    }
    expect(summary).not.toMatch(/平方千米|折算/);
    expect(summary.match(/。/g)).toHaveLength(1);
    expect(coverageNotices(coverage)).toEqual([]);
  });

  it('区县多时只写个数；提示只留影响结果的：省外的面积不参与计算', async () => {
    const { tree, coverage } = await treeOf(WIDE_RINGS);
    expect(areaSummary(tree)).toBe(`范围跨南京市等 ${tree.cities.length} 个市，涉及 ${tree.full + tree.partial} 个区县。`);
    expect(coverage.outsideArea).toBeGreaterThan(0);
    expect(coverageNotices(coverage)).toEqual([
      `范围有 ${formatKm2(coverage.outsideArea)} 平方千米在江苏省外，不参与计算`
    ]);
  });

  it('大部分在省外时写进提示；只沿边界相交的区县不算影响结果，不写提示', async () => {
    const { coverage } = await treeOf(NANJING_RINGS);
    const outside: AreaCoverage = {
      ...coverage,
      outsideArea: coverage.area * 2,
      touches: [{ code: required(coverage.covers[0], '南京的区县').code, area: 0.001 }]
    };
    const notices = coverageNotices(outside);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatch(/，范围的大部分在省外$/);
  });

  it('不能用的原因按类型写给用户：说怎么办，不带节点数、坐标系名称这类技术细节', () => {
    expect(problemText('crs')).toBe('文件的坐标系不支持，请转换为经纬度坐标后上传');
    expect(problemText('outside')).toBe('范围不在江苏省内，请检查后重新绘制或上传');
    const codes: readonly AreaProblemCode[] = [
      'file-type',
      'file-size',
      'file-empty',
      'file-corrupt',
      'file-parts',
      'crs',
      'geometry-type',
      'geometry-invalid',
      'too-complex',
      'too-small',
      'too-large',
      'outside'
    ];
    for (const code of codes) {
      expect(problemText(code)).not.toMatch(/\d|(?<!Geo)JSON|EPSG|CGCS|WGS|节点/);
    }
  });

  it('卡片：市名用简称，多于 3 个市只写前两个和个数；不写部分覆盖的个数', async () => {
    const { area } = await treeOf(NINGZHEN_RINGS);
    expect(areaBrief(area)).toEqual({
      where: `南京、镇江 · ${area.coverage.covers.length} 个区县`,
      size: `${formatKm2(area.coverage.area)} km²`
    });
    const wide = await treeOf(WIDE_RINGS);
    expect(areaBrief(wide.area).where).toBe('南京、无锡等 11 个市 · 56 个区县');
  });
});
