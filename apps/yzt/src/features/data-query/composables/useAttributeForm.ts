import { computed, type ComputedRef, type ShallowRef, shallowReadonly, shallowRef } from 'vue';
import type { QueryRequest } from '../api';
import { attributeSql, type Condition, conditionsText, newCondition } from '../conditions';
import type { ConditionField } from '../layer-fields';
import { PROVINCE_CODE } from '../result-layers';
import { layerOf, type NaturalLanguageRule, type QueryLayer, type QueryTopic } from '../topics';

/** 表单生成的查询，或者不能查询的原因 */
export type FormCheck =
  | { readonly ok: true; readonly request: QueryRequest }
  | { readonly ok: false; readonly reason: string };

/** 条件里能改的部分 */
export type ConditionPatch = Partial<Pick<Condition, 'value' | 'operator' | 'link'>>;

/** 属性查询的表单（自然语言查询也回填到这里） */
export interface AttributeForm {
  readonly layer: Readonly<ShallowRef<QueryLayer | null>>;
  /** 行政区划代码，全省是 320000 */
  readonly region: Readonly<ShallowRef<string | null>>;
  readonly conditions: Readonly<ShallowRef<readonly Condition[]>>;
  /** 还能加的字段：已经加过的不再出现（同旧页面） */
  readonly remainingFields: ComputedRef<readonly ConditionField[]>;
  /** 面板上显示的 SQL；没选图层时为空字符串 */
  readonly sql: ComputedRef<string>;
  /** 选图层：条件换成这个图层默认显示的，行政区划回到全省（同旧页面） */
  readonly setLayer: (table: string) => void;
  readonly setRegion: (code: string | null) => void;
  readonly addCondition: (field: string) => void;
  readonly removeCondition: (key: number) => void;
  readonly updateCondition: (key: number, patch: ConditionPatch) => void;
  /** 自然语言解析的结果写进表单：图层、行政区划和一个条件，不加默认条件 */
  readonly apply: (rule: NaturalLanguageRule) => void;
  readonly reset: () => void;
  readonly check: (origin: 'attribute' | 'natural') => FormCheck;
}

/** 创建属性查询的表单，状态整体替换 */
export function useAttributeForm(topic: QueryTopic): AttributeForm {
  const layer = shallowRef<QueryLayer | null>(null);
  const region = shallowRef<string | null>(null);
  const conditions = shallowRef<readonly Condition[]>([]);
  let nextKey = 1;
  const create = (field: ConditionField) => newCondition(field, nextKey++);

  const findLayer = (table: string) => {
    const found = layerOf(topic, table);
    if (!found) {
      throw new Error(`专题 ${topic.id} 没有图层 ${table}`);
    }
    return found;
  };

  return {
    layer: shallowReadonly(layer),
    region: shallowReadonly(region),
    conditions: shallowReadonly(conditions),
    remainingFields: computed(() => {
      const used = new Set(conditions.value.map(({ field }) => field.field));
      return (layer.value?.fields ?? []).filter(({ field }) => !used.has(field));
    }),
    sql: computed(() => (layer.value ? attributeSql(layer.value.table, region.value, conditions.value) : '')),
    setLayer: table => {
      const next = findLayer(table);
      layer.value = next;
      region.value = PROVINCE_CODE;
      conditions.value = next.fields.filter(field => 'shown' in field && field.shown === true).map(create);
    },
    setRegion: code => {
      region.value = code;
    },
    addCondition: code => {
      const field = layer.value?.fields.find(item => item.field === code);
      if (!field) {
        throw new Error(`当前图层没有字段 ${code}`);
      }
      conditions.value = [...conditions.value, create(field)];
    },
    removeCondition: key => {
      conditions.value = conditions.value.filter(condition => condition.key !== key);
    },
    updateCondition: (key, patch) => {
      conditions.value = conditions.value.map(condition =>
        condition.key === key ? { ...condition, ...patch } : condition
      );
    },
    apply: rule => {
      const next = findLayer(rule.table);
      layer.value = next;
      region.value = rule.region;
      const { condition } = rule;
      const field = condition && next.fields.find(item => item.field === condition.field);
      conditions.value = field && condition ? [{ ...create(field), value: [...condition.value] }] : [];
    },
    reset: () => {
      layer.value = null;
      region.value = null;
      conditions.value = [];
    },
    check: origin => {
      if (layer.value === null) {
        return { ok: false, reason: '未选择图层' };
      }
      if (region.value === null) {
        return { ok: false, reason: '请选择行政区划' };
      }
      return {
        ok: true,
        request: {
          kind: 'attribute',
          origin,
          layerCode: layer.value.table,
          xzqdm: region.value,
          conditions: conditionsText(conditions.value)
        }
      };
    }
  };
}
