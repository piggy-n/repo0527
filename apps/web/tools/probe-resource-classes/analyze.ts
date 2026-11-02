// 分类字段的识别（纯函数）：统计字段的取值，给出候选和原因。结论只是候选，业务含义由人确认

/** 分类字段最多的取值数；地类这样有编码表的标准字段放宽（表 A.2 有 69 个二级类） */
const MAX_CLASSES = 40;
const MAX_STANDARD_CLASSES = 90;
/** 每个字段最多记下多少个不同的值，超过就算取值过多 */
const MAX_TRACKED_VALUES = 200;

// 填写率、均衡和取值数加起来最多 60 分：只有字段名也像分类字段时才直接建议，其他留给人判断
export const RECOMMEND_SCORE = 65;
export const POSSIBLE_SCORE = 30;
/** 一个取值占到这个比例时，分类看不出区别，不直接建议 */
const DOMINANT_SHARE = 0.95;

// 不适合做分类的字段，按名称排除；原因写进报告，由人复核
const EXCLUDED_FIELDS: readonly (readonly [pattern: RegExp, reason: string])[] = [
  [/^(guid|objectid|fid|gid|id|uid|bsm|wybm|featid|ec|wrid|shrc|ysdm|tbbh|tbybh|gcode|hldm|hlbm)$/, '标识'],
  [/^(clustered|point_count|sqrt_point_count)$/, '瓦片的聚合字段'],
  [/(xzq|region|areacode|zldw|qsdw)/, '区划或权属单位'],
  [/^(sjnf|gxsj|year|period)$|(time|date)$/, '时间'],
  [/(mj|area|length|height|width|perimeter)$|^(shape|vol$|kd$|quota$|kcxs$)/, '度量'],
  [/^(bz|mssm|ecrm|ckzl|remark|note)$/, '说明'],
  [/^changetype$/, '变化标记'],
  [/^(if|is)[a-z]+$/, '是否标记'],
  [/^(name|aname|gname|hlmc|czcmc)$/, '要素自己的名称']
];

/** 有编码表的标准分类字段：三调地类、城镇村属性、城市国土空间监测的类型代码 */
const STANDARD_FIELDS: ReadonlySet<string> = new Set(['dlbm', 'dlmc', 'czclx', 'czcsxm', 'cc', 'ccn']);
// 三调和监测成果里常见的分类字段（docs/migration.md、water-relations.json 的字段表）
const COMMON_FIELDS: ReadonlySet<string> = new Set([
  'type',
  'grade',
  'use',
  'pass',
  'qsxz',
  'gdlx',
  'gdpdjb',
  'gddb',
  'tbxhdm',
  'tbxhmc',
  'zzsxdm',
  'zzsxmc',
  'hldj',
  'sdtf'
]);
const CLASS_NAME_PATTERN = /(lx|lb|fl|dj|jb|xz|type|class|level|kind)$/;

// 接口和瓦片的值转成文字；嵌套的值（查询接口偶尔有）转成 JSON
function textOf(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

/** 后端表示"没有值"的占位，同 feature-query.ts 的 isEmptyValue，另加文字的 null */
export function isPlaceholder(value: unknown): boolean {
  const text = textOf(value).trim();
  return text === '' || text === '-9999' || text === '-999' || text.toLowerCase() === 'null';
}

export interface FieldStats {
  /** 带这个字段的记录数 */
  seen: number;
  /** 其中有效值（不是占位）的记录数 */
  filled: number;
  values: Record<string, number>;
  /** 不同的值超过 MAX_TRACKED_VALUES，values 不完整 */
  overflow: boolean;
  /** 有效值的 JS 类型：同一字段混着字符串和数字时，match 表达式会匹配不上 */
  types: Record<string, number>;
  placeholders: Record<string, number>;
  /** 原始字段名：瓦片是小写，大小写不统一时这里会有多个 */
  names: string[];
}

export interface SampleStats {
  records: number;
  fields: Record<string, FieldStats>;
}

export function emptySample(): SampleStats {
  return { records: 0, fields: Object.create(null) as Record<string, FieldStats> };
}

function increase(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function newField(): FieldStats {
  return {
    seen: 0,
    filled: 0,
    values: Object.create(null) as Record<string, number>,
    overflow: false,
    types: Object.create(null) as Record<string, number>,
    placeholders: Object.create(null) as Record<string, number>,
    names: []
  };
}

/** 把一条记录计入统计；字段名转成小写，和瓦片一致 */
export function addRecord(sample: SampleStats, record: Readonly<Record<string, unknown>>): void {
  sample.records += 1;
  for (const [name, value] of Object.entries(record)) {
    const field = name.toLowerCase();
    const stats = (sample.fields[field] ??= newField());
    stats.seen += 1;
    if (!stats.names.includes(name)) {
      stats.names.push(name);
    }
    if (isPlaceholder(value)) {
      increase(stats.placeholders, textOf(value));
      continue;
    }
    stats.filled += 1;
    increase(stats.types, typeof value);
    const key = textOf(value);
    if (key in stats.values || Object.keys(stats.values).length < MAX_TRACKED_VALUES) {
      increase(stats.values, key);
    } else {
      stats.overflow = true;
    }
  }
}

/** 合并多份统计（同一字段的计数相加） */
export function mergeSamples(samples: readonly SampleStats[]): SampleStats {
  const merged = emptySample();
  for (const sample of samples) {
    merged.records += sample.records;
    for (const [field, stats] of Object.entries(sample.fields)) {
      const target = (merged.fields[field] ??= newField());
      target.seen += stats.seen;
      target.filled += stats.filled;
      target.overflow ||= stats.overflow;
      for (const [key, count] of Object.entries(stats.values)) {
        target.values[key] = (target.values[key] ?? 0) + count;
      }
      for (const [key, count] of Object.entries(stats.types)) {
        target.types[key] = (target.types[key] ?? 0) + count;
      }
      for (const [key, count] of Object.entries(stats.placeholders)) {
        target.placeholders[key] = (target.placeholders[key] ?? 0) + count;
      }
      target.names = [...new Set([...target.names, ...stats.names])];
    }
  }
  return merged;
}

/** 属性表的统计加上瓦片里才见到的取值（次数记 0）：分布仍按属性表，但抽样漏掉的少见取值不会漏掉 */
export function withUnseenValues(base: SampleStats, others: readonly SampleStats[]): SampleStats {
  const merged = mergeSamples(others);
  const fields = Object.create(null) as Record<string, FieldStats>;
  for (const [field, stats] of Object.entries(base.fields)) {
    const values = { ...stats.values };
    for (const value of Object.keys(merged.fields[field]?.values ?? {})) {
      if (!Object.hasOwn(values, value)) {
        values[value] = 0;
      }
    }
    fields[field] = { ...stats, values };
  }
  return { records: base.records, fields };
}

const CJK = /[一-鿿]/;

/** 编码字段对应的名称字段：cc → ccn、dlbm → dlmc */
export interface LabelField {
  readonly field: string;
  /** 取值 → 名称 */
  readonly labels: Readonly<Record<string, string>>;
}

// 字段的值都不是中文、且取值数不多：可能是编码
function isCodeField(stats: FieldStats): boolean {
  const values = Object.keys(stats.values);
  return values.length > 0 && values.length <= MAX_STANDARD_CLASSES && !values.some(value => CJK.test(value));
}

// 字段的值大多是中文：可能是名称
function isNameField(stats: FieldStats): boolean {
  const values = Object.keys(stats.values);
  return values.length > 0 && !stats.overflow && values.filter(value => CJK.test(value)).length >= values.length * 0.8;
}

type PairCounts = Map<string, Map<string, number>>;

function countPair(table: PairCounts, from: string, to: string): void {
  const row = table.get(from) ?? new Map<string, number>();
  row.set(to, (row.get(to) ?? 0) + 1);
  table.set(from, row);
}

// 按每个取值最常见的对应值算，有多少条记录是一致的
function agreeingRecords(table: PairCounts): number {
  return [...table.values()].reduce((sum, row) => sum + Math.max(...row.values()), 0);
}

// 两个字段的取值一一对应（允许 5% 的不一致）
function pairOf(
  records: readonly Readonly<Record<string, unknown>>[],
  code: string,
  name: string
): Record<string, string> | null {
  const byCode: PairCounts = new Map();
  const byName: PairCounts = new Map();
  let paired = 0;
  let codeFilled = 0;
  let nameFilled = 0;
  for (const record of records) {
    // 低级别的瓦片可能只带其中一个字段，这些记录说明不了两者的关系
    if (code in record && name in record) {
      const codeValue = record[code];
      const nameValue = record[name];
      codeFilled += isPlaceholder(codeValue) ? 0 : 1;
      nameFilled += isPlaceholder(nameValue) ? 0 : 1;
      if (!isPlaceholder(codeValue) && !isPlaceholder(nameValue)) {
        paired += 1;
        countPair(byCode, textOf(codeValue), textOf(nameValue));
        countPair(byName, textOf(nameValue), textOf(codeValue));
      }
    }
  }
  // 编码至少两个取值；两个字段要在同一批记录上有值：只有部分记录有值的是别的字段（如 ifidh 只有医院才填）
  if (byCode.size < 2 || paired < codeFilled * 0.9 || paired < nameFilled * 0.9) {
    return null;
  }
  if (agreeingRecords(byCode) < paired * 0.95 || agreeingRecords(byName) < paired * 0.95) {
    return null;
  }
  const labels: Record<string, string> = {};
  for (const [value, row] of byCode) {
    const [best] = [...row.entries()].toSorted((a, b) => b[1] - a[1]);
    if (best) {
      labels[value] = best[0];
    }
  }
  return labels;
}

/** 从记录里找编码字段对应的名称字段；记录的字段名要已经转成小写 */
export function findLabelFields(
  records: readonly Readonly<Record<string, unknown>>[],
  sample: SampleStats
): Record<string, LabelField> {
  const fields = Object.entries(sample.fields);
  const codes = fields.filter(([, stats]) => isCodeField(stats));
  const names = fields.filter(([, stats]) => isNameField(stats));
  const result: Record<string, LabelField> = {};
  for (const [code] of codes) {
    for (const [name] of names) {
      const labels = pairOf(records, code, name);
      if (labels && !result[code]) {
        result[code] = { field: name, labels };
      }
    }
  }
  return result;
}

export type Verdict = 'recommended' | 'possible' | 'rejected';

export interface FieldAssessment {
  readonly field: string;
  readonly verdict: Verdict;
  readonly score: number;
  readonly reasons: readonly string[];
  readonly distinct: number;
  /** 有效值占比 */
  readonly fillRate: number;
  /** 最多的取值占有效值的比例 */
  readonly topShare: number;
  readonly mixedTypes: boolean;
  /** 这个字段的值有名称字段对应时的名称字段 */
  readonly labelField: string | null;
  /** 取值和出现次数，从多到少 */
  readonly values: readonly (readonly [value: string, count: number])[];
}

function excludedReason(field: string): string | null {
  for (const [pattern, reason] of EXCLUDED_FIELDS) {
    if (pattern.test(field)) {
      return reason;
    }
  }
  return null;
}

function nameScore(field: string): number {
  if (STANDARD_FIELDS.has(field)) {
    return 40;
  }
  if (COMMON_FIELDS.has(field)) {
    return 25;
  }
  return CLASS_NAME_PATTERN.test(field) ? 20 : 0;
}

/** 评估一个字段能不能做分类：排除的规则写在 reasons 里，评分只用于排序和给出建议 */
export function assessField(field: string, stats: FieldStats, label: LabelField | undefined): FieldAssessment {
  const values = Object.entries(stats.values).toSorted((a, b) => b[1] - a[1]);
  const distinct = values.length;
  const fillRate = stats.seen === 0 ? 0 : stats.filled / stats.seen;
  const topShare = stats.filled === 0 ? 0 : (values[0]?.[1] ?? 0) / stats.filled;
  const mixedTypes = Object.keys(stats.types).length > 1;
  const onlyNumbers = Object.keys(stats.types).every(type => type === 'number');
  const limit = STANDARD_FIELDS.has(field) ? MAX_STANDARD_CLASSES : MAX_CLASSES;
  const common = { field, distinct, fillRate, topShare, mixedTypes, labelField: label?.field ?? null, values };
  const reject = (reason: string): FieldAssessment => ({ ...common, verdict: 'rejected', score: 0, reasons: [reason] });

  const excluded = excludedReason(field);
  if (excluded) {
    return reject(excluded);
  }
  if (stats.filled === 0) {
    return reject('全部没有值');
  }
  if (distinct < 2) {
    return reject('只有一个取值');
  }
  if (stats.overflow || distinct > limit) {
    return reject(`取值过多（超过 ${limit} 个）`);
  }
  if (onlyNumbers && distinct > 12) {
    return reject('连续数值，适合分级，不适合分类');
  }
  if (stats.filled >= 5 && distinct > 4 && distinct / stats.filled > 0.5) {
    return reject('接近唯一值');
  }

  const reasons: string[] = [];
  const known = nameScore(field);
  if (known >= 40) {
    reasons.push('有编码表的标准字段');
  } else if (known > 0) {
    reasons.push('常见的分类字段名');
  }
  if (fillRate < 0.5) {
    reasons.push(`只有 ${Math.round(fillRate * 100)}% 的要素有值，其余会归入"其他"`);
  }
  const dominated = topShare > DOMINANT_SHARE;
  if (dominated) {
    reasons.push(`一个取值占 ${Math.round(topShare * 100)}%，分类效果不明显`);
  }
  if (mixedTypes) {
    reasons.push('字符串和数字混用，match 表达式会匹配不上');
  }
  if (Object.keys(stats.placeholders).length > 0) {
    reasons.push(`有占位值（${Object.keys(stats.placeholders).join('、')}）`);
  }
  if (stats.names.length > 1) {
    reasons.push(`字段名大小写不统一（${stats.names.join('、')}）`);
  }
  const compound = values.filter(([value]) => value.includes('/') && CJK.test(value));
  if (compound[0]) {
    reasons.push(`有 ${compound.length} 个用 / 拼接的复合取值（如 ${compound[0][0]}），要先归并`);
  }
  const balance = Math.min(1, (1 - topShare) / 0.5) * 15;
  const size = distinct <= 12 ? 15 : 8;
  const score = Math.round(known + fillRate * 30 + balance + size);
  if (score < POSSIBLE_SCORE) {
    return { ...common, verdict: 'rejected', score, reasons };
  }
  const clean = !dominated && compound.length === 0;
  return { ...common, verdict: score >= RECOMMEND_SCORE && clean ? 'recommended' : 'possible', score, reasons };
}

// 不单独建议的字段：评分压到建议线以下，写明原因
function capped(item: FieldAssessment, reason: string): FieldAssessment {
  const reasons = [...item.reasons, reason];
  return { ...item, verdict: 'possible', score: Math.min(item.score, RECOMMEND_SCORE - 1), reasons };
}

/** 评估全部字段，候选排在前面；同一对编码和名称只留一个候选（优先编码，名称作为它的显示名称） */
export function assessFields(
  sample: SampleStats,
  labels: Readonly<Record<string, LabelField>>,
  code = ''
): FieldAssessment[] {
  const assessed = Object.entries(sample.fields).map(([field, stats]) => assessField(field, stats, labels[field]));
  const labelOnly = new Set(assessed.flatMap(item => (item.verdict === 'rejected' ? [] : (item.labelField ?? []))));
  return assessed
    .map(item => {
      if (item.verdict === 'rejected') {
        return item;
      }
      // 监测图层的地类字段是变化（或细化）前的地类（layer-fields.ts 的字段名），学校可能建在住宅用地上
      if (code.startsWith('csxhjctb_') && (item.field === 'dlbm' || item.field === 'dlmc')) {
        return capped(item, '监测图层里是变化（或细化）前的地类，不是这个资源自身的类型');
      }
      return labelOnly.has(item.field) ? capped(item, '是编码字段的显示名称') : item;
    })
    .toSorted((a, b) => b.score - a.score || a.field.localeCompare(b.field));
}

/** 字段在瓦片一个级别上的保留情况；这个级别没有要素时为 null */
export function coverageOf(stats: SampleStats, field: string): number | null {
  if (stats.records === 0) {
    return null;
  }
  return (stats.fields[field]?.seen ?? 0) / stats.records;
}

/** 字段缺失的瓦片级别：有要素、但带这个字段的不到 99%（瓦片切开时属性不会丢，少数缺失也算） */
export function missingZooms(tiles: readonly { readonly zoom: number; readonly stats: SampleStats }[], field: string) {
  return tiles.flatMap(({ zoom, stats }) => {
    const coverage = coverageOf(stats, field);
    return coverage !== null && coverage < 0.99 ? [zoom] : [];
  });
}
