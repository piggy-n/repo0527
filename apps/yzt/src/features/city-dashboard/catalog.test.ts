// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { requireIndicator } from '@/shared/city-indicators/catalog';
import { indicatorValue, indicatorValueSource } from '@/shared/city-indicators/indicator-value';
import { CATEGORIES, INDICATORS } from './catalog';
import { createMockData } from './data/mock-data';

const isReported = (id: string) => indicatorValueSource(id, 2026) === 'report';
const idsOf = (categoryId: string) =>
  CATEGORIES.find(category => category.id === categoryId)?.indicators.map(indicator => indicator.id) ?? [];
// 演示分支：共享幸福依次把社区小学、社区体育设施、文艺场馆放在最前面
const PINNED_HAPPINESS = ['A-32', 'A-36', 'A04-1'];

describe('驾驶舱各分类的指标顺序', () => {
  it('有简报数据的排在前面，两部分内部保持目录顺序；共享幸福先放演示指定的三项', () => {
    for (const category of CATEGORIES) {
      const catalog = INDICATORS.filter(indicator => indicator.categoryId === category.id).map(item => item.id);
      const ordered = [...catalog.filter(isReported), ...catalog.filter(id => !isReported(id))];
      const pinned = category.id === 'happiness' ? PINNED_HAPPINESS : [];
      expect(idsOf(category.id)).toEqual([...pinned, ...ordered.filter(id => !pinned.includes(id))]);
    }
    expect(CATEGORIES.map(category => idsOf(category.id).filter(isReported).length)).toEqual([4, 5, 16, 7]);
  });

  it('两类按简报调整的顺序不变，共享幸福依次以演示指定的三项开头', () => {
    expect(idsOf('innovation').slice(0, 7)).toEqual(['B-57', 'B-35', 'B-19', 'A-20', 'B-47', 'A08-2', 'A08-1']);
    expect(idsOf('coordination').slice(0, 9)).toEqual([
      'A-39', 'B-21', 'B-60', 'B-29', 'A-16', 'A-38', 'B-28', 'E03-1', 'B07-2'
    ]);
    expect(idsOf('happiness').slice(0, 4)).toEqual([...PINNED_HAPPINESS, 'A-31']);
    expect(CATEGORIES.map(category => idsOf(category.id)[0])).toEqual(['A-15', 'B-57', 'A-32', 'A-39']);
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
