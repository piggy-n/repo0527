import { computed, type ComputedRef, type Ref, ref, type ShallowRef, shallowReadonly, shallowRef } from 'vue';
import { insertToken, parseAdvancedSql, quoteValue } from '../conditions';
import type { ConditionField } from '../layer-fields';
import { layerOf, type QueryLayer, type QueryTopic } from '../topics';
import type { FormCheck } from './useAttributeForm';

/** 高级查询的表单：选图层，点击字段、运算符、唯一值拼成 SQL，也可以直接改 */
export interface AdvancedForm {
  readonly layer: Readonly<ShallowRef<QueryLayer | null>>;
  readonly sql: Ref<string>;
  /** 最后点的字段，唯一值列表显示它的选项 */
  readonly field: ComputedRef<ConditionField | null>;
  /** 换图层时 SQL 和唯一值清空（同旧页面） */
  readonly setLayer: (table: string) => void;
  readonly insertField: (code: string) => void;
  readonly insertOperator: (operator: string) => void;
  /** 唯一值加上引号插入 */
  readonly insertValue: (value: string) => void;
  readonly reset: () => void;
  /** 拆出表名、区划和条件；SQL 里没写区划时用 fallbackRegion。写了别的图层时切到那个图层 */
  readonly check: (fallbackRegion: string) => FormCheck;
}

export function useAdvancedForm(topic: QueryTopic): AdvancedForm {
  const layer = shallowRef<QueryLayer | null>(null);
  const sql = ref('');
  const fieldCode = shallowRef<string | null>(null);

  // 没选图层时点击不插入，同旧页面
  const insert = (token: string) => {
    if (layer.value) {
      sql.value = insertToken(sql.value, layer.value.table, token);
    }
  };

  return {
    layer: shallowReadonly(layer),
    sql,
    field: computed(() => layer.value?.fields.find(({ field }) => field === fieldCode.value) ?? null),
    setLayer: table => {
      layer.value = layerOf(topic, table) ?? null;
      sql.value = '';
      fieldCode.value = null;
    },
    insertField: code => {
      insert(code);
      fieldCode.value = code;
    },
    insertOperator: insert,
    insertValue: value => insert(quoteValue(value)),
    reset: () => {
      layer.value = null;
      sql.value = '';
      fieldCode.value = null;
    },
    check: fallbackRegion => {
      const { layerCode, xzqdm, conditions } = parseAdvancedSql(sql.value, layer.value?.table ?? null, fallbackRegion);
      if (layerCode === null) {
        return { ok: false, reason: '未选择图层' };
      }
      const matched = layerOf(topic, layerCode);
      if (!matched) {
        return { ok: false, reason: '未匹配到高级查询图层' };
      }
      if (matched !== layer.value) {
        layer.value = matched;
        fieldCode.value = null;
      }
      return { ok: true, request: { kind: 'attribute', origin: 'advanced', layerCode, xzqdm, conditions } };
    }
  };
}
