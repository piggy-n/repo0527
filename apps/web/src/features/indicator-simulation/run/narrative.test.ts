// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { JIANGSU_CITIES } from '@/shared/map/region/region-catalog';
import type { SimulationConditions } from '../model/params';
import { em, plainText, primaryIndicator, rich } from './narrative';

const conditions: SimulationConditions = {
  years: [2026, 2025],
  cityCodes: JIANGSU_CITIES.map(city => city.code),
  indicatorIds: ['A-39', 'B-65', 'A-31']
};

describe('rich', () => {
  it('em() 插入的部分强调，数字原样', () => {
    expect(rich`共 ${3} 项，${em('64.6%')} 达标`).toEqual(['共 ', '3', ' 项，', { em: '64.6%' }, ' 达标']);
    expect(plainText(rich`a${em('b')}c`)).toBe('abc');
  });
});

describe('primaryIndicator', () => {
  it('第一项覆盖率类；没有覆盖率类时是第一项指标', () => {
    expect(primaryIndicator(conditions)).toBe('B-65');
    expect(primaryIndicator({ ...conditions, indicatorIds: ['A-39', 'B-61'] })).toBe('A-39');
  });
});
