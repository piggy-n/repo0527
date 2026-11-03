// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { indicatorValue } from '@/shared/city-indicators/indicator-value';
import { mockIndicatorValue } from '@/shared/city-indicators/mock-value';
import { CATEGORIES, CITIES, DASHBOARD_YEARS, INDICATORS } from '../catalog';
import { createMapClassification } from '../map-classification';
import { createMockData } from './mock-data';
import baseline from './legacy-baseline.json';

const data = createMockData(2026);
const digest = async (value: unknown) => {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('');
};

describe('驾驶舱固定数据', () => {
  it('保留 96 项目录、四分类和来源信息', () => {
    expect(CATEGORIES.map(category => category.indicators.length)).toEqual([5, 27, 44, 20]);
    expect(new Set(INDICATORS.map(indicator => indicator.id)).size).toBe(96);
    expect(CATEGORIES.flatMap(category => category.indicators)).toHaveLength(96);
    expect(INDICATORS.every(indicator => indicator.sourceFile && indicator.sourceGroup)).toBe(true);
  });

  // 简报没有的指标沿用原 mock，所以它的生成规则和分档算法仍和旧 master-demo 比对
  it('原 mock 的全部 12480 个值与旧 master-demo 摘要一致，不仅比对首屏', async () => {
    const values = data.years
      .flatMap(year =>
        INDICATORS.flatMap(indicator =>
          CITIES.map(city => [year, city.code, indicator.id, mockIndicatorValue(city.code, indicator, year)])
        )
      )
      .toSorted((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    expect(values).toHaveLength(baseline.valueCount);
    expect(await digest(values)).toBe(baseline.valuesSha256);
  });

  it('原 mock 全部指标的六年地图分档与旧版一致', async () => {
    const classifications = CATEGORIES.flatMap(category => category.indicators).map(indicator => [
      indicator.id,
      createMapClassification(DASHBOARD_YEARS.flatMap(year => CITIES.map(city => mockIndicatorValue(
        city.code,
        indicator,
        year
      ))))
    ]);
    expect(await digest(classifications)).toBe(baseline.classificationsSha256);
  });

  it('全部记录都来自共用的取值，并标明来源；范围外的年份和城市是空', () => {
    expect(data.records).toHaveLength(baseline.valueCount);
    for (const record of data.records) {
      const indicator = INDICATORS.find(item => item.id === record.indicatorCode);
      expect(indicator && indicatorValue(record.cityCode, indicator, record.year)).toBe(record.value);
    }
    expect(data.records.every(record => record.status === 'available')).toBe(true);
    const sourceOf = (year: number, code: string) =>
      data.records.find(record => record.year === year && record.indicatorCode === code)?.dataSource;
    expect([sourceOf(2026, 'B-65'), sourceOf(2024, 'B-65'), sourceOf(2026, 'A08-2')]).toEqual(['report', 'scaled', 'mock']);
    expect(data.value(2026, '320100', 'B-65')).toBe(49.6);
    expect(data.value(2000, '320100', 'A-15')).toBeNull();
    expect(data.value(2026, 'unknown', 'A-15')).toBeNull();
  });

  // 合计与分项、并集与交集的约束在 shared/city-indicators/indicator-value.test.ts
  it('跨自然年后既有年份的值不漂移', () => {
    const nextYear = createMockData(2027);
    expect(nextYear.years).toEqual([2027, 2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018]);
    for (const record of data.records.filter(item => item.year >= 2018)) {
      expect(nextYear.value(record.year, record.cityCode, record.indicatorCode)).toBe(record.value);
    }
  });
});
