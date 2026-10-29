// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { JIANGSU_CITIES } from '@/shared/map/region/region-catalog';
import { createCalculator } from '../model/calculator';
import { defaultParams } from '../model/params';
import { loadTestAtlas } from '../model/test-atlas';
import { EXCLUDED_COLOR, VALUE_COLORS } from './colors';
import { mapData } from './map-data';

const ALL = JIANGSU_CITIES.map(city => city.code);

describe('mapData', () => {
  it('推演范围的区县带数值颜色、排序和缺失；范围外的进遮罩', async () => {
    const calculator = createCalculator(await loadTestAtlas());
    const conditions = { years: [2026], cityCodes: ['320100', '321000'], indicatorIds: ['B-65', 'A-39'] };
    const data = mapData(calculator, conditions, defaultParams(), 'B-65');
    const scope = calculator.atlas.inCities(conditions.cityCodes);
    const properties = data.districts.features.map(feature => feature.properties);

    expect(properties.map(item => item.code)).toEqual(scope.map(district => district.code));
    expect(data.mask.features).toHaveLength(calculator.atlas.all.length - scope.length);
    expect(properties.filter(item => item.missing).map(item => item.code)).toEqual(
      calculator.missingDistricts(2026, conditions.cityCodes).map(district => district.code)
    );
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

  it('剔除的区县是灰色；人均类没有服务圈', async () => {
    const calculator = createCalculator(await loadTestAtlas());
    const conditions = { years: [2026], cityCodes: ALL, indicatorIds: ['A-39'] };
    const data = mapData(calculator, conditions, { ...defaultParams(), missing: { kind: 'exclude' } }, 'A-39');
    const missing = data.districts.features.filter(feature => feature.properties.missing);
    expect(missing.length).toBeGreaterThan(0);
    expect(missing.every(feature => feature.properties.fill === EXCLUDED_COLOR)).toBe(true);
    expect(data.ringMeters).toBe(0);
    expect(data.mask.features).toHaveLength(0);
  });
});
