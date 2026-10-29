// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { JIANGSU_CITIES } from '@/shared/map/region/region-catalog';
import { createCalculator } from '../model/calculator';
import { defaultParams } from '../model/params';
import { loadTestAtlas } from '../model/test-atlas';
import { VALUE_COLORS } from './colors';
import { mapData } from './map-data';

const ALL = JIANGSU_CITIES.map(city => city.code);

describe('mapData', () => {
  it('推演范围的区县带数值颜色和排序；范围外的进遮罩', async () => {
    const calculator = createCalculator(await loadTestAtlas());
    const conditions = { years: [2026], cityCodes: ['320100', '321000'], indicatorIds: ['B-65', 'A-39'] };
    const data = mapData(calculator, conditions, defaultParams(), 'B-65');
    const scope = calculator.atlas.inCities(conditions.cityCodes);
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
    expect(data.cities.map(city => city.code)).toEqual(conditions.cityCodes);
    expect(data.sample?.cityCode).toBe('320100');
  });

  it('人均类没有服务圈；全省时没有遮罩', async () => {
    const calculator = createCalculator(await loadTestAtlas());
    const conditions = { years: [2026], cityCodes: ALL, indicatorIds: ['A-39'] };
    const data = mapData(calculator, conditions, defaultParams(), 'A-39');
    expect(data.ringMeters).toBe(0);
    expect(data.mask.features).toHaveLength(0);
  });

  it('服务圈按当前的规程：旧规程下社区卫生站点是 300 米', async () => {
    const calculator = createCalculator(await loadTestAtlas());
    const conditions = { years: [2026], cityCodes: ['320100'], indicatorIds: ['A-31'] };
    expect(mapData(calculator, conditions, defaultParams(), 'A-31').ringMeters).toBe(1000);
    expect(mapData(calculator, conditions, { ...defaultParams(), rule: 'old' }, 'A-31').ringMeters).toBe(300);
  });
});
