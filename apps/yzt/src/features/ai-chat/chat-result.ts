import type { FeatureCollection, GeoJSON } from 'geojson';
import type { ToolStep } from './tool-steps';

/** 一次回答的耗时与用量；没有时为 0 */
export interface AnswerStats {
  readonly durationMs: number;
  readonly tokenCount: number;
  /** 每秒 token 数 */
  readonly tps: number;
}

export const EMPTY_STATS: AnswerStats = { durationMs: 0, tokenCount: 0, tps: 0 };

export interface ChatChart {
  readonly title: string;
  readonly type: 'bar' | 'line' | 'pie';
  readonly labels: readonly string[];
  readonly values: readonly number[];
  /** 数值的名称，如"面积(亩)" */
  readonly valueLabel: string;
}

export interface ChatTable {
  readonly columns: readonly string[];
  readonly rows: readonly Readonly<Record<string, unknown>>[];
}

/** 一次回答的完整结果：正文和步骤进对话，地图、图表、表格、Excel 进页面的结果区 */
export interface ChatResult {
  readonly answer: string;
  readonly geojson: FeatureCollection | null;
  readonly chart: ChatChart | null;
  readonly table: ChatTable | null;
  /** AI 后端返回的下载路径 */
  readonly excelUrl: string | null;
  /** 结果的分类，如"统计""对比" */
  readonly layerTag: string | null;
  readonly stats: AnswerStats;
  readonly steps: readonly ToolStep[];
}

/** 把 GeoJSON 统一成要素集合；没有要素时为 null */
export function featureCollectionOf(geojson: GeoJSON): FeatureCollection | null {
  let collection: FeatureCollection;
  if (geojson.type === 'FeatureCollection') {
    collection = geojson;
  } else if (geojson.type === 'Feature') {
    collection = { type: 'FeatureCollection', features: [geojson] };
  } else {
    collection = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: geojson }] };
  }
  return collection.features.length > 0 ? collection : null;
}

/** 毫秒转成秒，保留一位小数 */
export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** 耗时、用量的说明，如"12.3s · 981 tokens · 1 tok/s"；为 0 的项不显示 */
export function statsText({ durationMs, tokenCount, tps }: AnswerStats): string {
  return [
    durationMs > 0 ? formatSeconds(durationMs) : '',
    tokenCount > 0 ? `${tokenCount} tokens` : '',
    tps > 0 ? `${tps} tok/s` : ''
  ]
    .filter(text => text !== '')
    .join(' · ');
}

/** 结果区有没有图表或表格可以展示；地图和 Excel 不占结果区的内容 */
export function hasPanelContent(result: ChatResult | null): boolean {
  return result !== null && (result.chart !== null || result.table !== null);
}

/** 数值按中文习惯加千分位，最多两位小数 */
export function formatNumber(value: number): string {
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

/** 表格单元格的文字；空值留空，由表格的全局样式显示"-" */
export function formatCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'number') {
    return formatNumber(value);
  }
  return typeof value === 'string' ? value : JSON.stringify(value);
}
