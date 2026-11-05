// @vitest-environment node
import type { Feature, Point } from 'geojson';
import { describe, expect, it } from 'vitest';
import { type ChatResult, EMPTY_STATS, featureCollectionOf, formatCell, hasPanelContent, statsText } from './chat-result';

const point: Point = { type: 'Point', coordinates: [118.8, 32.06] };
const feature: Feature = { type: 'Feature', properties: { name: '南京' }, geometry: point };

describe('featureCollectionOf', () => {
  it('要素和几何都包成要素集合，空集合为 null', () => {
    expect(featureCollectionOf(feature)).toEqual({ type: 'FeatureCollection', features: [feature] });
    expect(featureCollectionOf(point)).toEqual({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: point }]
    });
    expect(featureCollectionOf({ type: 'FeatureCollection', features: [] })).toBeNull();
  });
});

describe('statsText', () => {
  it('毫秒换成秒，为 0 的项不显示', () => {
    expect(statsText({ durationMs: 964931, tokenCount: 981, tps: 1 })).toBe('964.9s · 981 tokens · 1 tok/s');
    expect(statsText({ durationMs: 800, tokenCount: 0, tps: 0 })).toBe('0.8s');
    expect(statsText(EMPTY_STATS)).toBe('');
  });
});

describe('formatCell', () => {
  it('数字加千分位，空值留空交给表格的全局样式，其他值转成文字', () => {
    expect(formatCell(42658273.891)).toBe('42,658,273.89');
    expect(formatCell('0101')).toBe('0101');
    expect(formatCell(null)).toBe('');
    expect(formatCell(undefined)).toBe('');
    expect(formatCell(true)).toBe('true');
  });
});

describe('hasPanelContent', () => {
  const result: ChatResult = {
    answer: '',
    geojson: null,
    chart: null,
    table: null,
    excelUrl: '/a.xlsx',
    layerTag: null,
    stats: EMPTY_STATS,
    steps: []
  };

  it('只有图表或表格算结果区的内容，地图和 Excel 不算', () => {
    expect(hasPanelContent(null)).toBe(false);
    expect(hasPanelContent(result)).toBe(false);
    expect(hasPanelContent({ ...result, table: { columns: ['a'], rows: [{ a: 1 }] } })).toBe(true);
  });
});
