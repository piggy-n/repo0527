// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { JIANGSU_CITIES } from '@/shared/map/region/region-catalog';
import { createCalculator } from '../model/calculator';
import { defaultParams } from '../model/params';
import { areaScope, citiesScope, scopeCityCodes } from '../model/scope';
import { NANJING_RINGS, testArea } from '../model/test-area';
import { loadTestAtlas } from '../model/test-atlas';
import { VALUE_COLORS } from './colors';
import { mapData } from './map-data';
import { maskGroup } from './map-frame';

const ALL = JIANGSU_CITIES.map(city => city.code);

// 鞋带公式：逆时针为正
const signed = (ring: readonly (readonly number[])[]) =>
  ring.reduce((sum, [x1 = 0, y1 = 0], index) => {
    const [x2 = 0, y2 = 0] = ring[(index + 1) % ring.length] ?? [];
    return sum + (x1 * y2 - x2 * y1);
  }, 0);

describe('mapData', () => {
  it('计算范围的区县带数值颜色和排序；范围外的进遮罩', async () => {
    const calculator = createCalculator(await loadTestAtlas());
    const conditions = { years: [2026], scope: citiesScope(['320100', '321000']), indicatorIds: ['B-65', 'A-39'] };
    const data = mapData(calculator, conditions, defaultParams(), 'B-65');
    const scope = calculator.atlas.inCities(scopeCityCodes(conditions.scope));
    const properties = data.districts.features.map(feature => feature.properties);

    expect(properties.map(item => item.code)).toEqual(scope.map(district => district.code));
    expect(data.mask.features).toHaveLength(calculator.atlas.all.length - scope.length);
    // 经度排序从西到东
    const byLng = properties.toSorted((a, b) => a.lngRank - b.lngRank).map(item => item.code);
    expect(byLng).toEqual(scope.toSorted((a, b) => a.center[0] - b.center[0]).map(district => district.code));
    expect(Math.min(...properties.map(item => item.lngRank))).toBe(0);
    expect(Math.max(...properties.map(item => item.lngRank))).toBe(1);
    expect(properties.every(item => (VALUE_COLORS as readonly string[]).includes(item.fill))).toBe(true);
    expect(data.ringMeters).toBe(300);
    expect(data.cities.map(city => city.code)).toEqual(scopeCityCodes(conditions.scope));
    expect(data.sample?.cityCode).toBe('320100');
  });

  it('人均类没有服务圈；全省时没有遮罩', async () => {
    const calculator = createCalculator(await loadTestAtlas());
    const conditions = { years: [2026], scope: citiesScope(ALL), indicatorIds: ['A-39'] };
    const data = mapData(calculator, conditions, defaultParams(), 'A-39');
    expect(data.ringMeters).toBe(0);
    expect(data.mask.features).toHaveLength(0);
  });

  it('服务圈按当前的规程：旧规程下社区卫生站点是 300 米', async () => {
    const calculator = createCalculator(await loadTestAtlas());
    const conditions = { years: [2026], scope: citiesScope(['320100']), indicatorIds: ['A-31'] };
    expect(mapData(calculator, conditions, defaultParams(), 'A-31').ringMeters).toBe(1000);
    expect(mapData(calculator, conditions, { ...defaultParams(), rule: 'old' }, 'A-31').ringMeters).toBe(300);
  });
});

describe('自定义范围的地图数据（ADR 0121）', () => {
  it('只画范围内的部分；范围以外遮罩（外环逆时针、范围的洞顺时针），边界描虚线', async () => {
    const calculator = createCalculator(await loadTestAtlas());
    const area = await testArea(calculator.atlas, NANJING_RINGS);
    const conditions = { years: [2026], scope: areaScope(area), indicatorIds: ['B-65'] };
    const data = mapData(calculator, conditions, defaultParams(), 'B-65');

    expect(data.districts.features).toHaveLength(7);
    const qinhuai = data.districts.features.find(item => calculator.atlas.get(item.properties.code).name === '秦淮区');
    const jiangning = data.districts.features.find(item => calculator.atlas.get(item.properties.code).name === '江宁区');
    expect(qinhuai?.geometry).toBe(calculator.atlas.get(qinhuai?.properties.code ?? '').geometry);
    expect(jiangning?.geometry).not.toBe(calculator.atlas.get(jiangning?.properties.code ?? '').geometry);
    expect(data.area).toBe(area.geometry);

    const [mask] = data.mask.features;
    const [frame = [], ...holes] = mask?.geometry.type === 'MultiPolygon' ? (mask.geometry.coordinates[0] ?? []) : [];
    expect(signed(frame)).toBeGreaterThan(0);
    expect(holes).toHaveLength(1);
    expect(signed(holes[0] ?? [])).toBeLessThan(0);

    // 外包框和标注都在范围附近
    const [west, south, east, north] = data.bounds;
    expect(west).toBeGreaterThanOrEqual(118.73);
    expect(east).toBeLessThanOrEqual(118.94);
    expect(south).toBeGreaterThanOrEqual(31.94);
    expect(north).toBeLessThanOrEqual(32.1);
    const [lng, lat] = data.cities[0]?.center ?? [0, 0];
    expect(lng).toBeGreaterThan(118.74);
    expect(lng).toBeLessThan(118.93);
    expect(lat).toBeGreaterThan(31.95);
    expect(lat).toBeLessThan(32.09);

    const group = maskGroup(data);
    expect(group.layers.map(layer => layer.id)).toEqual(['simulation-mask-fill', 'simulation-mask-area-line']);
    expect(group.sources['simulation-mask-area']).toEqual({ type: 'geojson', data: area.geometry });
  });

  it('行政区划没有范围的边界', async () => {
    const calculator = createCalculator(await loadTestAtlas());
    const conditions = { years: [2026], scope: citiesScope(['320100']), indicatorIds: ['A-31'] };
    const data = mapData(calculator, conditions, defaultParams(), 'A-31');
    expect(data.area).toBeNull();
    expect(maskGroup(data).layers.map(layer => layer.id)).toEqual(['simulation-mask-fill']);
  });
});
