import type { QueryRecord } from './api';
import type { QueryLayer } from './types';

const COMMON_LABELS: Readonly<Record<string, string>> = {
  guid: '要素主键',
  sjnf: '年份',
  areacode: '行政区代码',
  intersect_region_code: '相交区划代码',
  region_code: '行政区代码',
  wybm: '唯一编码',
  bsm: '标识码',
  ysdm: '要素代码',
  bz: '备注'
};

/** 几何单独用于地图，不把长坐标串放进表格 */
export function resultColumns(layer: QueryLayer | undefined, rows: readonly QueryRecord[]) {
  const codes = new Set(rows.flatMap(row => Object.keys(row)).filter(code => code !== 'geom'));
  return [...codes].map(code => ({
    code,
    label: layer?.fields.find(field => field.code.toLowerCase() === code.toLowerCase())?.label ??
      COMMON_LABELS[code.toLowerCase()] ?? code
  }));
}

/** 只作为文本渲染，保留 0 和 false，不解析后端内容为 HTML */
export function recordText(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  return JSON.stringify(value);
}
