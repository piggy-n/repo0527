// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { requireIndicator } from '@/shared/city-indicators/catalog';
import { indicatorValue, indicatorValueSource } from '@/shared/city-indicators/indicator-value';
import { CATEGORIES, INDICATORS } from './catalog';
import { createMockData } from './data/mock-data';

const isReported = (id: string) => indicatorValueSource(id, 2026) === 'report';
const idsOf = (categoryId: string) =>
  CATEGORIES.find(category => category.id === categoryId)?.indicators.map(indicator => indicator.id) ?? [];

describe('驾驶舱各分类的指标顺序', () => {
  it('有简报数据的排在前面，两部分内部保持目录顺序', () => {
    for (const category of CATEGORIES) {
      const catalog = INDICATORS.filter(indicator => indicator.categoryId === category.id).map(item => item.id);
      expect(idsOf(category.id)).toEqual([...catalog.filter(isReported), ...catalog.filter(id => !isReported(id))]);
    }
    expect(CATEGORIES.map(category => idsOf(category.id).filter(isReported).length)).toEqual([4, 5, 16, 7]);
  });

  it('只有两类的顺序有变化，四类的首项仍是原来的指标', () => {
    expect(idsOf('innovation').slice(0, 7)).toEqual(['B-57', 'B-35', 'B-19', 'A-20', 'B-47', 'A08-2', 'A08-1']);
    expect(idsOf('coordination').slice(0, 9)).toEqual([
      'A-39', 'B-21', 'B-60', 'B-29', 'A-16', 'A-38', 'B-28', 'E03-1', 'B07-2'
    ]);
    expect(CATEGORIES.map(category => idsOf(category.id)[0])).toEqual(['A-15', 'B-57', 'A-31', 'A-39']);
  });

  it('超高层的两个分项由合计折算，不算有简报数据', () => {
    const ids = idsOf('coordination');
    expect(ids.indexOf('D02-3-1')).toBeGreaterThan(ids.indexOf('E03-1'));
    expect(ids.indexOf('D02-3-2')).toBeGreaterThan(ids.indexOf('E03-1'));
  });

  it('不改变指标的分类和取值：列表里的就是目录的对象，值只看编码', () => {
    const data = createMockData(2026);
    const shown = CATEGORIES.flatMap(category => category.indicators.map(indicator => ({ category, indicator })));
    expect(new Set(shown.map(({ indicator }) => indicator.id)).size).toBe(96);
    for (const { category, indicator } of shown) {
      expect(indicator).toBe(requireIndicator(indicator.id));
      expect(indicator.categoryId).toBe(category.id);
    }
    for (const record of data.records) {
      expect(record.value).toBe(indicatorValue(record.cityCode, requireIndicator(record.indicatorCode), record.year));
    }
  });
});
