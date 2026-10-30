import { Refresh } from '@element-plus/icons-vue';
import { MxTitle } from '@yzt/ui';
import { ElButton, ElInput } from 'element-plus';
import { defineComponent, type PropType } from 'vue';
import type { AttributeForm } from '../composables/useAttributeForm';
import type { NaturalLanguage } from '../composables/useNaturalLanguage';
import type { NaturalLanguageConfig } from '../topics';
import { SqlPreview } from './AttributeQueryForm';
import styles from './NaturalLanguageForm.module.scss';
import formStyles from './QueryForm.module.scss';

/** 自然语言查询：模拟解析后回填属性查询并查询；解析过的可以看 SQL */
export const NaturalLanguageForm = defineComponent({
  name: 'NaturalLanguageForm',
  props: {
    config: { type: Object as PropType<NaturalLanguageConfig>, required: true },
    natural: { type: Object as PropType<NaturalLanguage>, required: true },
    attribute: { type: Object as PropType<AttributeForm>, required: true }
  },
  setup(props) {
    return () => {
      const { natural } = props;
      const parsing = natural.parsing.value;
      return (
        <div class={formStyles.form}>
          <section class={formStyles.section}>
            <div class={formStyles.sectionHead}>
              <MxTitle>查询描述</MxTitle>
              <span class={formStyles.hint}>AI 解析为属性查询条件</span>
            </div>
            <div class={styles.input}>
              <ElInput
                type="textarea"
                rows={5}
                resize="none"
                modelValue={natural.text.value}
                placeholder={props.config.placeholder}
                disabled={parsing}
                onUpdate:modelValue={(value: string) => natural.setText(value)}
              />
              <ElButton
                class={styles.examples}
                link
                type="primary"
                icon={Refresh}
                disabled={parsing}
                onClick={natural.nextExample}
              >
                换一组
              </ElButton>
            </div>
            {parsing && (
              <div class={styles.thinking} role="status">
                <i />
                <i />
                <i />
                <span>AI 正在解析自然语言...</span>
              </div>
            )}
            {natural.parsed.value && <SqlPreview sql={props.attribute.sql.value} />}
          </section>
        </div>
      );
    };
  }
});
