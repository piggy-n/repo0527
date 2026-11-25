import { type ClassItem, classItems, legacyItem, OTHER_ITEM } from './classification';
import { LANDUSE_GROUPS } from './landuse';
import { resourceStyle } from './style-registry';

// 要素过滤能用的字段（ADR 0173）：分类字段由样式登记表的配色规则推出，取值、名称和图例一样；别的字段按 code 登记在这里，
// 一个资源一行，取值来自 probe:resource-classes 的探查，字段的叫法和代码的名称由人确认后再登记

/** 分类字段的 ID：按图例的分类，属性名由配色规则决定（地类图斑先按编码再按名称） */
export const CLASS_FIELD = '$class';

/** 过滤的一个取值：分类字段是分类样式里取值的键，登记的字段是属性的取值；兜底的键是 OTHER_ITEM */
export interface FilterValue {
  readonly key: string;
  readonly label: string;
  /** 地类的编码，写在名称前面 */
  readonly code?: string;
}

/** 取值的一组：地类按一级类分组，组也能整组勾选 */
export interface FilterGroup {
  readonly name: string;
  readonly keys: readonly string[];
}

/** 一个能过滤的字段 */
export interface FilterField {
  /** 分类字段是 CLASS_FIELD，登记的字段是属性名 */
  readonly id: string;
  readonly label: string;
  readonly values: readonly FilterValue[];
  /** 分组（地类）；没有时平铺 */
  readonly groups?: readonly FilterGroup[];
}

// 登记的字段：属性名、叫法、取值（瓦片里的值，也是显示的名称）
interface RegisteredField {
  readonly property: string;
  readonly label: string;
  readonly values: readonly string[];
}

// 学校的办学类型（type）：2026-11-02 探查的全部取值（学校面层 2025 年），按学段从低到高排；名称就是取值
const SCHOOL_KINDS: readonly string[] = [
  '托儿所',
  '幼儿园',
  '幼儿园（含幼托）',
  '小学',
  '初级中学',
  '高级中学',
  '完全中学',
  '9年一贯制学校',
  '12年一贯制学校',
  '初级中学/小学',
  '高级中学/初级中学',
  '初级中学/高级中学',
  '普通高等学校本科院校',
  '普通高等学校高职（专科）院校',
  '成人高等学校',
  '成人高等学校/普通高等学校高职（专科）院校',
  '军事院校',
  '其他特殊教育学校',
  '培智学校',
  '聋人学校',
  '盲人学校',
  '聋人学校/培智学校',
  '盲人学校/聋人学校',
  '盲人学校/聋人学校/培智学校',
  '其他'
];

// 部分取值：只列资源实际有的，先后同全表
function pickKinds(...values: readonly string[]): readonly string[] {
  const missing = values.find(value => !SCHOOL_KINDS.includes(value));
  if (missing !== undefined) {
    throw new Error(`学校的类型里没有 ${missing}`);
  }
  return SCHOOL_KINDS.filter(value => values.includes(value));
}

// 用户 2026-11-24 确认先登记学校的 type（"只展示小学、大学"），叫"办学类型"：叫"类型"时和分类字段的"分类"分不清（同日用户选定）；
// 别的字段确认叫法后再加（docs/backlog.md）
const REGISTERED_FIELDS = new Map<string, readonly RegisteredField[]>([
  ['csxhjctb_xxa', [{ property: 'type', label: '办学类型', values: SCHOOL_KINDS }]],
  [
    'csxhjctb_xxp',
    [
      {
        property: 'type',
        label: '办学类型',
        values: pickKinds(
          '托儿所',
          '幼儿园',
          '幼儿园（含幼托）',
          '小学',
          '初级中学',
          '高级中学',
          '完全中学',
          '9年一贯制学校',
          '12年一贯制学校',
          '其他特殊教育学校',
          '培智学校'
        )
      }
    ]
  ]
]);

/** 登记的字段的属性名和取值（不含兜底）：过滤表达式按它匹配 */
export function registeredFieldOf(code: string, id: string): RegisteredField | undefined {
  return REGISTERED_FIELDS.get(code)?.find(field => field.property === id);
}

const LANDUSE_CODES = new Set(LANDUSE_GROUPS.flatMap(group => group.classes.map(item => item.code)));

// 地类的分组：一级类（只留资源有的类），历史地类一组，未匹配的地类单独一项
function landuseGroups(items: readonly ClassItem[]): FilterGroup[] {
  const keys = new Set(items.map(item => item.key));
  const groups = LANDUSE_GROUPS.flatMap(group => {
    const kept = group.classes.map(item => item.code).filter(key => keys.has(key));
    return kept.length > 0 ? [{ name: group.name, keys: kept }] : [];
  });
  const legacy = items.filter(item => item.key.startsWith(legacyItem(''))).map(item => item.key);
  return [
    ...groups,
    ...(legacy.length > 0 ? [{ name: '历史地类', keys: legacy }] : []),
    ...(keys.has(OTHER_ITEM) ? [{ name: '未匹配的地类', keys: [OTHER_ITEM] }] : [])
  ];
}

// 分类字段：按配色规则的取值；地类写编码、按一级类分组
function classField(code: string): FilterField | null {
  const rule = resourceStyle(code).color;
  if (!rule) {
    return null;
  }
  const items = classItems(rule);
  if (rule.kind === 'values') {
    return { id: CLASS_FIELD, label: '分类', values: items.map(({ key, label }) => ({ key, label })) };
  }
  const values = items.map(({ key, label }) => (LANDUSE_CODES.has(key) ? { key, label, code: key } : { key, label }));
  return { id: CLASS_FIELD, label: '地类', values, groups: landuseGroups(items) };
}

const fieldCache = new Map<string, readonly FilterField[]>();

/** 资源能过滤的字段：分类字段在前，登记的字段在后；都没有时为空（过滤不可用） */
export function filterFieldsOf(code: string): readonly FilterField[] {
  const cached = fieldCache.get(code);
  if (cached) {
    return cached;
  }
  const registered = (REGISTERED_FIELDS.get(code) ?? []).map(
    ({ property, label, values }): FilterField => ({
      id: property,
      label,
      values: [...values.map(value => ({ key: value, label: value })), { key: OTHER_ITEM, label: '未列出的取值' }]
    })
  );
  const classification = classField(code);
  const fields = classification ? [classification, ...registered] : registered;
  fieldCache.set(code, fields);
  return fields;
}
