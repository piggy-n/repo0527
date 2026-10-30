// @vitest-environment node
import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';
import { describe, expect, it } from 'vitest';
import { loadTestAtlas } from './test-atlas';

describe('createDistrictAtlas', () => {
  it('全省 95 个区县，面积按椭球面计算，合计约 10.3 万平方千米', async () => {
    const atlas = await loadTestAtlas();
    const total = atlas.all.reduce((sum, district) => sum + district.area, 0);

    expect(atlas.all).toHaveLength(95);
    expect(total).toBeGreaterThan(100000);
    expect(total).toBeLessThan(105000);
  });

  it('名称以"区"结尾的是市辖区，县和县级市不是', async () => {
    const atlas = await loadTestAtlas();
    const flags = Object.fromEntries(atlas.all.map(district => [district.name, district.urban]));

    expect([flags['玄武区'], flags['溧水区'], flags['沛县'], flags['邳州市']]).toEqual([true, true, false, false]);
  });

  it('撒点中心在区县范围里', async () => {
    const atlas = await loadTestAtlas();
    const outside = atlas.all.filter(district => {
      const [west, south, east, north] = district.bounds;
      const [lng, lat] = district.center;
      return lng < west || lng > east || lat < south || lat > north;
    });

    expect(outside).toEqual([]);
    const xuanwu = atlas.get('320102');
    expect(booleanPointInPolygon([...xuanwu.center], { type: 'Feature', properties: {}, geometry: xuanwu.geometry })).toBe(true);
  });

  it('按市筛区县，按目录顺序；代码不存在时抛错', async () => {
    const atlas = await loadTestAtlas();

    expect(atlas.inCities(['321100']).map(district => district.name)).toEqual(['京口区', '润州区', '丹徒区', '丹阳市', '扬中市', '句容市']);
    expect(atlas.inCities(['321100'])).toBe(atlas.inCities(['321100']));
    expect(() => atlas.get('999999')).toThrow('计算范围里没有区县 999999');
  });
});
