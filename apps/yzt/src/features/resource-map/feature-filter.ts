import { type ExpressionSpecification, featureFilter } from '@maplibre/maplibre-gl-style-spec';
import { classExpression, OTHER_ITEM } from './classification';
import { CLASS_FIELD, type FilterField, filterFieldsOf, registeredFieldOf } from './filter-fields';
import { matchExpression } from './match-expression';
import { resourceStyle } from './style-registry';

// 要素过滤（ADR 0173）：按字段勾选取值，勾着的显示；纯函数，状态在资源的显示状态里（ResourceDisplay.filter）

/**
 * 一个资源的过滤条件：字段 ID → 勾着的取值的键，按字段登记的先后。没有的字段不过滤，全勾的字段不留；
 * 几个字段同时满足，一个字段里满足一项。空数组是一项都没勾，这一层不画
 */
export type FeatureFilter = Readonly<Record<string, readonly string[]>>;

/** 不过滤 */
export const NO_FILTER: FeatureFilter = Object.freeze({});

/** 有过滤条件 */
export function isFiltering(filter: FeatureFilter): boolean {
  return Object.keys(filter).length > 0;
}

/**
 * 按资源能过滤的字段整理条件：去掉不认识的字段和取值，取值按登记的先后，全勾的字段去掉；存下的取值一个都不认识了
 * （登记表改了）时不再过滤这个字段，免得整层消失。没有条件时返回 NO_FILTER，和原来一样时返回原来的对象
 */
export function normalizedFilter(fields: readonly FilterField[], filter: FeatureFilter): FeatureFilter {
  const next: Record<string, readonly string[]> = {};
  for (const field of fields) {
    const kept = filter[field.id];
    if (!kept) {
      continue;
    }
    const known = field.values.map(value => value.key).filter(key => kept.includes(key));
    if ((kept.length > 0 && known.length === 0) || known.length === field.values.length) {
      continue;
    }
    next[field.id] = known;
  }
  if (Object.keys(next).length === 0) {
    return NO_FILTER;
  }
  return sameFilter(next, filter) ? filter : next;
}

/** 两个条件相同（字段和取值都一样，不管先后） */
export function sameFilter(a: FeatureFilter, b: FeatureFilter): boolean {
  return filterKey(a) === filterKey(b);
}

/** 条件的稳定写法：比较、作废进行中的识别用 */
export function filterKey(filter: FeatureFilter): string {
  return JSON.stringify(
    Object.keys(filter)
      .toSorted()
      .map(id => [id, [...(filter[id] ?? [])].toSorted()])
  );
}

/** 把一个字段勾着的取值换成 kept，再整理（全勾时去掉这个字段）；字段不能过滤时抛错 */
export function withFieldKept(
  fields: readonly FilterField[],
  filter: FeatureFilter,
  id: string,
  kept: Iterable<string>
): FeatureFilter {
  if (!fields.some(field => field.id === id)) {
    throw new Error(`不能按 ${id} 过滤`);
  }
  return normalizedFilter(fields, { ...filter, [id]: [...new Set(kept)] });
}

/** 一个字段勾着的取值：没有条件时是全部 */
export function keptKeys(field: FilterField, filter: FeatureFilter): ReadonlySet<string> {
  return new Set(filter[field.id] ?? field.values.map(value => value.key));
}

// 一个字段的条件：分类字段用分类样式的匹配结构（和配色同一个），登记的字段按属性的取值，列表以外的算兜底
function conditionOf(code: string, id: string, kept: ReadonlySet<string>): ExpressionSpecification | boolean {
  if (id === CLASS_FIELD) {
    const rule = resourceStyle(code).color;
    if (!rule) {
      throw new Error(`资源 ${code} 没有分类`);
    }
    return classExpression<boolean>(rule, item => kept.has(item.key));
  }
  const field = registeredFieldOf(code, id);
  if (!field) {
    throw new Error(`资源 ${code} 没有登记字段 ${id}`);
  }
  return matchExpression<boolean>(
    ['get', field.property],
    field.values.map(value => [value, kept.has(value)] as const),
    kept.has(OTHER_ITEM)
  );
}

/**
 * 地图上的过滤表达式（ADR 0173）：和几何过滤一起放进资源的图层和标注图层；没有条件时为 null。
 * 一个字段一项都没勾时是恒假的表达式，这一层不画
 */
export function filterExpression(code: string, filter: FeatureFilter): ExpressionSpecification | null {
  const conditions = Object.entries(filter).map(([id, kept]): ExpressionSpecification => {
    const condition = conditionOf(code, id, new Set(kept));
    return typeof condition === 'boolean' ? ['boolean', condition] : condition;
  });
  if (conditions.length === 0) {
    return null;
  }
  return conditions.length === 1 ? conditions[0] : ['all', ...conditions];
}

/** 一个要素（按属性）有没有被过滤掉：和地图同一个表达式，按 style-spec 求值（map.md）；没有条件时都通过 */
export function featurePasses(code: string, filter: FeatureFilter, properties: Readonly<Record<string, unknown>>): boolean {
  const expression = filterExpression(code, filter);
  if (!expression) {
    return true;
  }
  return featureFilter(expression, 'filter').filter({ zoom: 0 }, { type: 1, properties: { ...properties } });
}

/** 一个字段的条件：字段的叫法和勾着的取值的名称 */
export interface FilterCondition {
  readonly field: FilterField;
  readonly labels: readonly string[];
}

/** 有条件的字段，按登记的先后 */
export function filterConditions(code: string, filter: FeatureFilter): FilterCondition[] {
  return filterFieldsOf(code).flatMap(field => {
    const kept = filter[field.id];
    return kept ? [{ field, labels: field.values.filter(value => kept.includes(value.key)).map(value => value.label) }] : [];
  });
}

// 名称太多时只写前三个和项数
const LISTED = 4;

/** 一个条件的文字，如"办学类型：小学、普通高等学校本科院校"；一项都没勾时写明 */
export function conditionText({ field, labels }: FilterCondition): string {
  if (labels.length === 0) {
    return `${field.label}：一项都没选`;
  }
  const names = labels.length <= LISTED ? labels.join('、') : `${labels.slice(0, LISTED - 1).join('、')}等 ${labels.length} 项`;
  return `${field.label}：${names}`;
}

/** 条件连成一句（行上的提示、浮层的底部）；没有条件时为空字符串 */
export function filterText(code: string, filter: FeatureFilter): string {
  return filterConditions(code, filter).map(conditionText).join('；');
}
