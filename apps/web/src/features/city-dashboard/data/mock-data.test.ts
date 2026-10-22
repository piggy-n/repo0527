// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { CATEGORIES, CITIES, DASHBOARD_YEARS, INDICATORS } from '../catalog';
import { createMapClassification } from '../map-classification';
import { createMockData } from './mock-data';
import baseline from './legacy-baseline.json';

const data = createMockData(2026);
const digest = async (value: unknown) => {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('');
};

describe('驾驶舱固定模拟数据迁移基线', () => {
  it('保留 96 项目录、四分类和来源信息', () => {
    expect(CATEGORIES.map(category => category.indicators.length)).toEqual([5, 27, 44, 20]);
    expect(new Set(INDICATORS.map(indicator => indicator.id)).size).toBe(96);
    expect(CATEGORIES.flatMap(category => category.indicators)).toHaveLength(96);
    expect(INDICATORS.every(indicator => indicator.sourceFile && indicator.sourceGroup)).toBe(true);
  });

  it('全部 12480 个值与旧 master-demo 摘要一致，不仅比对首屏', async () => {
    const values = data.records.map(item => [item.year, item.cityCode, item.indicatorCode, item.value])
      .toSorted((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    expect(values).toHaveLength(baseline.valueCount);
    expect(await digest(values)).toBe(baseline.valuesSha256);
    expect(data.records.every(record => record.dataSource === 'mock' && record.status === 'available')).toBe(true);
    expect(data.value(2000, '320100', 'A-15')).toBeNull();
    expect(data.value(2026, 'unknown', 'A-15')).toBeNull();
  });

  it('全部指标的六年地图分档与旧版一致', async () => {
    const classifications = CATEGORIES.flatMap(category => category.indicators).map(indicator => [
      indicator.id,
      createMapClassification(DASHBOARD_YEARS.flatMap(year => CITIES.map(city => data.value(
        year,
        city.code,
        indicator.id
      ))))
    ]);
    expect(await digest(classifications)).toBe(baseline.classificationsSha256);
  });

  it('跨自然年后既有年份的模拟值不漂移', () => {
    const nextYear = createMockData(2027);
    expect(nextYear.years).toEqual([2027, 2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018]);
    for (const record of data.records.filter(item => item.year >= 2018)) {
      expect(nextYear.value(record.year, record.cityCode, record.indicatorCode)).toBe(record.value);
    }
  });

  it('建筑合计等于分项且生活圈并集不小于交集', () => {
    for (const city of CITIES) {
      for (const year of data.years) {
        const value = (id: string) => data.value(year, city.code, id) ?? NaN;
        expect(value('A-16')).toBe(value('D02-3-1') + value('D02-3-2'));
        expect(value('G01-6')).toBe(value('G01-6-1') + value('G01-6-2'));
        expect(value('A09-2')).toBeGreaterThanOrEqual(value('A-30'));
      }
    }
  });
});
