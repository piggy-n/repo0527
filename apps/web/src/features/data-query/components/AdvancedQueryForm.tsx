import { MxTitle } from '@yzt/ui';
import { ElInput } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import type { AdvancedForm } from '../composables/useAdvancedForm';
import { ADVANCED_OPERATORS } from '../conditions';
import type { QueryTopic } from '../topics';
import styles from './AdvancedQueryForm.module.scss';
import { LayerField } from './LayerField';
import formStyles from './QueryForm.module.scss';

/** 高级查询（ADR 0104 并入页签）：点击字段、唯一值、运算符插入到 SQL 末尾，SQL 也可以直接改 */
export const AdvancedQueryForm = defineComponent({
  name: 'AdvancedQueryForm',
  props: {
    topic: { type: Object as PropType<QueryTopic>, required: true },
    form: { type: Object as PropType<AdvancedForm>, required: true },
    hasResult: { type: Boolean, default: false }
  },
  setup(props) {
    const renderFields = () => {
      const fields = props.form.layer.value?.fields ?? [];
      const current = props.form.field.value;
      if (fields.length === 0) {
        return <p class={styles.empty}>请先选择图层</p>;
      }
      return fields.map(field => (
        <button
          key={field.field}
          type="button"
          class={[styles.item, current?.field === field.field && styles.currentItem]}
          title={field.label}
          onClick={() => props.form.insertField(field.field)}
        >
          <span class={styles.code}>{field.field}</span>
          <span class={styles.name}>{field.label}</span>
        </button>
      ));
    };

    // 选项来自字段的下拉选项；输入框、日期字段没有预设的值
    const renderValues = () => {
      const field = props.form.field.value;
      if (field === null) {
        return <p class={styles.empty}>点击字段查看可选值</p>;
      }
      if (field.type !== 'single' && field.type !== 'multiple') {
        return <p class={styles.empty}>该字段没有预设值，请直接输入</p>;
      }
      return field.options.map(option => (
        <button
          key={option.code}
          type="button"
          class={styles.item}
          title={option.name}
          onClick={() => props.form.insertValue(option.code)}
        >
          <span class={styles.code}>{option.code}</span>
          {option.name !== option.code && <span class={styles.name}>{option.name}</span>}
        </button>
      ));
    };

    return () => {
      const { form } = props;
      const disabled = form.layer.value === null;
      return (
        <div class={formStyles.form}>
          <section class={formStyles.section}>
            <MxTitle>查询图层</MxTitle>
            <LayerField
              topic={props.topic}
              layer={form.layer.value}
              hasResult={props.hasResult}
              onChange={(table: string) => form.setLayer(table)}
            />
          </section>
          <section class={formStyles.section}>
            <div class={formStyles.sectionHead}>
              <MxTitle>构造条件</MxTitle>
              <span class={formStyles.hint}>点击插入到 SQL 末尾</span>
            </div>
            <div class={styles.pickers}>
              <div class={styles.picker}>
                <span class={styles.pickerTitle}>字段</span>
                <div class={styles.list}>{renderFields()}</div>
              </div>
              <div class={styles.picker}>
                <span class={styles.pickerTitle}>唯一值</span>
                <div class={styles.list}>{renderValues()}</div>
              </div>
            </div>
            <span class={styles.pickerTitle}>运算符</span>
            <div class={styles.operators}>
              {ADVANCED_OPERATORS.map(operator => (
                <button
                  key={operator}
                  type="button"
                  class={styles.operator}
                  disabled={disabled}
                  onClick={() => form.insertOperator(operator)}
                >
                  {operator}
                </button>
              ))}
            </div>
          </section>
          <section class={formStyles.section}>
            <MxTitle>SQL 语句</MxTitle>
            <ElInput
              type="textarea"
              rows={4}
              modelValue={form.sql.value}
              placeholder="SELECT * FROM 表名 WHERE 条件"
              onUpdate:modelValue={(value: string) => (form.sql.value = value)}
            />
          </section>
        </div>
      );
    };
  }
});
